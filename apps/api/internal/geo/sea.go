package geo

import (
	"container/heap"
	"context"
	"math"
)

// PARITY DELTA: the water-grid mask is built from the fetched corridor tiles
// instead of a padded full bounding box, limiting tile I/O for long routes.

type SeaPort struct {
	Position   LngLat
	Name, Kind string
}

type SeaSeeds struct {
	Ports    []SeaPort
	SeaLanes []LngLat
}

type SeaRouteOptions struct {
	Source                               FeatureSource
	Seeds                                SeaSeeds
	GridZoom, CellsPerTile               int
	FerrySnapM, PortSnapM, WaterwaySnapM float64
}

// SeaRouteResult soft-fails whenever source geography cannot support a route.
type SeaRouteResult struct {
	Ok                   bool
	Reason, Message, Via string
	Coordinates          []LngLat
}

func seaFail(reason, message string) SeaRouteResult {
	return SeaRouteResult{Reason: reason, Message: message}
}

func snapSeaSeeds(point LngLat, seeds SeaSeeds, maxM float64) LngLat {
	best, distance := point, maxM
	for _, candidate := range append(append([]SeaPort(nil), seeds.Ports...), seaLanePorts(seeds.SeaLanes)...) {
		if d := HaversineMeters(point, candidate.Position); d < distance {
			best, distance = candidate.Position, d
		}
	}
	return best
}

func seaLanePorts(points []LngLat) []SeaPort {
	out := make([]SeaPort, len(points))
	for i, point := range points {
		out[i].Position = point
	}
	return out
}

func closestSeaPoint(point, start, end LngLat) (LngLat, float64) {
	cosLat := math.Cos(toRadians(point.Lat))
	dx, dy := (end.Lng-start.Lng)*cosLat, end.Lat-start.Lat
	denom := dx*dx + dy*dy
	if denom == 0 {
		return start, HaversineMeters(point, start)
	}
	t := ((point.Lng-start.Lng)*cosLat*dx + (point.Lat-start.Lat)*dy) / denom
	t = math.Max(0, math.Min(1, t))
	candidate := LngLat{Lng: start.Lng + (end.Lng-start.Lng)*t, Lat: start.Lat + (end.Lat-start.Lat)*t}
	return candidate, HaversineMeters(point, candidate)
}

func tryFerry(origin, destination LngLat, features []TileFeature, snapM float64) []LngLat {
	var best []LngLat
	bestScore := math.Inf(1)
	for _, feature := range features {
		if feature.Type != FeatureLine || featureClass(feature) != "ferry" {
			continue
		}
		for _, line := range feature.Lines {
			if len(line) < 2 {
				continue
			}
			var oPoint, dPoint LngLat
			oDistance, dDistance := math.Inf(1), math.Inf(1)
			oSegment, dSegment := 0, 0
			for i := 1; i < len(line); i++ {
				if point, distance := closestSeaPoint(origin, line[i-1], line[i]); distance < oDistance {
					oPoint, oDistance, oSegment = point, distance, i-1
				}
				if point, distance := closestSeaPoint(destination, line[i-1], line[i]); distance < dDistance {
					dPoint, dDistance, dSegment = point, distance, i-1
				}
			}
			if oDistance > snapM || dDistance > snapM || oDistance+dDistance >= bestScore {
				continue
			}
			route := []LngLat{origin, oPoint}
			if oSegment <= dSegment {
				route = append(route, line[oSegment+1:dSegment+1]...)
			} else {
				for i := oSegment; i > dSegment; i-- {
					route = append(route, line[i])
				}
			}
			route = append(route, dPoint, destination)
			best, bestScore = route, oDistance+dDistance
		}
	}
	return best
}

type waterGrid struct {
	cellDeg float64
	cells   map[[2]int]struct{}
}

func gridCell(point LngLat, cellDeg float64) [2]int {
	return [2]int{int(math.Floor(point.Lng / cellDeg)), int(math.Floor(point.Lat / cellDeg))}
}

