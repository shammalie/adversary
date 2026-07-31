package generate

import (
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"

	"github.com/shammalie/adversary/apps/api/internal/geo"
	"github.com/shammalie/adversary/apps/api/internal/scenario"
)

// MaxGeneratedEvents mirrors the TS event-generator cap.
const MaxGeneratedEvents = 500

type movementSmoothing struct {
	maxHeadingChange       float64
	maxSpeedChangeFraction float64
}

var categoryMovementSmoothing = map[string]movementSmoothing{
	"aircraft": {4, 0.06},
	"boat":     {7, 0.08},
	"car":      {14, 0.16},
	"truck":    {12, 0.12},
	"other":    {15, 0.18},
}

// GenerateRouteOptions configures synthetic wander / point-to-point tracks.
type GenerateRouteOptions struct {
	TargetID        string
	Count           int
	StartAt         string
	EndAt           string
	StartPoint      scenario.PositionPayload
	EndPoint        *scenario.PositionPayload
	VehicleCategory string
	MaxAbsLatitude  *float64
	Random          func() float64
	IDFactory       func() string
}

func clampF(v, lo, hi float64) float64 { return math.Min(hi, math.Max(lo, v)) }

func sampleSpeed(category string, random func() float64) float64 {
	r := geo.CategorySpeedRanges[category]
	return r.MinKnots + random()*(r.MaxKnots-r.MinKnots)
}

func updateSpeed(category string, previous float64, random func() float64) float64 {
	r := geo.CategorySpeedRanges[category]
	s := categoryMovementSmoothing[category]
	maximumChange := (r.MaxKnots - r.MinKnots) * s.maxSpeedChangeFraction
	change := (random()*2 - 1) * maximumChange
	return clampF(previous+change, r.MinKnots, r.MaxKnots)
}

func distributeTimestamps(startMs, endMs int64, count int) []int64 {
	if count <= 1 {
		return []int64{startMs}
	}
	span := endMs - startMs
	if span < 1 {
		span = 1
	}
	out := make([]int64, count)
	for i := 0; i < count; i++ {
		out[i] = startMs + int64(math.Round(float64(span)*float64(i)/float64(count-1)))
	}
	return out
}

// CategoryCruiseMidpointKnots is the category band midpoint.
func CategoryCruiseMidpointKnots(category string) float64 {
	r := geo.CategorySpeedRanges[category]
	return (r.MinKnots + r.MaxKnots) / 2
}

// DeriveEndAtFromDistance computes endAt from cruise pace + 8% slack.
func DeriveEndAtFromDistance(startAt string, start, end geo.LngLat, category string, cruiseKnots float64) (string, error) {
	startMs, err := parseTimeMs(startAt)
	if err != nil {
		return "", err
	}
	distanceNm := geo.HaversineDistanceNM(start, end)
	if distanceNm < 0.001 {
		return "", fmt.Errorf("end point must be distinct from the start point")
	}
	if cruiseKnots <= 0 || math.IsNaN(cruiseKnots) {
		cruiseKnots = CategoryCruiseMidpointKnots(category)
	}
	durationMs := math.Max((distanceNm/math.Max(cruiseKnots, 0.1))*3_600_000*1.08, 1_000)
	return time.UnixMilli(startMs + int64(durationMs)).UTC().Format(time.RFC3339Nano), nil
}

func resolveRouteEndAt(o GenerateRouteOptions) (string, error) {
	if t := trim(o.EndAt); t != "" {
		return t, nil
	}
	if o.EndPoint == nil {
		return "", fmt.Errorf("end time must be after start time")
	}
	return DeriveEndAtFromDistance(
		o.StartAt,
		geo.LngLat{Lng: o.StartPoint.Longitude, Lat: o.StartPoint.Latitude},
		geo.LngLat{Lng: o.EndPoint.Longitude, Lat: o.EndPoint.Latitude},
		o.VehicleCategory,
		0,
	)
}

const latitudeTurnBufferDeg = 5

