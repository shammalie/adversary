package geoseed

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

func TestRegionDefsCount(t *testing.T) {
	if len(REGION_DEFS) != 17 {
		t.Fatalf("REGION_DEFS len=%d want 17", len(REGION_DEFS))
	}
}

func TestLngLatToTileLondon(t *testing.T) {
	x, y := lngLatToTile(-0.1278, 51.5074, 10)
	if x != 511 {
		t.Fatalf("x=%d want 511", x)
	}
	if y < 339 || y > 340 {
		t.Fatalf("y=%d want 339 or 340", y)
	}
}

func TestBearingAndHaversine(t *testing.T) {
	a := LngLat{0, 0}
	b := LngLat{0, 1}
	d := haversineM(a, b)
	if math.Abs(d-111195) > 500 {
		t.Fatalf("haversine ~111km got %f", d)
	}
	hdg := bearingDeg(a, b)
	if math.Abs(hdg-0) > 1 && math.Abs(hdg-360) > 1 {
		t.Fatalf("bearing north got %f", hdg)
	}
}

func TestPointInBboxAndExpand(t *testing.T) {
	b := BBox{-1, 50, 1, 52}
	if !pointInBbox(0, 51, b) {
		t.Fatal("expected inside")
	}
	if pointInBbox(2, 51, b) {
		t.Fatal("expected outside")
	}
	e := expandBbox(b, 0.5)
	if e[0] != -1.5 || e[2] != 1.5 {
		t.Fatalf("expand=%v", e)
	}
}

func TestPackBundleCounts(t *testing.T) {
	cat := &Catalogue{
		Aerodromes:  []Aerodrome{{ICAO: "EGLL", IATA: "LHR", Lng: -0.45, Lat: 51.47}},
		Ports:       []Port{{Lng: 0, Lat: 51, Kind: "harbor"}},
		SeaLanes:    []SeaLanePoint{{Lng: 0, Lat: 50}},
		RoadAnchors: []RoadAnchor{{RegionID: "london", Lng: 0, Lat: 51}},
		Regions: []Region{{
			ID: "london", Name: "Greater London",
			BBox:     BBox{-0.55, 51.28, 0.35, 51.72},
			Supports: []string{"aircraft", "car"},
		}},
	}
	b := PackBundle(cat)
	if b.V != 1 {
		t.Fatalf("v=%d", b.V)
	}
	if len(b.Aerodromes.ICAO) != 1 || b.Aerodromes.ICAO[0] != "EGLL" {
		t.Fatalf("aerodromes=%v", b.Aerodromes.ICAO)
	}
	if len(b.Regions) != 1 {
		t.Fatalf("regions=%d", len(b.Regions))
	}
}

func TestGoldenCountsFromCommittedJSON(t *testing.T) {
	path := "../../../../apps/web/public/geo-seeds.json"
	data, err := os.ReadFile(path)
	if err != nil {
		t.Skip("geo-seeds.json not available:", err)
	}
	var raw struct {
		Aerodromes struct {
			ICAO []string `json:"icao"`
		} `json:"aerodromes"`
		Ports struct {
			Lng []float64 `json:"lng"`
		} `json:"ports"`
		SeaLanes struct {
			Lng []float64 `json:"lng"`
		} `json:"seaLanes"`
		RoadAnchors struct {
			Lng []float64 `json:"lng"`
		} `json:"roadAnchors"`
		Regions []Region `json:"regions"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	if len(raw.Aerodromes.ICAO) < 2000 || len(raw.Aerodromes.ICAO) > 3000 {
		t.Fatalf("aerodromes golden range: %d", len(raw.Aerodromes.ICAO))
	}
	if len(raw.Ports.Lng) < 5000 || len(raw.Ports.Lng) > 10000 {
		t.Fatalf("ports golden range: %d", len(raw.Ports.Lng))
	}
	if len(raw.Regions) != 17 {
		t.Fatalf("regions=%d", len(raw.Regions))
	}
	for _, r := range raw.Regions {
		if r.ID != "us-midwest" {
			continue
		}
		for _, s := range r.Supports {
			if s == "boat" {
				t.Fatal("us-midwest should not support boat")
			}
		}
	}
}

func TestDecodeFixturePBF(t *testing.T) {
	path := "../../../../apps/web/src/lib/geo/fixtures/tiles/ocean-z9-9-199-211.pbf"
	buf, err := os.ReadFile(path)
	if err != nil {
		t.Skip(err)
	}
	feats, err := decodeLayer(buf, 9, 199, 211, "water")
	if err != nil {
		t.Fatal(err)
	}
	if len(feats) == 0 {
		t.Fatal("expected water features in ocean fixture")
	}
	ocean := 0
	for _, f := range feats {
		if propString(f.Properties, "class") == "ocean" {
			ocean++
		}
	}
	if ocean == 0 {
		t.Fatal("expected ocean class in mid-atlantic fixture")
	}
}