func gridCenter(cell [2]int, cellDeg float64) LngLat {
	return LngLat{Lng: (float64(cell[0]) + .5) * cellDeg, Lat: (float64(cell[1]) + .5) * cellDeg}
}

func buildWaterGrid(features []TileFeature, zoom, cellsPerTile int) waterGrid {
	cellDeg := 360 / float64(uint(1)<<zoom) / float64(cellsPerTile)
	grid := waterGrid{cellDeg: cellDeg, cells: make(map[[2]int]struct{})}
	for _, feature := range features {
		if feature.Type != FeaturePolygon {
			continue
		}
		if _, ok := NavigableWaterClasses[featureClass(feature)]; !ok {
			continue
		}
		for _, polygon := range feature.Polygons {
			if len(polygon) == 0 || len(polygon[0]) == 0 {
				continue
			}
			west, east := polygon[0][0].Lng, polygon[0][0].Lng
			south, north := polygon[0][0].Lat, polygon[0][0].Lat
			for _, point := range polygon[0] {
				west, east = math.Min(west, point.Lng), math.Max(east, point.Lng)
				south, north = math.Min(south, point.Lat), math.Max(north, point.Lat)
			}
			for x := int(math.Floor(west / cellDeg)); x <= int(math.Floor(east/cellDeg)); x++ {
				for y := int(math.Floor(south / cellDeg)); y <= int(math.Floor(north/cellDeg)); y++ {
					cell := [2]int{x, y}
					if PointInPolygon(gridCenter(cell, cellDeg), polygon) {
						grid.cells[cell] = struct{}{}
					}
				}
			}
		}
	}
	return grid
}

func snapWaterCell(point LngLat, grid waterGrid) ([2]int, bool) {
	origin := gridCell(point, grid.cellDeg)
	if _, ok := grid.cells[origin]; ok {
		return origin, true
	}
	best, distance := [2]int{}, math.Inf(1)
	for cell := range grid.cells {
		if d := HaversineMeters(point, gridCenter(cell, grid.cellDeg)); d < distance {
			best, distance = cell, d
		}
	}
	return best, distance <= HaversineMeters(LngLat{}, LngLat{Lat: grid.cellDeg * 12})
}

type seaOpenNode struct {
	cell     [2]int
	priority float64
}
type seaHeap []seaOpenNode

func (h seaHeap) Len() int           { return len(h) }
func (h seaHeap) Less(i, j int) bool { return h[i].priority < h[j].priority }
func (h seaHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *seaHeap) Push(value any)    { *h = append(*h, value.(seaOpenNode)) }
func (h *seaHeap) Pop() any          { old := *h; last := old[len(old)-1]; *h = old[:len(old)-1]; return last }

func astarWater(ctx context.Context, grid waterGrid, start, goal [2]int) []LngLat {
	if _, ok := grid.cells[start]; !ok {
		return nil
	}
	if _, ok := grid.cells[goal]; !ok {
		return nil
	}
	open := &seaHeap{{cell: start}}
	heap.Init(open)
	came, score, closed := make(map[[2]int][2]int), map[[2]int]float64{start: 0}, make(map[[2]int]bool)
	for open.Len() > 0 {
		if ctx.Err() != nil {
			return nil
		}
		current := heap.Pop(open).(seaOpenNode).cell
		if closed[current] {
			continue
		}
		if current == goal {
			cells := [][2]int{goal}
			for current != start {
				current = came[current]
				cells = append(cells, current)
			}
			out := make([]LngLat, len(cells))
			for i := range cells {
				out[len(cells)-1-i] = gridCenter(cells[i], grid.cellDeg)
			}
			return out
		}
		closed[current] = true
		for dx := -1; dx <= 1; dx++ {
			for dy := -1; dy <= 1; dy++ {
				if dx == 0 && dy == 0 {
					continue
				}
				next := [2]int{current[0] + dx, current[1] + dy}
				if _, allowed := grid.cells[next]; !allowed || closed[next] {
					continue
				}
				cost := score[current] + math.Hypot(float64(dx), float64(dy))
				if prior, known := score[next]; known && cost >= prior {
					continue
				}
				came[next], score[next] = current, cost
				heap.Push(open, seaOpenNode{cell: next, priority: cost + math.Hypot(float64(next[0]-goal[0]), float64(next[1]-goal[1]))})
			}
		}
	}
	return nil
}