func steerHeadingForLatitudeBound(lat, heading float64, maxAbs *float64, maxHeadingChange float64) float64 {
	if maxAbs == nil {
		return heading
	}
	bound := math.Min(math.Abs(*maxAbs), 90)
	absLat := math.Abs(lat)
	bufferStart := bound - latitudeTurnBufferDeg
	if absLat < bufferStart {
		return heading
	}
	northComponent := math.Cos(heading * math.Pi / 180)
	headingTowardPole := (lat >= 0 && northComponent > 0.02) || (lat < 0 && northComponent < -0.02)
	if !headingTowardPole && absLat < bound {
		return heading
	}
	urgency := clampF((absLat-bufferStart)/latitudeTurnBufferDeg, 0, 1)
	eastish := math.Sin(heading*math.Pi/180) >= 0
	var target float64
	if lat >= 0 {
		if eastish {
			target = 90 + 45*urgency
		} else {
			target = 270 - 45*urgency
		}
	} else {
		if eastish {
			target = 90 - 45*urgency
		} else {
			target = 270 + 45*urgency
		}
	}
	delta := geo.ShortestHeadingDelta(heading, target)
	maxTurn := maxHeadingChange * (0.75 + urgency*1.25)
	return geo.NormalizeHeading(heading + clampF(delta, -maxTurn, maxTurn))
}

func applyLatitudeBound(point geo.LngLat, heading float64, maxAbs *float64, maxHeadingChange float64) (geo.LngLat, float64) {
	if maxAbs == nil {
		return point, heading
	}
	bound := math.Min(math.Abs(*maxAbs), 90)
	if math.Abs(point.Lat) <= bound {
		return point, steerHeadingForLatitudeBound(point.Lat, heading, maxAbs, maxHeadingChange)
	}
	clamped := geo.LngLat{Lng: point.Lng, Lat: clampF(point.Lat, -bound, bound)}
	return clamped, steerHeadingForLatitudeBound(clamped.Lat, heading, maxAbs, maxHeadingChange)
}

func clampLatitude(lat float64, maxAbs *float64) float64 {
	if maxAbs == nil {
		return lat
	}
	bound := math.Min(math.Abs(*maxAbs), 90)
	return clampF(lat, -bound, bound)
}

func parseTimeMs(iso string) (int64, error) {
	t, err := time.Parse(time.RFC3339Nano, iso)
	if err != nil {
		t, err = time.Parse(time.RFC3339, iso)
	}
	if err != nil {
		return 0, fmt.Errorf("enter a valid start time")
	}
	return t.UTC().UnixMilli(), nil
}

func trim(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}

func defaultIDFactory() func() string {
	return func() string { return uuid.NewString() }
}

func defaultRandom() func() float64 {
	return geo.CreateSeededRandom(uint32(time.Now().UnixNano()))
}

// GenerateRouteEvents builds a synthetic geodesic track (wander or A→B).
func GenerateRouteEvents(o GenerateRouteOptions) ([]scenario.SimulationEvent, error) {
	random := o.Random
	if random == nil {
		random = defaultRandom()
	}
	idFactory := o.IDFactory
	if idFactory == nil {
		idFactory = defaultIDFactory()
	}
	count := int(clampF(float64(o.Count), 1, MaxGeneratedEvents))
	startMs, err := parseTimeMs(o.StartAt)
	if err != nil {
		return nil, err
	}
	endAt, err := resolveRouteEndAt(o)
	if err != nil {
		return nil, err
	}
	endMs, err := parseTimeMs(endAt)
	if err != nil || endMs <= startMs {
		return nil, fmt.Errorf("end time must be after start time")
	}
	if o.EndPoint != nil {
		return generatePointToPoint(o, startMs, endMs, count, random, idFactory)
	}
	return generateWander(o, startMs, endMs, count, random, idFactory), nil
}

