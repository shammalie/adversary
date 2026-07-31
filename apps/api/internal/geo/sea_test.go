package geo

import (
	"context"
	"testing"
)

func TestIsNavigableWaterPoint(t *testing.T) {
	water := []TileFeature{{
		Type:       FeaturePolygon,
		Properties: map[string]any{"class": "ocean"},
		Polygons:   [][][]LngLat{{{{Lng: -1, Lat: -1}, {Lng: 1, Lat: -1}, {Lng: 1, Lat: 1}, {Lng: -1, Lat: 1}}}},
	}}
	if !IsNavigableWaterPoint(LngLat{}, water) {
		t.Fatal("IsNavigableWaterPoint() = false, want true for ocean polygon")
	}
	if IsNavigableWaterPoint(LngLat{Lng: 2, Lat: 2}, water) {
		t.Fatal("IsNavigableWaterPoint() = true outside ocean polygon")
	}
}

func TestRouteSea_MissingSourceFails(t *testing.T) {
	result := RouteSea(context.Background(), LngLat{}, LngLat{Lng: 1}, SeaRouteOptions{})
	if result.Ok || result.Reason != "no-navigable-route" {
		t.Fatalf("RouteSea() = %#v, want no-navigable-route failure", result)
	}
}