func waterwayRoute(ctx context.Context, origin, destination LngLat, features []TileFeature, snapM float64) []LngLat {
	graph := BuildRoadGraph(filterWaterways(features), RoadCar, false)
	start, originSnap, startOK := snapRoad(graph, origin)
	goal, destinationSnap, goalOK := snapRoad(graph, destination)
	if !startOK || !goalOK || HaversineMeters(origin, originSnap) > snapM || HaversineMeters(destination, destinationSnap) > snapM {
		return nil
	}
	ids, ok := AStarRoad(ctx, graph, start, goal)
	if !ok {
		return nil
	}
	out := []LngLat{origin}
	for _, id := range ids {
		out = append(out, graph.Nodes[id])
	}
	return append(out, destination)
}

func filterWaterways(features []TileFeature) []TileFeature {
	out := make([]TileFeature, 0)
	for _, feature := range features {
		class := featureClass(feature)
		if feature.Type == FeatureLine && (class == "river" || class == "canal") {
			feature.Properties = map[string]any{"class": "primary"}
			out = append(out, feature)
		}
	}
	return out
}

// RouteSea prefers ferry, then water-grid A*, then river/canal topology.
func RouteSea(ctx context.Context, origin, destination LngLat, options SeaRouteOptions) SeaRouteResult {
	if options.Source == nil {
		return seaFail("no-navigable-route", "sea feature source is required")
	}
	if ctx.Err() != nil {
		return seaFail("cancelled", "sea route cancelled")
	}
	if options.GridZoom == 0 {
		options.GridZoom = 7
	}
	if options.CellsPerTile == 0 {
		options.CellsPerTile = 32
	}
	if options.FerrySnapM == 0 {
		options.FerrySnapM = 8000
	}
	if options.PortSnapM == 0 {
		options.PortSnapM = 25000
	}
	if options.WaterwaySnapM == 0 {
		options.WaterwaySnapM = 2500
	}
	start, end := snapSeaSeeds(origin, options.Seeds, options.PortSnapM), snapSeaSeeds(destination, options.Seeds, options.PortSnapM)
	tiles := roadTilesAlongCorridor(start, end, options.GridZoom, math.Max(options.PortSnapM, 10000))
	var water, transportation, waterways []TileFeature
	for _, tile := range tiles {
		for _, request := range []struct {
			layer string
			dest  *[]TileFeature
		}{{"water", &water}, {"transportation", &transportation}, {"waterway", &waterways}} {
			features, err := options.Source.LayerFeatures(ctx, options.GridZoom, tile[0], tile[1], request.layer)
			if err != nil {
				if ctx.Err() != nil {
					return seaFail("cancelled", "sea route cancelled")
				}
				continue
			}
			*request.dest = append(*request.dest, features...)
		}
	}
	if route := tryFerry(start, end, transportation, options.FerrySnapM); len(route) >= 2 {
		return SeaRouteResult{Ok: true, Coordinates: route, Via: "ferry"}
	}
	grid := buildWaterGrid(water, options.GridZoom, options.CellsPerTile)
	startCell, startOK := snapWaterCell(start, grid)
	endCell, endOK := snapWaterCell(end, grid)
	if startOK && endOK {
		if route := astarWater(ctx, grid, startCell, endCell); len(route) > 0 {
			return SeaRouteResult{Ok: true, Coordinates: route, Via: "water-grid"}
		}
	}
	if route := waterwayRoute(ctx, start, end, waterways, options.WaterwaySnapM); len(route) >= 2 {
		return SeaRouteResult{Ok: true, Coordinates: route, Via: "waterway"}
	}
	if !startOK || !endOK {
		return seaFail("endpoints-not-on-water", "endpoints could not be snapped to navigable water")
	}
	return seaFail("no-navigable-route", "no navigable sea, lake, ferry, or waterway route between endpoints")
}
