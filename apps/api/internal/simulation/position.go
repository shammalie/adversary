package simulation

import (
	"math"
	"time"

	"github.com/shammalie/adversary/apps/api/internal/scenario"
)

const earthRadiusNm = 3440.065

var categoryTopSpeedKnots = map[string]float64{
	"aircraft": 1800,
	"boat":     80,
	"car":      130,
	"truck":    85,
	"other":    100,
}

func normalizeLongitude(longitude float64) float64 {
	if math.IsNaN(longitude) || math.IsInf(longitude, 0) {
		return longitude
	}
	wrapped := math.Mod(math.Mod(longitude+180, 360)+360, 360) - 180
	if wrapped == -180 {
		return 180
	}
	return wrapped
}

func shortestLongitudeDelta(from, to float64) float64 {
	return normalizeLongitude(to - from)
}

func toRadians(degrees float64) float64 { return degrees * math.Pi / 180 }
func toDegrees(radians float64) float64 { return radians * 180 / math.Pi }

func haversineDistanceNm(fromLat, fromLng, toLat, toLng float64) float64 {
	lat1 := toRadians(fromLat)
	lat2 := toRadians(toLat)
	deltaLat := toRadians(toLat - fromLat)
	deltaLng := toRadians(shortestLongitudeDelta(fromLng, toLng))
	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(deltaLng/2)*math.Sin(deltaLng/2)
	return 2 * earthRadiusNm * math.Asin(math.Min(1, math.Sqrt(a)))
}

func initialBearingDegrees(fromLat, fromLng, toLat, toLng float64) float64 {
	lat1 := toRadians(fromLat)
	lat2 := toRadians(toLat)
	deltaLng := toRadians(shortestLongitudeDelta(fromLng, toLng))
	y := math.Sin(deltaLng) * math.Cos(lat2)
	x := math.Cos(lat1)*math.Sin(lat2) - math.Sin(lat1)*math.Cos(lat2)*math.Cos(deltaLng)
	return math.Mod(toDegrees(math.Atan2(y, x))+360, 360)
}

func clampSpeedToCategory(speedKnots float64, category string) float64 {
	if math.IsNaN(speedKnots) || math.IsInf(speedKnots, 0) || speedKnots < 0 {
		return 0
	}
	top, ok := categoryTopSpeedKnots[category]
	if !ok {
		return speedKnots
	}
	return math.Min(speedKnots, top)
}

// DerivePositionSnapshot ports apps/web derivePositionSnapshot.
func DerivePositionSnapshot(
	current scenario.PositionPayload,
	at string,
	previous *PositionSnapshot,
	vehicleCategory string,
) PositionSnapshot {
	altitude := 0.0
	if current.Altitude != nil {
		altitude = *current.Altitude
	} else if previous != nil {
		altitude = previous.Altitude
	}

	var authoredSpeed *float64
	if current.Speed != nil && !math.IsNaN(*current.Speed) && !math.IsInf(*current.Speed, 0) {
		v := math.Round(*current.Speed*10) / 10
		authoredSpeed = &v
	}

	if previous == nil {
		speed := 0.0
		if authoredSpeed != nil {
			speed = *authoredSpeed
		}
		return PositionSnapshot{
			Latitude:  current.Latitude,
			Longitude: current.Longitude,
			Altitude:  altitude,
			Speed:     speed,
			Heading:   0,
			Course:    0,
			At:        at,
		}
	}

	prevMs := parseMillis(previous.At)
	currMs := parseMillis(at)
	elapsedHours := math.Max(float64(currMs-prevMs)/3_600_000, 0)
	distanceNm := haversineDistanceNm(previous.Latitude, previous.Longitude, current.Latitude, current.Longitude)
	bearing := initialBearingDegrees(previous.Latitude, previous.Longitude, current.Latitude, current.Longitude)
	derivedSpeed := 0.0
	if elapsedHours > 0 {
		derivedSpeed = distanceNm / elapsedHours
	}
	speedIn := derivedSpeed
	if authoredSpeed != nil {
		speedIn = *authoredSpeed
	}
	speed := clampSpeedToCategory(speedIn, vehicleCategory)
	bearingRounded := math.Round(bearing*10) / 10

	return PositionSnapshot{
		Latitude:  current.Latitude,
		Longitude: current.Longitude,
		Altitude:  altitude,
		Speed:     math.Round(speed*10) / 10,
		Heading:   bearingRounded,
		Course:    bearingRounded,
		At:        at,
	}
}

func parseMillis(iso string) int64 {
	if t, err := time.Parse(time.RFC3339Nano, iso); err == nil {
		return t.UTC().UnixMilli()
	}
	if t, err := time.Parse(time.RFC3339, iso); err == nil {
		return t.UTC().UnixMilli()
	}
	return 0
}