func generateWander(o GenerateRouteOptions, startMs, endMs int64, count int, random func() float64, idFactory func() string) []scenario.SimulationEvent {
	timestamps := distributeTimestamps(startMs, endMs, count)
	heading := random() * 360
	speed := sampleSpeed(o.VehicleCategory, random)
	current := o.StartPoint
	current.Latitude = clampLatitude(current.Latitude, o.MaxAbsLatitude)
	smoothing := categoryMovementSmoothing[o.VehicleCategory]
	events := make([]scenario.SimulationEvent, 0, count)
	for i := 0; i < count; i++ {
		if i > 0 {
			prevAt := timestamps[i-1]
			curAt := timestamps[i]
			elapsedHours := math.Max(float64(curAt-prevAt)/3_600_000, 1.0/3600)
			speed = updateSpeed(o.VehicleCategory, speed, random)
			distanceNm := speed * elapsedHours
			heading = geo.NormalizeHeading(heading + (random()*2-1)*smoothing.maxHeadingChange)
			heading = steerHeadingForLatitudeBound(current.Latitude, heading, o.MaxAbsLatitude, smoothing.maxHeadingChange)
			next := geo.DestinationPoint(geo.LngLat{Lng: current.Longitude, Lat: current.Latitude}, distanceNm, heading)
			bounded, h := applyLatitudeBound(next, heading, o.MaxAbsLatitude, smoothing.maxHeadingChange)
			heading = h
			current.Latitude = bounded.Lat
			current.Longitude = bounded.Lng
		}
		spd := speed
		events = append(events, scenario.SimulationEvent{
			ID: idFactory(), TargetID: o.TargetID,
			At: time.UnixMilli(timestamps[i]).UTC().Format(time.RFC3339Nano),
			Position: &scenario.PositionPayload{
				Latitude: round6(current.Latitude), Longitude: round6(current.Longitude),
				Altitude: current.Altitude, Speed: ptrRound1(spd),
			},
		})
	}
	return events
}

