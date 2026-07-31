package geoseed

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// Bundle is the columnar JSON shape consumed by the web app (geo-seeds.json).
type Bundle struct {
	V           int    `json:"v"`
	GeneratedAt string `json:"generatedAt"`
	Aerodromes  struct {
		ICAO    []string `json:"icao"`
		IATA    []string `json:"iata"`
		Name    []string `json:"name"`
		Class   []string `json:"class"`
		EleFt   []int    `json:"eleFt"`
		Lng     []float64 `json:"lng"`
		Lat     []float64 `json:"lat"`
		Runways [][][2]any `json:"runways"`
	} `json:"aerodromes"`
	Ports struct {
		Lng  []float64 `json:"lng"`
		Lat  []float64 `json:"lat"`
		Name []string  `json:"name"`
		Kind []string  `json:"kind"`
	} `json:"ports"`
	SeaLanes struct {
		Lng []float64 `json:"lng"`
		Lat []float64 `json:"lat"`
	} `json:"seaLanes"`
	RoadAnchors struct {
		RegionID []string  `json:"regionId"`
		Lng      []float64 `json:"lng"`
		Lat      []float64 `json:"lat"`
	} `json:"roadAnchors"`
	Regions []Region `json:"regions"`
}

// PackBundle converts a catalogue to the columnar JSON bundle.
func PackBundle(cat *Catalogue) Bundle {
	b := Bundle{
		V:           SchemaV,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Regions:     cat.Regions,
	}
	n := len(cat.Aerodromes)
	b.Aerodromes.ICAO = make([]string, n)
	b.Aerodromes.IATA = make([]string, n)
	b.Aerodromes.Name = make([]string, n)
	b.Aerodromes.Class = make([]string, n)
	b.Aerodromes.EleFt = make([]int, n)
	b.Aerodromes.Lng = make([]float64, n)
	b.Aerodromes.Lat = make([]float64, n)
	b.Aerodromes.Runways = make([][][2]any, n)
	for i, a := range cat.Aerodromes {
		b.Aerodromes.ICAO[i] = a.ICAO
		b.Aerodromes.IATA[i] = a.IATA
		b.Aerodromes.Name[i] = a.Name
		b.Aerodromes.Class[i] = a.Class
		b.Aerodromes.EleFt[i] = a.EleFt
		b.Aerodromes.Lng[i] = a.Lng
		b.Aerodromes.Lat[i] = a.Lat
		b.Aerodromes.Runways[i] = a.Runways
	}
	np := len(cat.Ports)
	b.Ports.Lng = make([]float64, np)
	b.Ports.Lat = make([]float64, np)
	b.Ports.Name = make([]string, np)
	b.Ports.Kind = make([]string, np)
	for i, p := range cat.Ports {
		b.Ports.Lng[i] = p.Lng
		b.Ports.Lat[i] = p.Lat
		b.Ports.Name[i] = p.Name
		b.Ports.Kind[i] = p.Kind
	}
	ns := len(cat.SeaLanes)
	b.SeaLanes.Lng = make([]float64, ns)
	b.SeaLanes.Lat = make([]float64, ns)
	for i, p := range cat.SeaLanes {
		b.SeaLanes.Lng[i] = p.Lng
		b.SeaLanes.Lat[i] = p.Lat
	}
	nr := len(cat.RoadAnchors)
	b.RoadAnchors.RegionID = make([]string, nr)
	b.RoadAnchors.Lng = make([]float64, nr)
	b.RoadAnchors.Lat = make([]float64, nr)
	for i, a := range cat.RoadAnchors {
		b.RoadAnchors.RegionID[i] = a.RegionID
		b.RoadAnchors.Lng[i] = a.Lng
		b.RoadAnchors.Lat[i] = a.Lat
	}
	return b
}

// WriteJSON writes the columnar bundle to path.
func WriteJSON(path string, cat *Catalogue) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b := PackBundle(cat)
	data, err := json.Marshal(b)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// FixtureSpec describes a small PBF tile exported for web terrain tests.
type FixtureSpec struct {
	ID     string
	Z, X, Y int
	Layers []string
}

// DefaultFixtureSpecs matches scripts/build-geo-seeds.mjs writeFixtures.
func DefaultFixtureSpecs() []FixtureSpec {
	oceanX, oceanY := lngLatToTile(-40, 30, 9)
	lonX, lonY := lngLatToTile(-0.1278, 51.5074, 10)
	doverX, doverY := lngLatToTile(1.3, 51.12, 10)
	return []FixtureSpec{
		{ID: "ocean-z9", Z: 9, X: oceanX, Y: oceanY, Layers: []string{"water"}},
		{ID: "london-z10", Z: 10, X: lonX, Y: lonY, Layers: []string{"water", "transportation"}},
		{ID: "dover-z10", Z: 10, X: doverX, Y: doverY, Layers: []string{"water", "transportation"}},
	}
}

// WriteFixtures extracts small PBF tiles for web unit tests.
func WriteFixtures(mb *MBTiles, dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	type manifestEntry struct {
		ID     string   `json:"id"`
		File   string   `json:"file"`
		Z      int      `json:"z"`
		X      int      `json:"x"`
		Y      int      `json:"y"`
		Layers []string `json:"layers"`
	}
	manifest := []manifestEntry{}
	for _, s := range DefaultFixtureSpecs() {
		buf, err := mb.ReadTile(s.Z, s.X, s.Y)
		if err != nil {
			return err
		}
		if buf == nil {
			continue
		}
		file := s.ID + "-" + itoa(s.Z) + "-" + itoa(s.X) + "-" + itoa(s.Y) + ".pbf"
		if err := os.WriteFile(filepath.Join(dir, file), buf, 0o644); err != nil {
			return err
		}
		manifest = append(manifest, manifestEntry{
			ID: s.ID, File: file, Z: s.Z, X: s.X, Y: s.Y, Layers: s.Layers,
		})
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(filepath.Join(dir, "manifest.json"), data, 0o644)
}

func itoa(n int) string {
	return strconv.Itoa(n)
}
