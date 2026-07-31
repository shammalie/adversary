package geo

import (
	"math"
	"testing"
)

func TestHaversineDistanceNMAntimeridian(t *testing.T) {
	got := HaversineDistanceNM(LngLat{Lng: 170}, LngLat{Lng: -170})
	if got < 1100 || got > 1300 {
		t.Fatalf("distance=%f, want short arc around 1200nm", got)
	}
	if bearing := InitialBearingDegrees(LngLat{Lng: 170}, LngLat{Lng: -170}); bearing < 80 || bearing > 100 {
		t.Fatalf("bearing=%f, want east", bearing)
	}
}

func TestDestinationPointNormalizesLongitude(t *testing.T) {
	got := DestinationPoint(LngLat{Lng: 170}, 600, 90)
	if math.Abs(math.Abs(got.Lng)-180) > 3 {
		t.Fatalf("longitude=%f, want near antimeridian", got.Lng)
	}
}

func TestHeadingHelpers(t *testing.T) {
	if NormalizeHeading(-10) != 350 {
		t.Fatal("expected normalized heading")
	}
	if ShortestHeadingDelta(350, 10) != 20 {
		t.Fatal("expected shortest eastward delta")
	}
}
