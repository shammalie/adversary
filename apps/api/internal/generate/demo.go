package generate

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/shammalie/adversary/apps/api/internal/geo"
	"github.com/shammalie/adversary/apps/api/internal/scenario"
)

const (
	MinDemoTargets       = 2
	MaxDemoTargets       = 100
	GroupJoinProbability = 0.08
	DemoMaxAbsLatitude   = 85.0
)

var vehicleSubtypes = map[string][]string{
	"aircraft": {"Multi-role fighter", "Transport", "UAV", "Rotary-wing"},
	"boat":     {"Fast patrol craft", "Cargo vessel", "Fishing trawler", "RHIB"},
	"car":      {"Sedan", "SUV", "Light utility"},
	"truck":    {"Cargo truck", "Tanker", "Flatbed"},
	"other":    {"Unclassified contact", "Mobile platform"},
}

var callsignPrefixes = []string{
	"VIPER", "HARBOR", "FALCON", "ORCA", "RAVEN", "STORM",
	"SHADOW", "NOMAD", "ARROW", "SPECTRE", "COBRA", "DRIFTER",
}

var demoColors = []string{
	"#e11d48", "#ea580c", "#ca8a04", "#16a34a", "#0891b2",
	"#2563eb", "#7c3aed", "#db2777", "#64748b", "#0f766e",
}

var affiliations = []string{"unknown", "friendly", "neutral", "hostile"}
var targetStatuses = []string{"unknown", "active", "stationary", "lost", "inactive"}

var demoMessages = []string{
	"Track quality improved. Contact maintaining course.",
	"Critical proximity threshold breached near restricted channel.",
	"Primary sensor contact intermittent.",
	"Identity correlation pending secondary source.",
	"Contact entered monitored sector.",
}

// DemoRegion is a catalogue region used for placement.
type DemoRegion struct {
	ID       string
	Name     string
	BBox     [4]float64 // west, south, east, north
	Supports []string
}

// DemoOrigin is a geographic pin.
type DemoOrigin struct {
	Latitude, Longitude float64
}

// DemoTravelPlan describes one travel group's corridor + timing.
type DemoTravelPlan struct {
	BaseLatitude, BaseLongitude float64
	EndLatitude, EndLongitude   float64
	StartDelaySeconds           int
	DurationMinutes             int
	SharedPath                  bool
	RegionID                    *string
	AnywhereFallback            bool
}

// RegionSelection is "anywhere" or a list of region ids.
type RegionSelection struct {
	Anywhere bool
	IDs      []string
}

// PlacementResolution is the outcome of resolveGroupPlacement.
type PlacementResolution struct {
	Base             DemoOrigin
	RegionID         *string
	AnywhereFallback bool
}

func pickOne[T any](items []T, random func() float64) T {
	if len(items) == 0 {
		var zero T
		return zero
	}
	i := int(math.Floor(random() * float64(len(items))))
	if i >= len(items) {
		i = len(items) - 1
	}
	return items[i]
}

func regionCenter(r DemoRegion) DemoOrigin {
	return DemoOrigin{
		Latitude:  (r.BBox[1] + r.BBox[3]) / 2,
		Longitude: (r.BBox[0] + r.BBox[2]) / 2,
	}
}

func clampDemoLatitude(lat float64) float64 {
	return clampF(lat, -DemoMaxAbsLatitude, DemoMaxAbsLatitude)
}

func scatterNearOrigin(origin DemoOrigin, random func() float64, radiusDeg float64) DemoOrigin {
	return DemoOrigin{
		Latitude:  clampDemoLatitude(origin.Latitude + (random()*2-1)*radiusDeg),
		Longitude: geo.NormalizeLongitude(origin.Longitude + (random()*2-1)*radiusDeg),
	}
}

func randomWorldOrigin(random func() float64) DemoOrigin {
	return DemoOrigin{
		Latitude:  clampDemoLatitude((random()*2 - 1) * 70),
		Longitude: geo.NormalizeLongitude((random()*2 - 1) * 180),
	}
}

// ResolveGroupPlacement: pin > selected regions > anywhere.
func ResolveGroupPlacement(
	category string,
	origin *DemoOrigin,
	selection RegionSelection,
	random func() float64,
	sharedPath bool,
	catalog []DemoRegion,
) PlacementResolution {
	if origin != nil {
		radius := 0.35
		if sharedPath {
			radius = 0.3
		}
		return PlacementResolution{Base: scatterNearOrigin(*origin, random, radius)}
	}
	if selection.Anywhere || len(selection.IDs) == 0 && selection.Anywhere {
		return PlacementResolution{Base: randomWorldOrigin(random)}
	}
	if !selection.Anywhere && len(selection.IDs) == 0 {
		// Empty selection list → anywhere fallback (TS behaviour).
		return PlacementResolution{Base: randomWorldOrigin(random), AnywhereFallback: true}
	}
	selectedIDs := map[string]struct{}{}
	for _, id := range selection.IDs {
		selectedIDs[id] = struct{}{}
	}
	var compatible []DemoRegion
	for _, r := range catalog {
		if _, ok := selectedIDs[r.ID]; !ok {
			continue
		}
		for _, s := range r.Supports {
			if s == category {
				compatible = append(compatible, r)
				break
			}
		}
	}
	if len(compatible) > 0 {
		region := pickOne(compatible, random)
		radius := 0.3
		if sharedPath {
			radius = 0.25
		}
		id := region.ID
		return PlacementResolution{
			Base:     scatterNearOrigin(regionCenter(region), random, radius),
			RegionID: &id,
		}
	}
	return PlacementResolution{Base: randomWorldOrigin(random), AnywhereFallback: true}
}

