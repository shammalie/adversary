package geo

import "math"

const (
	earthRadiusNM = 3440.065
	metersPerNM   = 1852.0
)

func toRadians(degrees float64) float64 { return degrees * math.Pi / 180 }
func toDegrees(radians float64) float64 { return radians * 180 / math.Pi }

// HaversineDistanceNM returns the short-arc great-circle distance in nautical miles.
func HaversineDistanceNM(from, to LngLat) float64 {
	lat1, lat2 := toRadians(from.Lat), toRadians(to.Lat)
	dLat := toRadians(to.Lat - from.Lat)
	dLng := toRadians(ShortestLongitudeDelta(from.Lng, to.Lng))
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusNM * math.Asin(math.Min(1, math.Sqrt(a)))
}

// HaversineMeters returns the short-arc great-circle distance in metres.
func HaversineMeters(from, to LngLat) float64 {
	return HaversineDistanceNM(from, to) * metersPerNM
}

// InitialBearingDegrees returns the initial great-circle bearing in [0, 360).
func InitialBearingDegrees(from, to LngLat) float64 {
	lat1, lat2 := toRadians(from.Lat), toRadians(to.Lat)
	dLng := toRadians(ShortestLongitudeDelta(from.Lng, to.Lng))
	y := math.Sin(dLng) * math.Cos(lat2)
	x := math.Cos(lat1)*math.Sin(lat2) - math.Sin(lat1)*math.Cos(lat2)*math.Cos(dLng)
	return math.Mod(toDegrees(math.Atan2(y, x))+360, 360)
}

// DestinationPoint returns the destination after travelling distanceNM on bearingDegrees.
func DestinationPoint(origin LngLat, distanceNM, bearingDegrees float64) LngLat {
	angularDistance := distanceNM / earthRadiusNM
	bearing, lat1, lng1 := toRadians(bearingDegrees), toRadians(origin.Lat), toRadians(origin.Lng)
	lat2 := math.Asin(math.Sin(lat1)*math.Cos(angularDistance) + math.Cos(lat1)*math.Sin(angularDistance)*math.Cos(bearing))
	lng2 := lng1 + math.Atan2(math.Sin(bearing)*math.Sin(angularDistance)*math.Cos(lat1), math.Cos(angularDistance)-math.Sin(lat1)*math.Sin(lat2))
	return LngLat{Lng: NormalizeLongitude(toDegrees(lng2)), Lat: toDegrees(lat2)}
}

func MetersToNM(meters float64) float64 { return meters / metersPerNM }
func NMToMeters(nm float64) float64     { return nm * metersPerNM }

// NormalizeHeading returns heading in [0, 360).
func NormalizeHeading(heading float64) float64 {
	return math.Mod(math.Mod(heading, 360)+360, 360)
}

// ShortestHeadingDelta returns the shortest signed heading delta in [-180, 180).
func ShortestHeadingDelta(from, to float64) float64 {
	return math.Mod(math.Mod(to-from+540, 360)+360, 360) - 180
}
