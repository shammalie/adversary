package geo

import (
	"testing"
	"time"
)

func TestDouglasPeuckerSimplifyKeepsCorner(t *testing.T) {
	path := []PathPoint{{Latitude: 51, Longitude: 0}, {Latitude: 51.1, Longitude: 0}, {Latitude: 51.1, Longitude: .1}, {Latitude: 51.1, Longitude: .2}}
	got := DouglasPeuckerSimplify(path, 50)
	if len(got) < 3 || got[0] != path[0] || got[len(got)-1] != path[len(path)-1] {
		t.Fatalf("simplified path=%v", got)
	}
}

func TestPathToEventsProducesSeededEvents(t *testing.T) {
	ids := CreateSeededIDFactory(42)
	events, err := PathToEvents(PathToEventsOptions{
		TargetID: "target-1", Path: []PathPoint{{Latitude: 51.5, Longitude: -.12}, {Latitude: 51.55, Longitude: -.1}, {Latitude: 51.6, Longitude: -.08}},
		StartAt: "2026-07-27T12:00:00Z", EndAt: "2026-07-27T14:00:00Z", VehicleCategory: "car", VehicleSubtype: "Sedan", IDFactory: ids,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) < 2 {
		t.Fatalf("events=%d", len(events))
	}
	if events[0].ID != "s16-0" || events[0].Position == nil {
		t.Fatalf("first=%+v", events[0])
	}
	for i, event := range events {
		if event.Position.Speed == nil || *event.Position.Speed > 85 {
			t.Fatalf("speed=%v", event.Position.Speed)
		}
		if _, err := time.Parse(time.RFC3339Nano, event.At); err != nil {
			t.Fatalf("event %d time: %v", i, err)
		}
	}
}

func TestPathToEventsRejectsImpossibleWindow(t *testing.T) {
	_, err := PathToEvents(PathToEventsOptions{
		TargetID: "target-1", Path: []PathPoint{{Latitude: 51.5, Longitude: -.1}, {Latitude: 53.5, Longitude: 3}},
		StartAt: "2026-07-27T12:00:00Z", EndAt: "2026-07-27T12:05:00Z", VehicleCategory: "car", VehicleSubtype: "Sedan",
	})
	if err == nil {
		t.Fatal("expected infeasible-window error")
	}
}