// ResolveTrackTiming picks delay + duration inside an optional window.
func ResolveTrackTiming(random func() float64, windowSeconds *int) (startDelaySeconds, durationMinutes int) {
	if windowSeconds != nil {
		ws := *windowSeconds
		maxDurationSeconds := int(math.Max(60, math.Floor(float64(ws)*(0.45+random()*0.5))))
		durationMinutes = int(math.Max(1, math.Floor(float64(maxDurationSeconds)/60)))
		slack := int(math.Max(0, float64(ws-durationMinutes*60)))
		if slack > 0 {
			startDelaySeconds = int(math.Floor(random() * float64(slack)))
		}
		return
	}
	return 5 + int(math.Floor(random()*90)), 25 + int(math.Floor(random()*35))
}

// BuildTravelPlans builds one plan per travel group id.
func BuildTravelPlans(
	groupIDs []int,
	categories []string,
	origin *DemoOrigin,
	random func() float64,
	windowSeconds *int,
	selection RegionSelection,
	catalog []DemoRegion,
) map[int]DemoTravelPlan {
	memberCounts := map[int]int{}
	categoryByGroup := map[int]string{}
	for i, gid := range groupIDs {
		memberCounts[gid]++
		if _, ok := categoryByGroup[gid]; !ok {
			categoryByGroup[gid] = categories[i]
		}
	}
	plans := map[int]DemoTravelPlan{}
	for gid, count := range memberCounts {
		shared := count > 1
		category := categoryByGroup[gid]
		placement := ResolveGroupPlacement(category, origin, selection, random, shared, catalog)
		delay, duration := ResolveTrackTiming(random, windowSeconds)
		heading := random() * 360
		cruise := CategoryCruiseMidpointKnots(category)
		durationHours := math.Max(float64(duration)/60, 1.0/60)
		maxNm := math.Max(2, cruise*durationHours*0.72)
		minNm := math.Min(4, maxNm*0.35)
		distanceNm := minNm + random()*math.Max(0, maxNm-minNm)
		end := geo.DestinationPoint(geo.LngLat{Lng: placement.Base.Longitude, Lat: placement.Base.Latitude}, distanceNm, heading)
		plans[gid] = DemoTravelPlan{
			BaseLatitude:      clampDemoLatitude(placement.Base.Latitude),
			BaseLongitude:     placement.Base.Longitude,
			EndLatitude:       clampDemoLatitude(end.Lat),
			EndLongitude:      end.Lng,
			StartDelaySeconds: delay,
			DurationMinutes:   duration,
			SharedPath:        shared,
			RegionID:          placement.RegionID,
			AnywhereFallback:  placement.AnywhereFallback,
		}
	}
	return plans
}

// AssignTravelGroupIds clusters same-category tracks with GROUP_JOIN_PROBABILITY.
func AssignTravelGroupIds(categories []string, random func() float64, joinProb float64) []int {
	if joinProb < 0 {
		joinProb = GroupJoinProbability
	}
	groupsByCategory := map[string][]int{}
	out := make([]int, len(categories))
	next := 0
	for i, category := range categories {
		existing := groupsByCategory[category]
		if len(existing) > 0 && random() < joinProb {
			gid := pickOne(existing, random)
			out[i] = gid
			continue
		}
		gid := next
		next++
		out[i] = gid
		groupsByCategory[category] = append(existing, gid)
	}
	return out
}

func pickDemoVehicleSubtype(category string, random func() float64) string {
	subs := vehicleSubtypes[category]
	if len(subs) == 0 {
		return category
	}
	return pickOne(subs, random)
}

func demoCallsign(index int, random func() float64) string {
	prefix := pickOne(callsignPrefixes, random)
	return fmt.Sprintf("%s-%02d", prefix, (index%90)+10)
}

func demoColor(random func() float64) string {
	return pickOne(demoColors, random)
}

func demoAircraftAltitude(random func() float64) float64 {
	return 3000 + math.Floor(random()*32000)
}

func formationOffset(random func() float64) (dLat, dLng float64) {
	return (random()*2 - 1) * 0.02, (random()*2 - 1) * 0.02
}

func atOffsetISO(startMs int64, delaySeconds int) string {
	return time.UnixMilli(startMs + int64(delaySeconds)*1000).UTC().Format(time.RFC3339Nano)
}

