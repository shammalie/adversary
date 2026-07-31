package generate

import (
	"testing"
	"time"

	"github.com/shammalie/adversary/apps/api/internal/geo"
	"github.com/shammalie/adversary/apps/api/internal/scenario"
)

func TestGenerateRouteEventsWanderDeterministic(t *testing.T) {
	random := geo.CreateSeededRandom(42)
	idFactory := geo.CreateSeededIDFactory(42)
	start := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)
	end := time.Date(2026, 7, 1, 13, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)
	events, err := GenerateRouteEvents(GenerateRouteOptions{
		TargetID: "t1", Count: 12, StartAt: start, EndAt: end,
		StartPoint:      scenario.PositionPayload{Latitude: 51.5, Longitude: -0.1},
		VehicleCategory: "car",
		Random:          random,
		IDFactory:       idFactory,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 12 {
		t.Fatalf("got %d events", len(events))
	}
	if events[0].Position == nil || events[0].Position.Speed == nil {
		t.Fatal("expected authored speed")
	}
}

func TestGenerateRouteEventsPointToPoint(t *testing.T) {
	random := geo.CreateSeededRandom(7)
	start := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)
	endPoint := scenario.PositionPayload{Latitude: 51.6, Longitude: 0.1}
	events, err := GenerateRouteEvents(GenerateRouteOptions{
		TargetID: "t1", Count: 8, StartAt: start,
		StartPoint:      scenario.PositionPayload{Latitude: 51.5, Longitude: -0.1},
		EndPoint:        &endPoint,
		VehicleCategory: "car",
		Random:          random,
		IDFactory:       geo.CreateSeededIDFactory(7),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) < 2 {
		t.Fatalf("got %d events", len(events))
	}
	last := events[len(events)-1].Position
	if last == nil {
		t.Fatal("nil last position")
	}
	if abs(last.Latitude-51.6) > 0.01 || abs(last.Longitude-0.1) > 0.01 {
		t.Fatalf("final point not snapped: %#v", last)
	}
}

func TestPlanDemoScenarioForceSynthetic(t *testing.T) {
	seed := uint32(99)
	count := 3
	result, err := PlanDemoScenario(t.Context(), PlanOptions{
		TargetCount:    &count,
		ForceSynthetic: true,
		Seed:           &seed,
		Catalogue:      Catalogue{}, // empty → synthetic
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Scenario.Targets) != 3 {
		t.Fatalf("targets=%d", len(result.Scenario.Targets))
	}
	if result.DegradedTrackCount != 3 {
		t.Fatalf("degraded=%d", result.DegradedTrackCount)
	}
	if result.Scenario.ID == "" {
		t.Fatal("missing scenario id")
	}
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}
