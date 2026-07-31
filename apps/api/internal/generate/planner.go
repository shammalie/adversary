package generate

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/shammalie/adversary/apps/api/internal/geo"
	"github.com/shammalie/adversary/apps/api/internal/scenario"
)

const (
	defaultConcurrency = 5
	routeTimeout       = 12 * time.Second
)

// PlanOptions configures demo / random scenario generation.
type PlanOptions struct {
	VehicleSelection []string // empty / nil → random mix
	TargetCount      *int
	StartAt          string
	EndAt            string
	Origin           *DemoOrigin
	Regions          RegionSelection
	Seed             *uint32
	ForceSynthetic   bool
	Concurrency      int
	Catalogue        Catalogue
	TileSource       geo.FeatureSource // nil → surface routes degrade to synthetic
	Progress         func(done, total int, message string)
}

// PlanResult is the outcome of PlanDemoScenario.
type PlanResult struct {
	Scenario              scenario.SimulationScenario
	DegradedTrackCount    int
	AnywhereFallbackCount int
	Cancelled             bool
	CatalogueEmpty        bool
	UsedSynthetic         bool
}

// PlanDemoScenario ports scenario-planner.ts with soft-fail synthetic degradation.
func PlanDemoScenario(ctx context.Context, o PlanOptions) (PlanResult, error) {
	random := func() float64 { return geo.CreateSeededRandom(uint32(time.Now().UnixNano()))() }
	idFactory := defaultIDFactory()
	if o.Seed != nil {
		random = geo.CreateSeededRandom(*o.Seed)
		idFactory = geo.CreateSeededIDFactory(*o.Seed)
	}

	randomPick := len(o.VehicleSelection) == 0
	targetCount := 2 + int(math.Floor(random()*99))
	if o.TargetCount != nil {
		targetCount = int(clampF(float64(*o.TargetCount), MinDemoTargets, MaxDemoTargets))
	}

	now := time.Now().UTC().UnixMilli()
	startMs := now
	if o.StartAt != "" {
		if ms, err := parseTimeMs(o.StartAt); err == nil {
			startMs = ms
		}
	}
	var windowSeconds *int
	if o.EndAt != "" {
		if endMs, err := parseTimeMs(o.EndAt); err == nil && endMs > startMs {
			ws := int((endMs - startMs) / 1000)
			windowSeconds = &ws
		}
	}

	selection := o.Regions
	if !selection.Anywhere && len(selection.IDs) == 0 {
		selection = RegionSelection{Anywhere: true}
	}

	catalogueEmpty := o.Catalogue.IsEmpty()
	forceSynthetic := o.ForceSynthetic || catalogueEmpty || o.TileSource == nil

	categories := make([]string, targetCount)
	subtypes := make([]string, targetCount)
	for i := 0; i < targetCount; i++ {
		categories[i] = resolveCategory(o.VehicleSelection, randomPick, random)
		subtypes[i] = pickDemoVehicleSubtype(categories[i], random)
	}
	groupIDs := AssignTravelGroupIds(categories, random, GroupJoinProbability)
	plans := BuildTravelPlans(groupIDs, categories, o.Origin, random, windowSeconds, selection, o.Catalogue.Regions)

	type trackOut struct {
		index            int
		target           scenario.TargetDefinition
		events           []scenario.SimulationEvent
		degraded         bool
		anywhereFallback bool
	}

	concurrency := o.Concurrency
	if concurrency <= 0 {
		concurrency = defaultConcurrency
	}
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	outCh := make(chan trackOut, targetCount)

	report := func(done, total int, msg string) {
		if o.Progress != nil {
			o.Progress(done, total, msg)
		}
	}

	var doneCount int
	var doneMu sync.Mutex

	for i := 0; i < targetCount; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case <-ctx.Done():
				return
			case sem <- struct{}{}:
			}
			defer func() { <-sem }()

			plan := plans[groupIDs[i]]
			category, subtype := categories[i], subtypes[i]
			degraded := false
			anywhere := plan.AnywhereFallback

			var target scenario.TargetDefinition
			var events []scenario.SimulationEvent

			if forceSynthetic {
				target, events = SynthesizeDemoTarget(i, category, subtype, plan, startMs, windowSeconds, random, idFactory)
				degraded = true
			} else {
				routed, deg, err := planTrack(ctx, i, category, subtype, plan, startMs, windowSeconds, random, idFactory, o)
				if err != nil || deg {
					target, events = SynthesizeDemoTarget(i, category, subtype, plan, startMs, windowSeconds, random, idFactory)
					degraded = true
				} else {
					target, events = routed.target, routed.events
				}
			}

			outCh <- trackOut{index: i, target: target, events: events, degraded: degraded, anywhereFallback: anywhere}
			doneMu.Lock()
			doneCount++
			d := doneCount
			doneMu.Unlock()
			report(d, targetCount, fmt.Sprintf("planned %d/%d", d, targetCount))
		}()
	}

	go func() {
		wg.Wait()
		close(outCh)
	}()

	targets := make([]scenario.TargetDefinition, targetCount)
	var allEvents []scenario.SimulationEvent
	degradedCount, anywhereCount := 0, 0
	received := 0
	for t := range outCh {
		received++
		targets[t.index] = t.target
		allEvents = append(allEvents, t.events...)
		if t.degraded {
			degradedCount++
		}
		if t.anywhereFallback {
			anywhereCount++
		}
	}
	if ctx.Err() != nil {
		return PlanResult{Cancelled: true, CatalogueEmpty: catalogueEmpty, UsedSynthetic: forceSynthetic}, ctx.Err()
	}
	if received < targetCount {
		return PlanResult{Cancelled: true, CatalogueEmpty: catalogueEmpty, UsedSynthetic: forceSynthetic}, context.Canceled
	}

	allEvents = MergeGeneratedEvents(nil, allEvents)
	// Scenario primary key is a Postgres UUID; keep seeded ids for targets/events only.
	id := uuid.NewString()
	nowISO := time.UnixMilli(startMs).UTC().Format(time.RFC3339Nano)
	name := demoName(o.VehicleSelection, randomPick, targetCount)
	sc := scenario.SimulationScenario{
		SchemaVersion: 2,
		ID:            id,
		Name:          name,
		Description:   demoDescription(o.VehicleSelection, randomPick, targetCount),
		CreatedAt:     nowISO,
		UpdatedAt:     nowISO,
		PriorityTerms: []string{},
		Targets:       targets,
		Events:        allEvents,
	}
	return PlanResult{
		Scenario:              sc,
		DegradedTrackCount:    degradedCount,
		AnywhereFallbackCount: anywhereCount,
		CatalogueEmpty:        catalogueEmpty,
		UsedSynthetic:         forceSynthetic || degradedCount > 0,
	}, nil
}