func generatePointToPoint(o GenerateRouteOptions, startMs, endMs int64, count int, random func() float64, idFactory func() string) ([]scenario.SimulationEvent, error) {
	start := o.StartPoint
	start.Latitude = clampLatitude(start.Latitude, o.MaxAbsLatitude)
	end := *o.EndPoint
	end.Latitude = clampLatitude(end.Latitude, o.MaxAbsLatitude)
	startLL := geo.LngLat{Lng: start.Longitude, Lat: start.Latitude}
	endLL := geo.LngLat{Lng: end.Longitude, Lat: end.Latitude}
	distanceNm := geo.HaversineDistanceNM(startLL, endLL)
	if distanceNm < 0.001 {
		return nil, fmt.Errorf("end point must be distinct from the start point")
	}
	elapsedHours := float64(endMs-startMs) / 3_600_000
	required := distanceNm / elapsedHours
	maxKnots := geo.CategorySpeedRanges[o.VehicleCategory].MaxKnots
	if required > maxKnots {
		return nil, fmt.Errorf("route requires about %.0f kt average, above the %s maximum of %.0f kt", required, o.VehicleCategory, maxKnots)
	}

	timestamps := distributeTimestamps(startMs, endMs, count)
	r := geo.CategorySpeedRanges[o.VehicleCategory]
	smoothing := categoryMovementSmoothing[o.VehicleCategory]
	totalHours := math.Max(elapsedHours, 1.0/3600)
	speed := clampF(distanceNm/totalHours, r.MinKnots, r.MaxKnots)
	current := start
	events := make([]scenario.SimulationEvent, 0, count)
	lastIndex := count - 1
	const arrivalEpsilonNm = 0.05

	for i := 0; i < count; i++ {
		progress := 1.0
		if lastIndex > 0 {
			progress = float64(i) / float64(lastIndex)
		}
		altitude := lerpAlt(start.Altitude, end.Altitude, progress)
		if i == 0 {
			events = append(events, scenario.SimulationEvent{
				ID: idFactory(), TargetID: o.TargetID,
				At: time.UnixMilli(timestamps[0]).UTC().Format(time.RFC3339Nano),
				Position: &scenario.PositionPayload{
					Latitude: round6(start.Latitude), Longitude: round6(start.Longitude),
					Altitude: altitude, Speed: ptrRound1(speed),
				},
			})
			continue
		}
		prevAt, curAt := timestamps[i-1], timestamps[i]
		elapsedH := math.Max(float64(curAt-prevAt)/3_600_000, 1.0/3600)
		curLL := geo.LngLat{Lng: current.Longitude, Lat: current.Latitude}
		remaining := geo.HaversineDistanceNM(curLL, endLL)
		if i == lastIndex || remaining <= arrivalEpsilonNm {
			geom := remaining / elapsedH
			if geom > maxKnots+1 {
				return nil, fmt.Errorf("final leg requires %.0f kt, above the %s maximum of %.0f kt", geom, o.VehicleCategory, maxKnots)
			}
			speed = clampF(geom, 0, maxKnots)
			current.Latitude, current.Longitude = end.Latitude, end.Longitude
			alt := altitude
			if end.Altitude != nil {
				alt = end.Altitude
			}
			events = append(events, scenario.SimulationEvent{
				ID: idFactory(), TargetID: o.TargetID,
				At: time.UnixMilli(timestamps[i]).UTC().Format(time.RFC3339Nano),
				Position: &scenario.PositionPayload{
					Latitude: round6(current.Latitude), Longitude: round6(current.Longitude),
					Altitude: alt, Speed: ptrRound1(speed),
				},
			})
			break
		}
		hoursLeftFromPrev := math.Max(float64(endMs-prevAt)/3_600_000, 1.0/3600)
		hoursLeftAfter := math.Max(float64(endMs-curAt)/3_600_000, 1.0/3600)
		idealStep := remaining * (elapsedH / hoursLeftFromPrev)
		maxLeave := maxKnots * hoursLeftAfter
		minStep := math.Max(0, remaining-maxLeave)
		maxStep := math.Max(0, remaining-arrivalEpsilonNm)
		noise := (random()*2 - 1) * smoothing.maxSpeedChangeFraction
		step := clampF(idealStep*(1+noise), minStep, maxStep)
		speed = clampF(step/elapsedH, 0, maxKnots)
		step = math.Min(speed*elapsedH, maxStep)
		desired := geo.InitialBearingDegrees(curLL, endLL)
		heading := geo.NormalizeHeading(desired + (random()*2-1)*smoothing.maxHeadingChange)
		heading = steerHeadingForLatitudeBound(current.Latitude, heading, o.MaxAbsLatitude, smoothing.maxHeadingChange)
		next := geo.DestinationPoint(curLL, step, heading)
		if remaining-geo.HaversineDistanceNM(next, endLL) < step*0.5 {
			heading = steerHeadingForLatitudeBound(current.Latitude, desired, o.MaxAbsLatitude, smoothing.maxHeadingChange)
			next = geo.DestinationPoint(curLL, step, heading)
		}
		bounded, h := applyLatitudeBound(next, heading, o.MaxAbsLatitude, smoothing.maxHeadingChange)
		_ = h
		speed = clampF(geo.HaversineDistanceNM(curLL, bounded)/elapsedH, 0, maxKnots)
		current.Latitude, current.Longitude = bounded.Lat, bounded.Lng
		events = append(events, scenario.SimulationEvent{
			ID: idFactory(), TargetID: o.TargetID,
			At: time.UnixMilli(timestamps[i]).UTC().Format(time.RFC3339Nano),
			Position: &scenario.PositionPayload{
				Latitude: round6(current.Latitude), Longitude: round6(current.Longitude),
				Altitude: altitude, Speed: ptrRound1(speed),
			},
		})
	}
	return events, nil
}

func lerpAlt(start, end *float64, progress float64) *float64 {
	from := 0.0
	if start != nil {
		from = *start
	}
	to := from
	if end != nil {
		to = *end
	}
	v := from + (to-from)*progress
	return &v
}

func round6(v float64) float64 { return math.Round(v*1e6) / 1e6 }
func ptrRound1(v float64) *float64 {
	x := math.Round(v*10) / 10
	return &x
}

// MergeGeneratedEvents sorts and merges event slices by time then id.
func MergeGeneratedEvents(existing, generated []scenario.SimulationEvent) []scenario.SimulationEvent {
	out := append(append([]scenario.SimulationEvent{}, existing...), generated...)
	// insertion sort is fine for demo sizes
	for i := 1; i < len(out); i++ {
		j := i
		for j > 0 {
			ai, bi := out[j-1], out[j]
			ta, _ := parseTimeMs(ai.At)
			tb, _ := parseTimeMs(bi.At)
			if ta < tb || (ta == tb && ai.ID <= bi.ID) {
				break
			}
			out[j-1], out[j] = out[j], out[j-1]
			j--
		}
	}
	return out
}
