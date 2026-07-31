package geo

import (
	"container/heap"
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// PARITY DELTA: endpoint refinement uses a complete local reroute instead of
// stitching two local legs into the coarse skeleton; it preserves the same
// skeleton/local fallback behavior while avoiding cross-zoom join artifacts.

const (
	RoadQuantizeDecimals = 5
	RoadSkeletonZoom     = 10
	RoadLocalZoom        = 14
)

type RoadVehicleKind string

const (
	RoadCar   RoadVehicleKind = "car"
	RoadTruck RoadVehicleKind = "truck"
)

type RoadRouteMode string

const (
	RoadHierarchical RoadRouteMode = "hierarchical"
	RoadLocal        RoadRouteMode = "local"
	RoadSkeleton     RoadRouteMode = "skeleton"
)

type RoadRouteOptions struct {
	Source                  FeatureSource
	Vehicle                 RoadVehicleKind
	Mode                    RoadRouteMode
	SkeletonZoom, LocalZoom int
	CorridorHalfWidthM      float64
}

// RoadRouteResult is the typed road routing result.
type RoadRouteResult struct {
	Ok                                             bool
	Reason, Message                                string
	Coordinates, SnappedOrigin, SnappedDestination []LngLat
	TilesFetched                                   int
}

type RoadEdge struct {
	To, RoadClass string
	LengthM, Cost float64
}

type RoadGraph struct {
	Nodes            map[string]LngLat
	Adj              map[string][]RoadEdge
	LargestComponent map[string]struct{}
}

var arterialRoadClasses = map[string]struct{}{
	"motorway": {}, "trunk": {}, "primary": {}, "secondary": {}, "tertiary": {}, "minor": {},
	"motorway_construction": {}, "trunk_construction": {}, "primary_construction": {}, "secondary_construction": {}, "tertiary_construction": {}, "minor_construction": {},
}

var excludedRoadClasses = map[string]struct{}{"rail": {}, "path": {}, "track": {}, "aerialway": {}, "transit": {}, "ferry": {}}
var blockedRoadAccess = map[string]struct{}{"no": {}, "private": {}, "military": {}, "forestry": {}, "agricultural": {}}

// QuantizeRoadKey returns a stable graph-node key at the locked 5-decimal precision.
func QuantizeRoadKey(point LngLat) string {
	return strconv.FormatFloat(point.Lng, 'f', RoadQuantizeDecimals, 64) + "," + strconv.FormatFloat(point.Lat, 'f', RoadQuantizeDecimals, 64)
}

func roadAllowed(class string, vehicle RoadVehicleKind, filter bool) bool {
	if _, excluded := excludedRoadClasses[class]; excluded || class == "" {
		return false
	}
	if !filter {
		return true
	}
	if vehicle == RoadTruck {
		_, ok := arterialRoadClasses[class]
		return ok
	}
	if class == "service" {
		return true
	}
	_, ok := arterialRoadClasses[class]
	return ok
}

func roadAccessAllowed(feature TileFeature) bool {
	if feature.Properties == nil {
		return true
	}
	value, ok := feature.Properties["access"]
	if !ok || value == nil || fmt.Sprint(value) == "" {
		return true
	}
	_, blocked := blockedRoadAccess[fmt.Sprint(value)]
	return !blocked
}

func parseRoadOneway(value any) int {
	switch v := value.(type) {
	case bool:
		if v {
			return 1
		}
	case int:
		if v == -1 {
			return -1
		}
		if v == 1 {
			return 1
		}
	case float64:
		if v == -1 {
			return -1
		}
		if v == 1 {
			return 1
		}
	case string:
		switch strings.ToLower(v) {
		case "1", "yes", "true":
			return 1
		case "-1", "reverse":
			return -1
		}
	}
	return 0
}

func roadSpeed(class string) float64 {
	switch strings.TrimSuffix(class, "_construction") {
	case "motorway":
		return 28
	case "trunk":
		return 22
	case "primary":
		return 16
	case "secondary":
		return 13
	case "tertiary":
		return 11
	case "minor":
		return 8
	case "service":
		return 5
	default:
		return 8
	}
}

func roadPreference(class string, vehicle RoadVehicleKind) float64 {
	base := strings.TrimSuffix(class, "_construction")
	if vehicle == RoadTruck {
		switch base {
		case "motorway", "trunk":
			return .7
		case "primary":
			return .85
		case "secondary":
			return 1.1
		case "tertiary":
			return 1.4
		case "minor":
			return 2.2
		default:
			return 4
		}
	}
	if base == "service" {
		return 1.25
	}
	return 1
}

// BuildRoadGraph builds directed travel-time weighted edges from transportation features.
func BuildRoadGraph(features []TileFeature, vehicle RoadVehicleKind, applyClassFilter bool) RoadGraph {
	nodes, adj := make(map[string]LngLat), make(map[string][]RoadEdge)
	seen := make(map[string]struct{})
	ensure := func(point LngLat) string {
		id := QuantizeRoadKey(point)
		if _, ok := nodes[id]; !ok {
			nodes[id] = LngLat{Lng: math.Round(point.Lng*1e5) / 1e5, Lat: math.Round(point.Lat*1e5) / 1e5}
			adj[id] = nil
		}
		return id
	}
	add := func(from, to string, distance float64, class string) {
		key := from + ">" + to
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		adj[from] = append(adj[from], RoadEdge{To: to, LengthM: distance, Cost: distance / roadSpeed(class) * roadPreference(class, vehicle), RoadClass: class})
	}
	for _, feature := range features {
		if feature.Type != FeatureLine || !roadAccessAllowed(feature) {
			continue
		}
		class := featureClass(feature)
		if !roadAllowed(class, vehicle, applyClassFilter) {
			continue
		}
		oneway := parseRoadOneway(feature.Properties["oneway"])
		for _, line := range feature.Lines {
			for i := 1; i < len(line); i++ {
				from, to := ensure(line[i-1]), ensure(line[i])
				if from == to {
					continue
				}
				distance := HaversineMeters(line[i-1], line[i])
				if oneway >= 0 {
					add(from, to, distance, class)
				}
				if oneway <= 0 {
					add(to, from, distance, class)
				}
			}
		}
	}
	return RoadGraph{Nodes: nodes, Adj: adj, LargestComponent: largestSCC(adj)}
}

func largestSCC(adj map[string][]RoadEdge) map[string]struct{} {
	reverse := make(map[string][]string, len(adj))
	for node, edges := range adj {
		if _, ok := reverse[node]; !ok {
			reverse[node] = nil
		}
		for _, edge := range edges {
			reverse[edge.To] = append(reverse[edge.To], node)
		}
	}
	visited, order := make(map[string]bool), make([]string, 0, len(adj))
	var visit func(string)
	visit = func(node string) {
		visited[node] = true
		for _, edge := range adj[node] {
			if !visited[edge.To] {
				visit(edge.To)
			}
		}
		order = append(order, node)
	}
	for node := range adj {
		if !visited[node] {
			visit(node)
		}
	}
	visited = make(map[string]bool)
	best := make(map[string]struct{})
	for i := len(order) - 1; i >= 0; i-- {
		node := order[i]
		if visited[node] {
			continue
		}
		component := make(map[string]struct{})
		stack := []string{node}
		visited[node] = true
		for len(stack) > 0 {
			current := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			component[current] = struct{}{}
			for _, next := range reverse[current] {
				if !visited[next] {
					visited[next] = true
					stack = append(stack, next)
				}
			}
		}
		if len(component) > len(best) {
			best = component
		}
	}
	return best
}

type roadOpenNode struct {
	id       string
	priority float64
}
type roadHeap []roadOpenNode

func (h roadHeap) Len() int           { return len(h) }
func (h roadHeap) Less(i, j int) bool { return h[i].priority < h[j].priority }
func (h roadHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *roadHeap) Push(value any)    { *h = append(*h, value.(roadOpenNode)) }
func (h *roadHeap) Pop() any          { old := *h; last := old[len(old)-1]; *h = old[:len(old)-1]; return last }

// AStarRoad runs A* over a directed road graph and returns node IDs.
func AStarRoad(ctx context.Context, graph RoadGraph, start, goal string) ([]string, bool) {
	if start == goal {
		return []string{start}, true
	}
	goalPoint, ok := graph.Nodes[goal]
	if !ok {
		return nil, false
	}
	open := &roadHeap{{id: start, priority: 0}}
	heap.Init(open)
	gScore, came, closed := map[string]float64{start: 0}, make(map[string]string), make(map[string]bool)
	for open.Len() > 0 {
		if err := ctx.Err(); err != nil {
			return nil, false
		}
		current := heap.Pop(open).(roadOpenNode).id
		if closed[current] {
			continue
		}
		if current == goal {
			path := []string{goal}
			for current != start {
				current = came[current]
				path = append(path, current)
			}
			for left, right := 0, len(path)-1; left < right; left, right = left+1, right-1 {
				path[left], path[right] = path[right], path[left]
			}
			return path, true
		}
		closed[current] = true
		for _, edge := range graph.Adj[current] {
			if closed[edge.To] {
				continue
			}
			cost := gScore[current] + edge.Cost
			if previous, known := gScore[edge.To]; known && cost >= previous {
				continue
			}
			came[edge.To], gScore[edge.To] = current, cost
			heuristic := HaversineMeters(graph.Nodes[edge.To], goalPoint) / 28
			heap.Push(open, roadOpenNode{id: edge.To, priority: cost + heuristic})
		}
	}
	return nil, false
}

func snapRoad(graph RoadGraph, point LngLat) (string, LngLat, bool) {
	var bestID string
	var best LngLat
	distance := math.Inf(1)
	for id := range graph.LargestComponent {
		candidate := graph.Nodes[id]
		if d := HaversineMeters(point, candidate); d < distance {
			bestID, best, distance = id, candidate, d
		}
	}
	return bestID, best, bestID != ""
}

func roadTilesAlongCorridor(origin, destination LngLat, zoom int, halfWidthM float64) [][2]int {
	distance := HaversineMeters(origin, destination)
	steps := max(1, int(math.Ceil(distance/math.Max(200, 2*math.Pi*6371000*math.Cos(toRadians(origin.Lat))/float64(uint(1)<<zoom)*.45))))
	padLat := halfWidthM / 111320
	padLng := halfWidthM / (111320 * math.Max(.2, math.Cos(toRadians(origin.Lat))))
	seen, tiles := make(map[[2]int]struct{}), make([][2]int, 0)
	for i := 0; i <= steps; i++ {
		t := float64(i) / float64(steps)
		point := LngLat{Lng: origin.Lng + (destination.Lng-origin.Lng)*t, Lat: origin.Lat + (destination.Lat-origin.Lat)*t}
		for _, offset := range []LngLat{{}, {Lng: padLng, Lat: padLat}, {Lng: -padLng, Lat: -padLat}} {
			x, y := lngLatToTile(LngLat{Lng: point.Lng + offset.Lng, Lat: point.Lat + offset.Lat}, zoom)
			key := [2]int{x, y}
			if _, ok := seen[key]; !ok {
				seen[key] = struct{}{}
				tiles = append(tiles, key)
			}
		}
	}
	return tiles
}

func routeRoadZoom(ctx context.Context, origin, destination LngLat, options RoadRouteOptions, zoom int, filtered bool, counter *int) RoadRouteResult {
	tiles := roadTilesAlongCorridor(origin, destination, zoom, options.CorridorHalfWidthM)
	if len(tiles) == 0 {
		return RoadRouteResult{Reason: "empty-corridor", Message: "no tiles along route corridor", TilesFetched: *counter}
	}
	var features []TileFeature
	for _, tile := range tiles {
		if err := ctx.Err(); err != nil {
			return RoadRouteResult{Reason: "aborted", Message: "road routing aborted", TilesFetched: *counter}
		}
		layer, err := options.Source.LayerFeatures(ctx, zoom, tile[0], tile[1], "transportation")
		if err != nil {
			if ctx.Err() != nil {
				return RoadRouteResult{Reason: "aborted", Message: "road routing aborted", TilesFetched: *counter}
			}
			return RoadRouteResult{Reason: "no-graph", Message: "unable to load road tiles", TilesFetched: *counter}
		}
		*counter++
		features = append(features, layer...)
	}
	graph := BuildRoadGraph(features, options.Vehicle, filtered)
	start, snappedOrigin, okStart := snapRoad(graph, origin)
	goal, snappedDestination, okGoal := snapRoad(graph, destination)
	if !okStart || !okGoal {
		return RoadRouteResult{Reason: "no-graph", Message: "no drivable road graph", TilesFetched: *counter}
	}
	ids, ok := AStarRoad(ctx, graph, start, goal)
	if !ok {
		if ctx.Err() != nil {
			return RoadRouteResult{Reason: "aborted", Message: "road routing aborted", TilesFetched: *counter}
		}
		return RoadRouteResult{Reason: "unroutable", Message: "no path between snapped endpoints", TilesFetched: *counter}
	}
	coordinates := make([]LngLat, 0, len(ids))
	for _, id := range ids {
		coordinates = append(coordinates, graph.Nodes[id])
	}
	return RoadRouteResult{Ok: true, Coordinates: coordinates, SnappedOrigin: []LngLat{snappedOrigin}, SnappedDestination: []LngLat{snappedDestination}, TilesFetched: *counter}
}

// RouteRoad routes using local, skeleton, or hierarchical fallback modes.
func RouteRoad(ctx context.Context, origin, destination LngLat, options RoadRouteOptions) RoadRouteResult {
	if options.Source == nil {
		return RoadRouteResult{Reason: "no-graph", Message: "road feature source is required"}
	}
	if err := ctx.Err(); err != nil {
		return RoadRouteResult{Reason: "aborted", Message: "road routing aborted"}
	}
	if options.Vehicle == "" {
		options.Vehicle = RoadCar
	}
	if options.Mode == "" {
		options.Mode = RoadHierarchical
	}
	if options.SkeletonZoom == 0 {
		options.SkeletonZoom = RoadSkeletonZoom
	}
	if options.LocalZoom == 0 {
		options.LocalZoom = RoadLocalZoom
	}
	if options.CorridorHalfWidthM == 0 {
		options.CorridorHalfWidthM = 1200
	}
	fetched := 0
	if options.Mode == RoadLocal || (options.Mode == RoadHierarchical && HaversineMeters(origin, destination) < 8000) {
		return routeRoadZoom(ctx, origin, destination, options, options.LocalZoom, true, &fetched)
	}
	skeleton := routeRoadZoom(ctx, origin, destination, options, options.SkeletonZoom, false, &fetched)
	if options.Mode == RoadSkeleton || !skeleton.Ok {
		if options.Mode == RoadHierarchical && !skeleton.Ok {
			return routeRoadZoom(ctx, origin, destination, options, options.LocalZoom, true, &fetched)
		}
		return skeleton
	}
	local := routeRoadZoom(ctx, origin, destination, options, options.LocalZoom, true, &fetched)
	if local.Ok {
		return local
	}
	return skeleton
}