type routedTrack struct {
	target scenario.TargetDefinition
	events []scenario.SimulationEvent
}

func planTrack(
	ctx context.Context,
	index int,
	category, subtype string,
	plan DemoTravelPlan,
	startMs int64,
	windowSeconds *int,
	random func() float64,
	idFactory func() string,
	o PlanOptions,
) (routedTrack, bool, error) {
	trackStart := atOffsetISO(startMs, plan.StartDelaySeconds)
	trackEndDelay := plan.StartDelaySeconds + plan.DurationMinutes*60
	if windowSeconds != nil {
		trackEndDelay = int(math.Max(float64(plan.StartDelaySeconds+60), math.Min(float64(trackEndDelay), float64(*windowSeconds))))
	}
	trackEnd := atOffsetISO(startMs, trackEndDelay)
	durationHours := math.Max(float64(plan.DurationMinutes)/60, 1.0/60)

	cruise := geo.ResolveGenerationCruiseKnots(category, subtype, nil)

	origin := geo.LngLat{Lng: plan.BaseLongitude, Lat: plan.BaseLatitude}
	destination := geo.LngLat{Lng: plan.EndLongitude, Lat: plan.EndLatitude}
	mode := resolveRouteMode(category, plan.RegionID, o.Catalogue)

	rctx, cancel := context.WithTimeout(ctx, routeTimeout)
	defer cancel()

	var path []geo.PathPoint
	switch mode {
	case "air":
		profile := geo.ResolveVehicleProfile(category, subtype)
		kin := geo.KinematicsFromProfile(profile)
		kin.CruiseKnots = cruise
		var bbox *[4]float64
		if plan.RegionID != nil {
			if r := o.Catalogue.RegionByID(*plan.RegionID); r != nil {
				b := r.BBox
				bbox = &b
			}
		}
		res := geo.PlanAirRoute(geo.PlanAirRouteOptions{
			Aerodromes:  o.Catalogue.Aerodromes,
			BBox:        bbox,
			WindowHours: durationHours,
			Kinematics:  kin,
			Random:      random,
		})
		if !res.Ok {
			return routedTrack{}, true, fmt.Errorf("%s", res.Message)
		}
		for _, p := range res.Path {
			alt := p.AltitudeFt
			path = append(path, geo.PathPoint{Latitude: p.Lat, Longitude: p.Lng, Altitude: &alt})
		}
	case "sea":
		if o.TileSource == nil {
			return routedTrack{}, true, fmt.Errorf("no tile source")
		}
		res := geo.RouteSea(rctx, origin, destination, geo.SeaRouteOptions{
			Source: o.TileSource,
			Seeds:  geo.SeaSeeds{Ports: o.Catalogue.Ports, SeaLanes: o.Catalogue.SeaLanes},
		})
		if !res.Ok {
			return routedTrack{}, true, fmt.Errorf("%s", res.Message)
		}
		for _, p := range res.Coordinates {
			alt := 0.0
			path = append(path, geo.PathPoint{Latitude: p.Lat, Longitude: p.Lng, Altitude: &alt})
		}
	default: // road
		if o.TileSource == nil {
			return routedTrack{}, true, fmt.Errorf("no tile source")
		}
		vehicle := geo.RoadCar
		if category == "truck" {
			vehicle = geo.RoadTruck
		}
		res := geo.RouteRoad(rctx, origin, destination, geo.RoadRouteOptions{
			Source: o.TileSource, Vehicle: vehicle, Mode: geo.RoadHierarchical,
		})
		if !res.Ok {
			return routedTrack{}, true, fmt.Errorf("%s", res.Message)
		}
		for _, p := range res.Coordinates {
			alt := 0.0
			path = append(path, geo.PathPoint{Latitude: p.Lat, Longitude: p.Lng, Altitude: &alt})
		}
	}
	if len(path) < 2 {
		return routedTrack{}, true, fmt.Errorf("empty path")
	}

	targetID := idFactory()
	events, err := geo.PathToEvents(geo.PathToEventsOptions{
		TargetID:        targetID,
		Path:            path,
		StartAt:         trackStart,
		EndAt:           trackEnd,
		VehicleCategory: category,
		VehicleSubtype:  subtype,
		CruiseKnots:     &cruise,
		IDFactory:       idFactory,
	})
	if err != nil {
		return routedTrack{}, true, err
	}

	aff := pickOne(affiliations, random)
	st := pickOne(targetStatuses, random)
	target := scenario.TargetDefinition{
		ID: targetID, Callsign: demoCallsign(index, random),
		RevealOnFirstEvent: true, AppearOnFirstEvent: true,
		Color: demoColor(random),
		Profile: scenario.TargetProfile{
			VehicleCategory: category, VehicleSubtype: subtype,
			Affiliation: aff, Status: st,
		},
	}
	_ = startMs
	_ = windowSeconds
	return routedTrack{target: target, events: events}, false, nil
}

