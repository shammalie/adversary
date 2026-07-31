package geo

import (
	"context"
	"math"
)

// FeatureType is the geometry family decoded from an OpenMapTiles feature.
type FeatureType uint8

const (
	FeatureUnknown FeatureType = iota
	FeaturePoint
	FeatureLine
	FeaturePolygon
)

// TileFeature is the small decoded-feature contract required by geo routers.
// Lines are LineString coordinate sequences; Polygons contains rings with the
// exterior ring first and any following rings treated as holes.
type TileFeature struct {
	Type       FeatureType
	Properties map[string]any
	Lines      [][]LngLat
	Polygons   [][][]LngLat
}

// FeatureSource supplies decoded vector-tile layers. Implementations may read
// MBTiles, PostGIS, or fixtures; routers deliberately do not know which.
type FeatureSource interface {
	LayerFeatures(ctx context.Context, z, x, y int, layer string) ([]TileFeature, error)
}

// NavigableWaterClasses are polygon classes open to the sea-grid router.
var NavigableWaterClasses = map[string]struct{}{
	"ocean": {},
	"lake":  {},
	"dock":  {},
}

// TerrainClassification describes the water class below a point.
type TerrainClassification struct {
	WaterClass       string
	IsWater          bool
	IsNavigableWater bool
}

// PointInRing reports whether a point is inside an open or closed linear ring.
func PointInRing(point LngLat, ring []LngLat) bool {
	if len(ring) < 3 {
		return false
	}
	inside := false
	for i, j := 0, len(ring)-1; i < len(ring); j, i = i, i+1 {
		a, b := ring[i], ring[j]
		if (a.Lat > point.Lat) == (b.Lat > point.Lat) {
			continue
		}
		atLng := (b.Lng-a.Lng)*(point.Lat-a.Lat)/(b.Lat-a.Lat) + a.Lng
		if point.Lng < atLng {
			inside = !inside
		}
	}
	return inside
}

// PointInPolygon applies the OpenMapTiles convention: ring zero is exterior
// and subsequent rings are holes.
func PointInPolygon(point LngLat, rings [][]LngLat) bool {
	if len(rings) == 0 || !PointInRing(point, rings[0]) {
		return false
	}
	for _, hole := range rings[1:] {
		if PointInRing(point, hole) {
			return false
		}
	}
	return true
}

func featureClass(feature TileFeature) string {
	if feature.Properties == nil {
		return ""
	}
	class, _ := feature.Properties["class"].(string)
	return class
}

func waterClassRank(class string) int {
	switch class {
	case "ocean":
		return 4
	case "lake":
		return 3
	case "dock":
		return 2
	case "river":
		return 1
	default:
		return 0
	}
}

// WaterClassAtPoint returns the highest-ranked containing water polygon.
func WaterClassAtPoint(point LngLat, waterFeatures []TileFeature) string {
	best := ""
	for _, feature := range waterFeatures {
		if feature.Type != FeaturePolygon {
			continue
		}
		for _, polygon := range feature.Polygons {
			if PointInPolygon(point, polygon) && waterClassRank(featureClass(feature)) > waterClassRank(best) {
				best = featureClass(feature)
			}
		}
	}
	return best
}

// IsNavigableWaterPoint reports whether point lies in ocean, lake, or dock.
func IsNavigableWaterPoint(point LngLat, waterFeatures []TileFeature) bool {
	_, ok := NavigableWaterClasses[WaterClassAtPoint(point, waterFeatures)]
	return ok
}

// ClassifyPoint queries the containing water tile and classifies point.
func ClassifyPoint(ctx context.Context, source FeatureSource, point LngLat, waterZoom int) (TerrainClassification, error) {
	if waterZoom == 0 {
		waterZoom = 9
	}
	x, y := lngLatToTile(point, waterZoom)
	features, err := source.LayerFeatures(ctx, waterZoom, x, y, "water")
	if err != nil {
		return TerrainClassification{}, err
	}
	class := WaterClassAtPoint(point, features)
	_, navigable := NavigableWaterClasses[class]
	return TerrainClassification{
		WaterClass:       class,
		IsWater:          class != "",
		IsNavigableWater: navigable,
	}, nil
}

func lngLatToTile(point LngLat, zoom int) (int, int) {
	n := 1 << zoom
	x := int(math.Floor((point.Lng + 180) / 360 * float64(n)))
	lat := math.Max(-85.05112878, math.Min(85.05112878, point.Lat)) * math.Pi / 180
	y := int(math.Floor((1 - math.Log(math.Tan(lat)+1/math.Cos(lat))/math.Pi) / 2 * float64(n)))
	return max(0, min(n-1, x)), max(0, min(n-1, y))
}
