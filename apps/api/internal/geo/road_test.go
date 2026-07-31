package geo

import (
	"context"
	"testing"
)

func TestQuantizeRoadKey(t *testing.T) {
	point := LngLat{Lng: 1.2345678, Lat: 2.3456789}
	if got, want := QuantizeRoadKey(point), "1.23457,2.34568"; got != want {
		t.Fatalf("QuantizeRoadKey() = %q, want %q", got, want)
	}
}

func TestBuildRoadGraph_ClassAndOnewayFilter(t *testing.T) {
	features := []TileFeature{
		{Type: FeatureLine, Properties: map[string]any{"class": "path"}, Lines: [][]LngLat{{{Lng: 0, Lat: 0}, {Lng: 1, Lat: 0}}}},
		{Type: FeatureLine, Properties: map[string]any{"class": "primary", "oneway": "yes"}, Lines: [][]LngLat{{{Lng: 0, Lat: 0}, {Lng: 0, Lat: 1}}}},
	}
	graph := BuildRoadGraph(features, RoadCar, true)
	from, to := QuantizeRoadKey(LngLat{}), QuantizeRoadKey(LngLat{Lat: 1})
	if len(graph.Adj[from]) != 1 || graph.Adj[from][0].To != to {
		t.Fatalf("forward edges = %#v", graph.Adj[from])
	}
	if len(graph.Adj[to]) != 0 {
		t.Fatalf("reverse oneway edges = %#v", graph.Adj[to])
	}
}

func TestRouteRoad_MissingSourceFails(t *testing.T) {
	result := RouteRoad(context.Background(), LngLat{}, LngLat{Lng: 1}, RoadRouteOptions{})
	if result.Ok || result.Reason != "no-graph" {
		t.Fatalf("RouteRoad() = %#v, want no-graph failure", result)
	}
}
