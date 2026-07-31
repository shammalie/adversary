// Package geoseed mines OpenMapTiles MBTiles into the Postgres geo catalogue
// (and optional JSON/fixture exports for the web transition).
package geoseed

import (
	"math"
	"strconv"
)

const (
	Extent      = 4096
	MinRunwayM  = 1500
	SchemaV     = 1
	reseedLockID = 0xAE50_5EED // advisory lock key for one-at-a-time reseed
)

// BBox is [west, south, east, north] in WGS84 degrees.
type BBox [4]float64

// RegionDef is a hand-picked demo region (supports are derived at mine time).
type RegionDef struct {
	ID   string
	Name string
	BBox BBox
}

// REGION_DEFS mirrors scripts/build-geo-seeds.mjs.
var REGION_DEFS = []RegionDef{
	{ID: "london", Name: "Greater London", BBox: BBox{-0.55, 51.28, 0.35, 51.72}},
	{ID: "english-channel", Name: "English Channel", BBox: BBox{-2.5, 49.5, 2.0, 51.5}},
	{ID: "north-sea", Name: "North Sea", BBox: BBox{0.5, 53.0, 8.0, 57.0}},
	{ID: "benelux", Name: "Benelux", BBox: BBox{2.5, 49.4, 7.6, 53.7}},
	{ID: "central-europe", Name: "Central Europe", BBox: BBox{5.0, 47.0, 17.0, 54.0}},
	{ID: "alps", Name: "Alpine Corridor", BBox: BBox{7.0, 45.8, 13.5, 47.8}},
	{ID: "us-midwest", Name: "US Midwest", BBox: BBox{-93.5, 39.0, -84.5, 43.5}},
	{ID: "rhine-corridor", Name: "Rhine Corridor", BBox: BBox{5.5, 48.5, 9.2, 52.2}},
	{ID: "mediterranean", Name: "Mediterranean", BBox: BBox{5.0, 33.0, 28.0, 42.0}},
	{ID: "new-york-harbor", Name: "New York Harbor", BBox: BBox{-74.35, 40.4, -73.7, 40.95}},
	{ID: "us-eastern-seaboard", Name: "US Eastern Seaboard", BBox: BBox{-78.0, 35.0, -70.0, 42.5}},
	{ID: "california-coast", Name: "California Coast", BBox: BBox{-123.0, 32.5, -117.0, 38.5}},
	{ID: "singapore-strait", Name: "Singapore Strait", BBox: BBox{103.5, 1.0, 104.5, 1.55}},
	{ID: "tokyo-bay", Name: "Tokyo Bay", BBox: BBox{139.5, 35.2, 140.15, 35.75}},
	{ID: "persian-gulf", Name: "Persian Gulf", BBox: BBox{48.0, 24.0, 56.0, 30.0}},
	{ID: "south-china-sea", Name: "South China Sea", BBox: BBox{108.0, 10.0, 120.0, 18.0}},
	{ID: "gulf-of-aden", Name: "Gulf of Aden", BBox: BBox{42.0, 10.0, 52.0, 15.0}},
}

var drivAble = map[string]struct{}{
	"motorway": {}, "trunk": {}, "primary": {}, "secondary": {},
	"tertiary": {}, "minor": {}, "service": {},
}

// LngLat is a WGS84 coordinate.
type LngLat struct {
	Lng float64
	Lat float64
}

// Aerodrome is a mined airport candidate (pre-pack).
type Aerodrome struct {
	ICAO       string
	IATA       string
	Name       string
	Class      string
	EleFt      int
	Lng        float64
	Lat        float64
	Runways    [][2]any // [ref string, hdg int]
	MaxRunwayM float64
}

// Port is a harbour / ferry terminal / ferry endpoint.
type Port struct {
	Lng  float64
	Lat  float64
	Name string
	Kind string
}

// SeaLanePoint is a coarse maritime waypoint.
type SeaLanePoint struct {
	Lng float64
	Lat float64
}

// RoadAnchor is a sample road midpoint tagged by region.
type RoadAnchor struct {
	RegionID string
	Lng      float64
	Lat      float64
}

// Region is a catalogue region with derived supports.
type Region struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	BBox     BBox     `json:"bbox"`
	Supports []string `json:"supports"`
}

// Catalogue is the mined in-memory result before DB/JSON export.
type Catalogue struct {
	Aerodromes  []Aerodrome
	Ports       []Port
	SeaLanes    []SeaLanePoint
	RoadAnchors []RoadAnchor
	Regions     []Region
}

func clampTile(v, n int) int {
	if v < 0 {
		return 0
	}
	if v > n-1 {
		return n - 1
	}
	return v
}

func lngLatToTile(lng, lat float64, z int) (x, y int) {
	n := 1 << z
	x = int(math.Floor(((lng + 180) / 360) * float64(n)))
	latRad := lat * math.Pi / 180
	y = int(math.Floor(((1 - math.Log(math.Tan(latRad)+1/math.Cos(latRad))/math.Pi) / 2) * float64(n)))
	return clampTile(x, n), clampTile(y, n)
}

func tileLocalToLngLat(z, x, y int, px, py, extent float64) (lng, lat float64) {
	n := float64(uint(1) << z)
	lng = ((float64(x) + px/extent) / n) * 360 - 180
	lat = math.Atan(math.Sinh(math.Pi*(1-(2*(float64(y)+py/extent))/n))) * 180 / math.Pi
	return lng, lat
}

func haversineM(a, b LngLat) float64 {
	const R = 6371000.0
	toRad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat := toRad(b.Lat - a.Lat)
	dLng := toRad(b.Lng - a.Lng)
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(a.Lat))*math.Cos(toRad(b.Lat))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * R * math.Asin(math.Sqrt(h))
}

func bearingDeg(a, b LngLat) float64 {
	toRad := func(d float64) float64 { return d * math.Pi / 180 }
	φ1 := toRad(a.Lat)
	φ2 := toRad(b.Lat)
	Δλ := toRad(b.Lng - a.Lng)
	y := math.Sin(Δλ) * math.Cos(φ2)
	x := math.Cos(φ1)*math.Sin(φ2) - math.Sin(φ1)*math.Cos(φ2)*math.Cos(Δλ)
	return math.Mod(math.Atan2(y, x)*180/math.Pi+360, 360)
}

func lineLengthM(coords []LngLat) float64 {
	var total float64
	for i := 1; i < len(coords); i++ {
		total += haversineM(coords[i-1], coords[i])
	}
	return total
}

func pointInBbox(lng, lat float64, bbox BBox) bool {
	return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
}

func expandBbox(bbox BBox, padDeg float64) BBox {
	return BBox{bbox[0] - padDeg, bbox[1] - padDeg, bbox[2] + padDeg, bbox[3] + padDeg}
}

func tilesCoveringBbox(bbox BBox, z int) [][2]int {
	tlX, tlY := lngLatToTile(bbox[0], bbox[3], z)
	brX, brY := lngLatToTile(bbox[2], bbox[1], z)
	out := make([][2]int, 0, (brX-tlX+1)*(brY-tlY+1))
	for x := tlX; x <= brX; x++ {
		for y := tlY; y <= brY; y++ {
			out = append(out, [2]int{x, y})
		}
	}
	return out
}

func quantizeKey(lng, lat float64, decimals int) string {
	return strconv.FormatFloat(lng, 'f', decimals, 64) + "," + strconv.FormatFloat(lat, 'f', decimals, 64)
}
