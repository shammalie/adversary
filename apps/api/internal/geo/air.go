package geo

import (
	"fmt"
	"math"
)

// AerodromeRunway is a runway reference and its heading in degrees.
type AerodromeRunway struct {
	Ref        string
	HeadingDeg float64
}

// Aerodrome is a seed-only airport candidate.
type Aerodrome struct {
	ICAO, IATA, Name, Class string
	ElevationFt             float64
	Position                LngLat
	Runways                 []AerodromeRunway
}

// AirPathPoint carries an air-route coordinate and MSL altitude.
type AirPathPoint struct {
	LngLat
	AltitudeFt float64
}

type AirLoiterPattern string

const (
	AirLoiterRacetrack AirLoiterPattern = "racetrack"
	AirLoiterOrbit     AirLoiterPattern = "orbit"
)

// AirKinematics contains the profile fields needed to compose geometry.
type AirKinematics struct {
	CruiseKnots, ClimbRateFtPerMin, DescentRateFtPerMin, TurnRadiusM, TypicalFlightLevelFt float64
	CanLoiter, ReturnsToBase                                                               bool
}

// PlanAirRouteOptions configures seed-only route composition.
type PlanAirRouteOptions struct {
	Aerodromes          []Aerodrome
	BBox                *[4]float64 // west, south, east, north
	WindowHours         float64
	Kinematics          AirKinematics
	ReturnToBase        *bool
	Loiter              AirLoiterPattern
	DisableLoiter       bool
	Origin, Destination *Aerodrome
	Random              func() float64
}

// AirRouteResult soft-fails rather than panicking for unavailable geography.
type AirRouteResult struct {
	Ok                         bool
	Reason, Message            string
	Path                       []AirPathPoint
	Origin, Destination        *Aerodrome
	ReturnToBase               bool
	Loiter                     AirLoiterPattern
	CruiseAltitudeFt, LengthNM float64
}

const (
	airWindowFill = 0.9
	minPatternNM  = 2.0
	maxPatternNM  = 8.0
)

func airFail(reason, message string) AirRouteResult {
	return AirRouteResult{Reason: reason, Message: message}
}

func inAirBBox(a Aerodrome, bbox *[4]float64) bool {
	return bbox == nil || (a.Position.Lng >= bbox[0] && a.Position.Lng <= bbox[2] &&
		a.Position.Lat >= bbox[1] && a.Position.Lat <= bbox[3])
}

func sameAerodrome(a, b Aerodrome) bool {
	return math.Abs(a.Position.Lng-b.Position.Lng) < 1e-5 && math.Abs(a.Position.Lat-b.Position.Lat) < 1e-5
}

func selectRunwayHeading(a Aerodrome, desired float64) float64 {
	best, bestDelta := 0.0, math.Inf(1)
	runways := a.Runways
	if len(runways) == 0 {
		runways = []AerodromeRunway{{Ref: "north", HeadingDeg: 0}}
	}
	for _, runway := range runways {
		for _, heading := range []float64{NormalizeHeading(runway.HeadingDeg), NormalizeHeading(runway.HeadingDeg + 180)} {
			if delta := math.Abs(ShortestHeadingDelta(heading, desired)); delta < bestDelta {
				best, bestDelta = heading, delta
			}
		}
	}
	return best
}

func cruiseAltitudeForDistance(distanceNM, typicalFt float64) float64 {
	if typicalFt <= 0 {
		return 0
	}
	if distanceNM < 20 {
		return math.Min(typicalFt, math.Max(1500, math.Round(typicalFt*.25)))
	}
	if distanceNM < 80 {
		return math.Min(typicalFt, math.Max(5000, math.Round(typicalFt*.55)))
	}
	return typicalFt
}

func appendAirPoint(path []AirPathPoint, next AirPathPoint) []AirPathPoint {
	if len(path) > 0 {
		last := path[len(path)-1]
		if HaversineDistanceNM(last.LngLat, next.LngLat) < 1e-6 && math.Abs(last.AltitudeFt-next.AltitudeFt) < .05 {
			return path
		}
	}
	return append(path, next)
}

func sampleGreatCircle(from, to LngLat, altitude, stepNM float64) []AirPathPoint {
	dist := HaversineDistanceNM(from, to)
	if dist < 1e-4 {
		return []AirPathPoint{{LngLat: from, AltitudeFt: altitude}}
	}
	steps := max(1, int(math.Ceil(dist/stepNM)))
	heading := InitialBearingDegrees(from, to)
	out := make([]AirPathPoint, 0, steps+1)
	for i := range steps + 1 {
		t := float64(i) / float64(steps)
		point := DestinationPoint(from, dist*t, heading)
		if i == steps {
			point = to
		}
		out = append(out, AirPathPoint{LngLat: point, AltitudeFt: altitude})
	}
	return out
}