func resolveRouteMode(category string, regionID *string, cat Catalogue) string {
	switch category {
	case "aircraft":
		return "air"
	case "boat":
		return "sea"
	case "car", "truck":
		return "road"
	case "other":
		if regionID != nil {
			if r := cat.RegionByID(*regionID); r != nil {
				hasBoat, hasRoad := false, false
				for _, s := range r.Supports {
					if s == "boat" {
						hasBoat = true
					}
					if s == "car" || s == "truck" {
						hasRoad = true
					}
				}
				if hasBoat && !hasRoad {
					return "sea"
				}
			}
		}
		return "road"
	default:
		return "road"
	}
}

// PlanTargetRouteOptions configures single-target authentic routing.
type PlanTargetRouteOptions struct {
	Target     scenario.TargetDefinition
	Regions    RegionSelection
	StartAt    string
	EndAt      string
	EventCount int
	Catalogue  Catalogue
	TileSource geo.FeatureSource
	Seed       *uint32
}

// PlanTargetRouteResult is the single-target planner outcome.
type PlanTargetRouteResult struct {
	Events           []scenario.SimulationEvent
	Degraded         bool
	AnywhereFallback bool
	RegionID         *string
}

// PlanTargetRouteEvents ports plan-target-events.ts (soft-fail → synthetic).
func PlanTargetRouteEvents(ctx context.Context, o PlanTargetRouteOptions) (PlanTargetRouteResult, error) {
	random := geo.CreateSeededRandom(uint32(time.Now().UnixNano()))
	idFactory := defaultIDFactory()
	if o.Seed != nil {
		random = geo.CreateSeededRandom(*o.Seed)
		idFactory = geo.CreateSeededIDFactory(*o.Seed)
	}
	count := int(clampF(float64(o.EventCount), 1, MaxGeneratedEvents))
	category := o.Target.Profile.VehicleCategory
	subtype := o.Target.Profile.VehicleSubtype

	selection := o.Regions
	if !selection.Anywhere && len(selection.IDs) == 0 {
		selection = RegionSelection{Anywhere: true}
	}
	placement := ResolveGroupPlacement(category, nil, selection, random, false, o.Catalogue.Regions)

	startMs, err := parseTimeMs(o.StartAt)
	if err != nil {
		return PlanTargetRouteResult{}, err
	}
	endAt := trim(o.EndAt)
	if endAt == "" {
		endAt = time.UnixMilli(startMs + 60*60_000).UTC().Format(time.RFC3339Nano)
	}
	endMs, err := parseTimeMs(endAt)
	if err != nil || endMs <= startMs {
		return PlanTargetRouteResult{}, fmt.Errorf("end time must be after start time")
	}
	durationMinutes := int(math.Max(1, math.Floor(float64(endMs-startMs)/60_000)))
	cruise := geo.ResolveGenerationCruiseKnots(category, subtype, o.Target.MaxCruiseKnots)
	durationHours := math.Max(float64(durationMinutes)/60, 1.0/60)
	maxNm := math.Max(2, cruise*durationHours*0.72)
	minNm := math.Min(4, maxNm*0.35)
	distanceNm := minNm + random()*math.Max(0, maxNm-minNm)
	heading := random() * 360
	end := geo.DestinationPoint(geo.LngLat{Lng: placement.Base.Longitude, Lat: placement.Base.Latitude}, distanceNm, heading)
	origin := DemoOrigin{Latitude: clampDemoLatitude(placement.Base.Latitude), Longitude: placement.Base.Longitude}
	destination := DemoOrigin{Latitude: clampDemoLatitude(end.Lat), Longitude: end.Lng}

	fallback := func() PlanTargetRouteResult {
		alt := 0.0
		if category == "aircraft" {
			alt = 8000
		}
		events, _ := GenerateRouteEvents(GenerateRouteOptions{
			TargetID: o.Target.ID, Count: count, StartAt: o.StartAt, EndAt: endAt,
			StartPoint: scenario.PositionPayload{
				Latitude: origin.Latitude, Longitude: origin.Longitude, Altitude: &alt,
			},
			VehicleCategory: category, Random: random, IDFactory: idFactory,
		})
		return PlanTargetRouteResult{
			Events: events, Degraded: true,
			AnywhereFallback: placement.AnywhereFallback, RegionID: placement.RegionID,
		}
	}

	forceSynthetic := o.Catalogue.IsEmpty() || (o.TileSource == nil && category != "aircraft")
	if forceSynthetic {
		return fallback(), nil
	}

	plan := DemoTravelPlan{
		BaseLatitude: origin.Latitude, BaseLongitude: origin.Longitude,
		EndLatitude: destination.Latitude, EndLongitude: destination.Longitude,
		StartDelaySeconds: 0, DurationMinutes: durationMinutes,
		RegionID: placement.RegionID, AnywhereFallback: placement.AnywhereFallback,
	}
	windowSec := int((endMs - startMs) / 1000)
	routed, deg, err := planTrack(ctx, 0, category, subtype, plan, startMs, &windowSec, random, idFactory, PlanOptions{
		Catalogue: o.Catalogue, TileSource: o.TileSource,
	})
	if err != nil || deg {
		return fallback(), nil
	}
	for i := range routed.events {
		routed.events[i].TargetID = o.Target.ID
	}
	// Cap / expand toward requested count is handled inside PathToEvents; if short, keep.
	_ = count
	return PlanTargetRouteResult{
		Events: routed.events, Degraded: false,
		AnywhereFallback: placement.AnywhereFallback, RegionID: placement.RegionID,
	}, nil
}

// NewScenarioID returns a fresh UUID string (for callers that need one before planning).
func NewScenarioID() string { return uuid.NewString() }