// SynthesizeDemoTarget builds one synthetic target + wander/A→B events.
func SynthesizeDemoTarget(
	index int,
	category, subtype string,
	plan DemoTravelPlan,
	startMs int64,
	windowSeconds *int,
	random func() float64,
	idFactory func() string,
) (scenario.TargetDefinition, []scenario.SimulationEvent) {
	if subtype == "" {
		subtype = pickDemoVehicleSubtype(category, random)
	}
	targetID := idFactory()
	pointCount := 10 + int(math.Floor(random()*15))
	var dLat, dLng float64
	if plan.SharedPath {
		dLat, dLng = formationOffset(random)
	}
	memberStagger := 0
	if plan.SharedPath {
		if windowSeconds != nil {
			maxStagger := math.Min(40, math.Max(0, float64(*windowSeconds-plan.StartDelaySeconds-60)))
			memberStagger = int(math.Floor(random() * maxStagger))
		} else {
			memberStagger = int(math.Floor(random() * 40))
		}
	}
	trackStartDelay := plan.StartDelaySeconds + memberStagger
	rawEndDelay := trackStartDelay + plan.DurationMinutes*60
	trackEndDelay := rawEndDelay
	if windowSeconds != nil {
		trackEndDelay = int(math.Max(float64(trackStartDelay+60), math.Min(float64(rawEndDelay), float64(*windowSeconds))))
	}
	alt := 0.0
	if category == "aircraft" {
		alt = demoAircraftAltitude(random)
	}
	startPoint := scenario.PositionPayload{
		Latitude:  clampDemoLatitude(plan.BaseLatitude + dLat),
		Longitude: plan.BaseLongitude + dLng,
		Altitude:  &alt,
	}
	var endPoint *scenario.PositionPayload
	if plan.SharedPath {
		endAlt := alt
		endPoint = &scenario.PositionPayload{
			Latitude:  clampDemoLatitude(plan.EndLatitude + dLat),
			Longitude: plan.EndLongitude + dLng,
			Altitude:  &endAlt,
		}
	}
	maxLat := DemoMaxAbsLatitude
	events, err := GenerateRouteEvents(GenerateRouteOptions{
		TargetID: targetID, Count: pointCount,
		StartAt:         atOffsetISO(startMs, trackStartDelay),
		EndAt:           atOffsetISO(startMs, trackEndDelay),
		StartPoint:      startPoint,
		EndPoint:        endPoint,
		VehicleCategory: category,
		MaxAbsLatitude:  &maxLat,
		Random:          random,
		IDFactory:       idFactory,
	})
	if err != nil {
		// Soft-fail: minimal two-point track
		events = []scenario.SimulationEvent{
			{ID: idFactory(), TargetID: targetID, At: atOffsetISO(startMs, trackStartDelay), Position: &startPoint},
			{ID: idFactory(), TargetID: targetID, At: atOffsetISO(startMs, trackEndDelay), Position: &startPoint},
		}
	}
	// Optional message events
	messages := []scenario.SimulationEvent{}
	if random() < 0.35 && len(events) > 0 {
		msg := pickOne(demoMessages, random)
		mid := events[len(events)/2]
		messages = append(messages, scenario.SimulationEvent{
			ID: idFactory(), TargetID: targetID, At: mid.At, Message: msg,
		})
	}
	events = MergeGeneratedEvents(events, messages)

	aff := pickOne(affiliations, random)
	st := pickOne(targetStatuses, random)
	target := scenario.TargetDefinition{
		ID:                 targetID,
		Callsign:           demoCallsign(index, random),
		RevealOnFirstEvent: true,
		AppearOnFirstEvent: true,
		Color:              demoColor(random),
		Profile: scenario.TargetProfile{
			VehicleCategory: category,
			VehicleSubtype:  subtype,
			Affiliation:     aff,
			Status:          st,
		},
	}
	return target, events
}

func demoName(selection []string, randomPick bool, targetCount int) string {
	if randomPick || len(selection) == 0 {
		return fmt.Sprintf("Random demo (%d targets)", targetCount)
	}
	if len(selection) == 1 {
		c := selection[0]
		return fmt.Sprintf("%s demo (%d targets)", strings.ToUpper(c[:1])+c[1:], targetCount)
	}
	return fmt.Sprintf("Mixed demo (%d targets)", targetCount)
}

func demoDescription(selection []string, randomPick bool, targetCount int) string {
	if randomPick || len(selection) == 0 {
		return fmt.Sprintf("Generated demonstration with %d contacts across mixed vehicle types.", targetCount)
	}
	if len(selection) == 1 {
		return fmt.Sprintf("Generated demonstration with %d %s contacts.", targetCount, selection[0])
	}
	return fmt.Sprintf("Generated demonstration with %d contacts from %s.", targetCount, strings.Join(selection, ", "))
}

func resolveCategory(selection []string, randomPick bool, random func() float64) string {
	cats := scenario.VehicleCategories
	if !randomPick && len(selection) > 0 {
		cats = selection
	}
	return pickOne(cats, random)
}