// BuildRacetrack creates a closed right-turn holding pattern.
func BuildRacetrack(entry LngLat, inboundHeading, turnRadiusM, altitudeFt float64) []AirPathPoint {
	radius := math.Max(MetersToNM(turnRadiusM), .15)
	leg := math.Max(radius*5, 3)
	path := []AirPathPoint{{LngLat: entry, AltitudeFt: altitudeFt}}
	heading := NormalizeHeading(inboundHeading)
	for legNo := range 2 {
		end := DestinationPoint(path[len(path)-1].LngLat, leg, heading)
		path = appendAirPoint(path, AirPathPoint{LngLat: end, AltitudeFt: altitudeFt})
		centre := DestinationPoint(end, radius, NormalizeHeading(heading+90))
		startBearing := NormalizeHeading(heading - 90)
		for i := 1; i <= 12; i++ {
			path = appendAirPoint(path, AirPathPoint{
				LngLat:     DestinationPoint(centre, radius, NormalizeHeading(startBearing-float64(i)*15)),
				AltitudeFt: altitudeFt,
			})
		}
		if legNo == 0 {
			heading = NormalizeHeading(heading + 180)
		}
	}
	return appendAirPoint(path, AirPathPoint{LngLat: entry, AltitudeFt: altitudeFt})
}

// BuildOrbit creates a closed circular holding pattern.
func BuildOrbit(centre LngLat, radiusM, turnRadiusM, altitudeFt, startBearing float64) []AirPathPoint {
	radius := MetersToNM(math.Max(radiusM, turnRadiusM))
	out := make([]AirPathPoint, 0, 25)
	for i := 0; i <= 24; i++ {
		out = append(out, AirPathPoint{
			LngLat:     DestinationPoint(centre, radius, NormalizeHeading(startBearing+float64(i)*15)),
			AltitudeFt: altitudeFt,
		})
	}
	return out
}

func pathLengthNM(path []AirPathPoint) float64 {
	var total float64
	for i := 1; i < len(path); i++ {
		total += HaversineDistanceNM(path[i-1].LngLat, path[i].LngLat)
	}
	return total
}

func annotateAltitude(path []AirPathPoint, originFt, destinationFt, cruiseFt float64) {
	total := pathLengthNM(path)
	if len(path) == 0 || total == 0 {
		return
	}
	var walked float64
	for i := range path {
		if i > 0 {
			walked += HaversineDistanceNM(path[i-1].LngLat, path[i].LngLat)
		}
		t := walked / total
		switch {
		case t < .15:
			path[i].AltitudeFt = originFt + (cruiseFt-originFt)*(t/.15)
		case t > .85:
			path[i].AltitudeFt = cruiseFt + (destinationFt-cruiseFt)*((t-.85)/.15)
		default:
			path[i].AltitudeFt = cruiseFt
		}
	}
	path[0].AltitudeFt, path[len(path)-1].AltitudeFt = originFt, destinationFt
}

func composePointToPoint(origin, destination Aerodrome, kin AirKinematics, altitude float64, loiter AirLoiterPattern) []AirPathPoint {
	toward := InitialBearingDegrees(origin.Position, destination.Position)
	departureHeading := selectRunwayHeading(origin, toward)
	arrivalHeading := selectRunwayHeading(destination, NormalizeHeading(InitialBearingDegrees(destination.Position, origin.Position)+180))
	departureEnd := DestinationPoint(origin.Position, minPatternNM, departureHeading)
	approachFix := DestinationPoint(destination.Position, minPatternNM, NormalizeHeading(arrivalHeading+180))
	path := []AirPathPoint{{LngLat: origin.Position, AltitudeFt: origin.ElevationFt}}
	for _, point := range sampleGreatCircle(origin.Position, departureEnd, altitude, 1) {
		path = appendAirPoint(path, point)
	}
	mid := DestinationPoint(departureEnd, HaversineDistanceNM(departureEnd, approachFix)*.45, InitialBearingDegrees(departureEnd, approachFix))
	for _, point := range sampleGreatCircle(departureEnd, mid, altitude, 25) {
		path = appendAirPoint(path, point)
	}
	if loiter != "" && HaversineDistanceNM(departureEnd, approachFix) > 1 {
		var pattern []AirPathPoint
		if loiter == AirLoiterOrbit {
			pattern = BuildOrbit(mid, kin.TurnRadiusM, kin.TurnRadiusM, altitude, InitialBearingDegrees(mid, approachFix))
		} else {
			pattern = BuildRacetrack(mid, InitialBearingDegrees(mid, approachFix), kin.TurnRadiusM, altitude)
		}
		for _, point := range pattern {
			path = appendAirPoint(path, point)
		}
		mid = path[len(path)-1].LngLat
	}
	for _, point := range sampleGreatCircle(mid, approachFix, altitude, 25) {
		path = appendAirPoint(path, point)
	}
	for _, point := range sampleGreatCircle(approachFix, destination.Position, altitude, 1) {
		path = appendAirPoint(path, point)
	}
	annotateAltitude(path, origin.ElevationFt, destination.ElevationFt, altitude)
	return path
}

