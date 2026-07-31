// Package geo provides geographic primitives used by scenario generation.
package geo

import "math"

// LngLat is a WGS84 longitude/latitude coordinate in degrees.
type LngLat struct {
	Lng float64
	Lat float64
}

// NormalizeLongitude returns longitude in the canonical [-180, 180] range.
func NormalizeLongitude(longitude float64) float64 {
	if math.IsNaN(longitude) || math.IsInf(longitude, 0) {
		return longitude
	}
	wrapped := math.Mod(math.Mod(longitude+180, 360)+360, 360) - 180
	if wrapped == -180 {
		return 180
	}
	return wrapped
}

// ShortestLongitudeDelta returns the shortest signed delta from from to to.
// Positive values are eastward.
func ShortestLongitudeDelta(from, to float64) float64 {
	return NormalizeLongitude(to - from)
}
