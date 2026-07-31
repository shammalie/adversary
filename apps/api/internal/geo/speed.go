package geo

import "math"

// SpeedRange is an inclusive generation band in knots.
type SpeedRange struct{ MinKnots, MaxKnots float64 }

var CategoryTopSpeedKnots = map[string]float64{
	"aircraft": 1800, "boat": 80, "car": 130, "truck": 85, "other": 100,
}

var CategorySpeedRanges = map[string]SpeedRange{
	"aircraft": {90, 1400}, "boat": {6, 50}, "car": {10, 85}, "truck": {8, 60}, "other": {3, 55},
}

// ClampSpeedToCategory bounds invalid speeds at zero and known categories at their ceiling.
func ClampSpeedToCategory(speedKnots float64, category string) float64 {
	if math.IsNaN(speedKnots) || math.IsInf(speedKnots, 0) || speedKnots < 0 {
		return 0
	}
	if top, ok := CategoryTopSpeedKnots[category]; ok {
		return math.Min(speedKnots, top)
	}
	return speedKnots
}