func composeRTB(field Aerodrome, kin AirKinematics, altitude float64, loiter AirLoiterPattern, random func() float64) []AirPathPoint {
	heading := selectRunwayHeading(field, random()*360)
	outbound := DestinationPoint(field.Position, math.Max(12, MetersToNM(kin.TurnRadiusM)*6+4), heading)
	path := []AirPathPoint{{LngLat: field.Position, AltitudeFt: field.ElevationFt}}
	for _, p := range sampleGreatCircle(field.Position, outbound, altitude, 5) {
		path = appendAirPoint(path, p)
	}
	var pattern []AirPathPoint
	if loiter == AirLoiterOrbit {
		pattern = BuildOrbit(outbound, kin.TurnRadiusM, kin.TurnRadiusM, altitude, heading)
	} else {
		pattern = BuildRacetrack(outbound, heading, kin.TurnRadiusM, altitude)
	}
	for _, p := range pattern {
		path = appendAirPoint(path, p)
	}
	for _, p := range sampleGreatCircle(path[len(path)-1].LngLat, field.Position, altitude, 10) {
		path = appendAirPoint(path, p)
	}
	annotateAltitude(path, field.ElevationFt, field.ElevationFt, altitude)
	return path
}

// PlanAirRoute composes a seed-only point-to-point or return-to-base route.
func PlanAirRoute(options PlanAirRouteOptions) AirRouteResult {
	random := options.Random
	if random == nil {
		random = func() float64 { return .5 }
	}
	pool := make([]Aerodrome, 0, len(options.Aerodromes))
	for _, aerodrome := range options.Aerodromes {
		if inAirBBox(aerodrome, options.BBox) {
			pool = append(pool, aerodrome)
		}
	}
	if len(pool) == 0 {
		return airFail("no-aerodromes-in-region", "no aerodromes available in the requested region")
	}
	wantRTB := options.Kinematics.ReturnsToBase && (options.ReturnToBase == nil && random() < .35 || options.ReturnToBase != nil && *options.ReturnToBase)
	loiter := options.Loiter
	if options.DisableLoiter {
		loiter = ""
	} else if loiter == "" && options.Kinematics.CanLoiter {
		loiter = AirLoiterRacetrack
	}
	if wantRTB {
		field := pool[0]
		if options.Origin != nil {
			field = *options.Origin
		}
		if loiter == "" {
			loiter = AirLoiterRacetrack
		}
		altitude := cruiseAltitudeForDistance(40, options.Kinematics.TypicalFlightLevelFt)
		path := composeRTB(field, options.Kinematics, altitude, loiter, random)
		length := pathLengthNM(path)
		if options.Kinematics.CruiseKnots <= 0 || length/options.Kinematics.CruiseKnots > options.WindowHours*airWindowFill {
			return airFail("insufficient-window", fmt.Sprintf("return-to-base pattern exceeds %.1f hour window", options.WindowHours))
		}
		return AirRouteResult{Ok: true, Path: path, Origin: &field, Destination: &field, ReturnToBase: true, Loiter: loiter, CruiseAltitudeFt: altitude, LengthNM: length}
	}
	origin := pool[0]
	if options.Origin != nil {
		origin = *options.Origin
	}
	maxNM := options.Kinematics.CruiseKnots * options.WindowHours * airWindowFill
	var destination *Aerodrome
	if options.Destination != nil {
		if distance := HaversineDistanceNM(origin.Position, options.Destination.Position); !sameAerodrome(origin, *options.Destination) && distance >= 5 && distance <= maxNM*.85 {
			copy := *options.Destination
			destination = &copy
		}
	} else {
		for _, candidate := range pool {
			distance := HaversineDistanceNM(origin.Position, candidate.Position)
			if !sameAerodrome(origin, candidate) && distance >= 5 && distance <= maxNM*.85 {
				copy := candidate
				destination = &copy
				break
			}
		}
	}
	if destination == nil {
		return airFail("no-suitable-pair", fmt.Sprintf("no destination aerodrome within %.0f nm", maxNM))
	}
	altitude := cruiseAltitudeForDistance(HaversineDistanceNM(origin.Position, destination.Position), options.Kinematics.TypicalFlightLevelFt)
	path := composePointToPoint(origin, *destination, options.Kinematics, altitude, loiter)
	length := pathLengthNM(path)
	if options.Kinematics.CruiseKnots <= 0 || length/options.Kinematics.CruiseKnots > options.WindowHours*airWindowFill {
		return airFail("insufficient-window", fmt.Sprintf("route exceeds %.1f hour window", options.WindowHours))
	}
	return AirRouteResult{Ok: true, Path: path, Origin: &origin, Destination: destination, Loiter: loiter, CruiseAltitudeFt: altitude, LengthNM: length}
}
