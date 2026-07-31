package geo

import (
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/shammalie/adversary/apps/api/internal/scenario"
)

const (
	PathEventBudgetMin = 60
	PathEventBudgetMax = 150
	maxGeneratedEvents = 500
	minSegmentNM       = 1e-6
	turnSpeedFloor     = .35
)

type PathPoint struct {
	Latitude, Longitude float64
	Altitude            *float64
}
type PathToEventsOptions struct {
	TargetID                        string
	Path                            []PathPoint
	StartAt                         string
	EndAt                           string
	VehicleCategory, VehicleSubtype string
	CruiseKnots                     *float64
	IDFactory                       func() string
	EventCount                      *int
	RetimeToWindow                  *bool
}
type walkedPoint struct {
	PathPoint
	speed, cumulative float64
}

func clamp(v, low, high float64) float64 { return math.Min(high, math.Max(low, v)) }
func PerpendicularDistanceMeters(p, a, b PathPoint) float64 {
	lat0 := (a.Latitude + b.Latitude) / 2
	c := math.Cos(toRadians(lat0))
	px, py := p.Longitude*111320*c, p.Latitude*111320
	ax, ay := a.Longitude*111320*c, a.Latitude*111320
	bx, by := b.Longitude*111320*c, b.Latitude*111320
	dx, dy := bx-ax, by-ay
	l := dx*dx + dy*dy
	if l < 1e-6 {
		return math.Hypot(px-ax, py-ay)
	}
	t := clamp(((px-ax)*dx+(py-ay)*dy)/l, 0, 1)
	return math.Hypot(px-(ax+t*dx), py-(ay+t*dy))
}

// DouglasPeuckerSimplify removes vertices within toleranceM of their segment.
func DouglasPeuckerSimplify(points []PathPoint, toleranceM float64) []PathPoint {
	if len(points) <= 2 {
		return append([]PathPoint(nil), points...)
	}
	keep := make([]bool, len(points))
	keep[0], keep[len(points)-1] = true, true
	stack := [][2]int{{0, len(points) - 1}}
	for len(stack) > 0 {
		s := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		maxD, maxI := 0.0, s[0]
		for i := s[0] + 1; i < s[1]; i++ {
			d := PerpendicularDistanceMeters(points[i], points[s[0]], points[s[1]])
			if d > maxD {
				maxD, maxI = d, i
			}
		}
		if maxD > toleranceM && maxI > s[0] && maxI < s[1] {
			keep[maxI] = true
			if maxI-s[0] > 1 {
				stack = append(stack, [2]int{s[0], maxI})
			}
			if s[1]-maxI > 1 {
				stack = append(stack, [2]int{maxI, s[1]})
			}
		}
	}
	out := make([]PathPoint, 0, len(points))
	for i, p := range points {
		if keep[i] {
			out = append(out, p)
		}
	}
	return out
}

// SimplifyToEventBudget finds a Douglas-Peucker tolerance that preserves the event budget.
func SimplifyToEventBudget(points []PathPoint, minCount, maxCount int) []PathPoint {
	if len(points) <= 2 {
		return append([]PathPoint(nil), points...)
	}
	if len(points) <= maxCount {
		return DouglasPeuckerSimplify(points, 1)
	}
	lo, hi := 0.0, 50000.0
	best := DouglasPeuckerSimplify(points, hi)
	for i := 0; i < 28; i++ {
		mid := (lo + hi) / 2
		s := DouglasPeuckerSimplify(points, mid)
		if len(s) > maxCount {
			lo = mid
		} else {
			hi = mid
			best = s
		}
	}
	if len(best) < minCount {
		rlo, rhi := 0.0, hi
		for i := 0; i < 24; i++ {
			mid := (rlo + rhi) / 2
			s := DouglasPeuckerSimplify(points, mid)
			if len(s) < minCount {
				rhi = mid
			} else if len(s) > maxCount {
				rlo = mid
			} else {
				rhi = mid
				best = s
			}
		}
	}
	for len(best) > maxCount && hi < 1e7 {
		hi *= 1.5
		best = DouglasPeuckerSimplify(points, hi)
	}
	return best
}

// DensifyAlongPath samples targetCount points uniformly by great-circle distance.
func DensifyAlongPath(points []PathPoint, targetCount int) []PathPoint {
	if len(points) < 2 || targetCount <= len(points) {
		return append([]PathPoint(nil), points...)
	}
	ds := []float64{0}
	for i := 1; i < len(points); i++ {
		ds = append(ds, ds[i-1]+HaversineDistanceNM(LngLat{points[i-1].Longitude, points[i-1].Latitude}, LngLat{points[i].Longitude, points[i].Latitude}))
	}
	total := ds[len(ds)-1]
	if total < minSegmentNM {
		return append([]PathPoint(nil), points...)
	}
	out := make([]PathPoint, 0, targetCount)
	for i := 0; i < targetCount; i++ {
		if i == 0 {
			out = append(out, points[0])
			continue
		}
		if i == targetCount-1 {
			out = append(out, points[len(points)-1])
			continue
		}
		want := total * float64(i) / float64(targetCount-1)
		seg := 1
		for seg < len(ds)-1 && ds[seg] < want {
			seg++
		}
		a, b := points[seg-1], points[seg]
		t := clamp((want-ds[seg-1])/math.Max(ds[seg]-ds[seg-1], minSegmentNM), 0, 1)
		p := DestinationPoint(LngLat{a.Longitude, a.Latitude}, HaversineDistanceNM(LngLat{a.Longitude, a.Latitude}, LngLat{b.Longitude, b.Latitude})*t, InitialBearingDegrees(LngLat{a.Longitude, a.Latitude}, LngLat{b.Longitude, b.Latitude}))
		out = append(out, PathPoint{Latitude: p.Lat, Longitude: p.Lng, Altitude: a.Altitude})
	}
	return out
}

func pathEventsLengthNM(path []PathPoint) float64 {
	var n float64
	for i := 1; i < len(path); i++ {
		n += HaversineDistanceNM(LngLat{path[i-1].Longitude, path[i-1].Latitude}, LngLat{path[i].Longitude, path[i].Latitude})
	}
	return n
}
func dedupePath(path []PathPoint) []PathPoint {
	out := make([]PathPoint, 0, len(path))
	for _, p := range path {
		if len(out) > 0 && math.Abs(out[len(out)-1].Latitude-p.Latitude) < 1e-9 && math.Abs(out[len(out)-1].Longitude-p.Longitude) < 1e-9 {
			continue
		}
		out = append(out, p)
	}
	return out
}
func eventCruiseAltitudeForDistance(distance, typical float64) float64 {
	if typical <= 0 {
		return 0
	}
	if distance < 20 {
		return clamp(math.Round(typical*.25), 1500, typical)
	}
	if distance < 100 {
		return clamp(math.Round(typical*.55), 5000, typical)
	}
	return typical
}
func altitudeAlong(distance, total float64, p VehicleProfile, cruiseKnots, start, end, cruiseAltitude float64) float64 {
	if p.ClimbRateFtPerMin <= 0 && p.DescentRateFtPerMin <= 0 {
		if total < minSegmentNM {
			return start
		}
		return start + (end-start)*distance/total
	}
	climbNM := math.Max(0, cruiseAltitude-start) / p.ClimbRateFtPerMin / 60 * cruiseKnots
	descentNM := math.Max(0, cruiseAltitude-end) / p.DescentRateFtPerMin / 60 * cruiseKnots
	if climbNM+descentNM > total && total > minSegmentNM {
		s := total / (climbNM + descentNM)
		climbNM *= s
		descentNM *= s
	}
	if distance <= climbNM && climbNM > minSegmentNM {
		return start + (cruiseAltitude-start)*distance/climbNM
	}
	cruiseEnd := math.Max(climbNM, total-descentNM)
	if distance >= cruiseEnd && descentNM > minSegmentNM {
		return cruiseAltitude + (end-cruiseAltitude)*(distance-cruiseEnd)/descentNM
	}
	return cruiseAltitude
}
func walkPath(path []PathPoint, p VehicleProfile, cruise, ceiling float64) []walkedPoint {
	bearings := make([]float64, len(path)-1)
	for i := range bearings {
		bearings[i] = InitialBearingDegrees(LngLat{path[i].Longitude, path[i].Latitude}, LngLat{path[i+1].Longitude, path[i+1].Latitude})
	}
	out := make([]walkedPoint, 0, len(path))
	cum := 0.0
	for i, pt := range path {
		turn := 0.0
		if i > 0 && i < len(path)-1 {
			turn = ShortestHeadingDelta(bearings[i-1], bearings[i])
		}
		factor := 1 - (1-turnSpeedFloor)*math.Min(1, math.Abs(turn)/90)
		cap := math.Inf(1)
		if math.Abs(turn) >= 2 {
			cap = math.Sqrt(2.5*math.Max(p.TurnRadiusM, 1)) * 3600 / 1852
		}
		speed := clamp(math.Min(cruise*factor, cap), math.Min(p.CruiseKnots.MinKnots*turnSpeedFloor, cruise), ceiling)
		if i > 0 {
			cum += HaversineDistanceNM(LngLat{path[i-1].Longitude, path[i-1].Latitude}, LngLat{pt.Longitude, pt.Latitude})
		}
		out = append(out, walkedPoint{PathPoint: pt, speed: speed, cumulative: cum})
	}
	return out
}

// PathToEvents converts a routed polyline to timed, turn-limited simulation events.
func PathToEvents(o PathToEventsOptions) ([]scenario.SimulationEvent, error) {
	profile := ResolveVehicleProfile(o.VehicleCategory, o.VehicleSubtype)
	ceiling := math.Min(profile.MaxKnots, CategoryTopSpeedKnots[o.VehicleCategory])
	cruise := ProfileCruiseMidpointKnots(profile)
	if o.CruiseKnots != nil {
		cruise = *o.CruiseKnots
	}
	cruise = clamp(cruise, profile.CruiseKnots.MinKnots, ceiling)
	path := dedupePath(o.Path)
	if len(path) < 2 {
		return nil, fmt.Errorf("path must contain at least two distinct points")
	}
	total := pathEventsLengthNM(path)
	if total < .001 {
		return nil, fmt.Errorf("path must have positive length")
	}
	start, err := time.Parse(time.RFC3339, o.StartAt)
	if err != nil {
		return nil, fmt.Errorf("parse start time: %w", err)
	}
	end := start.Add(time.Duration(total / cruise * 1.02 * float64(time.Hour)))
	if o.EndAt != "" {
		end, err = time.Parse(time.RFC3339, o.EndAt)
		if err != nil {
			return nil, fmt.Errorf("parse end time: %w", err)
		}
	}
	if !end.After(start) {
		return nil, fmt.Errorf("end time must be after start time")
	}
	window := end.Sub(start).Hours()
	if total/window > ceiling+1e-6 {
		return nil, fmt.Errorf("route requires about %.0f kt average, above the %s maximum of %.0f kt", total/window, o.VehicleCategory, ceiling)
	}
	walked := walkPath(path, profile, cruise, ceiling)
	raw := make([]PathPoint, len(walked))
	for i, w := range walked {
		raw[i] = w.PathPoint
	}
	minCount, maxCount := PathEventBudgetMin, PathEventBudgetMax
	if o.EventCount != nil {
		n := max(1, min(*o.EventCount, maxGeneratedEvents))
		minCount, maxCount = n, n
	}
	simple := SimplifyToEventBudget(raw, minCount, maxCount)
	if len(simple) < minCount {
		simple = DensifyAlongPath(simple, minCount)
	}
	if o.EventCount != nil && len(simple) > minCount && minCount > 1 {
		sample := make([]PathPoint, 0, minCount)
		for i := 0; i < minCount; i++ {
			sample = append(sample, simple[int(math.Round(float64(i*(len(simple)-1))/float64(minCount-1)))])
		}
		simple = sample
	}
	dist := []float64{0}
	for i := 1; i < len(simple); i++ {
		dist = append(dist, dist[i-1]+HaversineDistanceNM(LngLat{simple[i-1].Longitude, simple[i-1].Latitude}, LngLat{simple[i].Longitude, simple[i].Latitude}))
	}
	startAlt, endAlt := 0.0, 0.0
	if path[0].Altitude != nil {
		startAlt = *path[0].Altitude
	}
	if path[len(path)-1].Altitude != nil {
		endAlt = *path[len(path)-1].Altitude
	}
	if path[len(path)-1].Altitude == nil && profile.TypicalFlightLevelFt == 0 {
		endAlt = startAlt
	}
	cruiseAlt := math.Max(eventCruiseAltitudeForDistance(dist[len(dist)-1], profile.TypicalFlightLevelFt), math.Max(startAlt, endAlt))
	for i := range simple {
		a := altitudeAlong(dist[i], dist[len(dist)-1], profile, cruise, startAlt, endAlt, cruiseAlt)
		simple[i].Altitude = &a
	}
	a, b := startAlt, endAlt
	simple[0].Altitude = &a
	simple[len(simple)-1].Altitude = &b
	id := o.IDFactory
	if id == nil {
		id = func() string { return uuid.NewString() }
	}
	events := make([]scenario.SimulationEvent, 0, len(simple))
	previousAt := start
	for i, p := range simple {
		fraction := 0.0
		if dist[len(dist)-1] > 0 {
			fraction = dist[i] / dist[len(dist)-1]
		}
		at := start.Add(time.Duration(fraction * window * float64(time.Hour)))
		if i == len(simple)-1 {
			at = end
		}
		speed := cruise
		if i > 0 && at.After(previousAt) {
			speed = HaversineDistanceNM(LngLat{simple[i-1].Longitude, simple[i-1].Latitude}, LngLat{p.Longitude, p.Latitude}) / at.Sub(previousAt).Hours()
		}
		lat, lng, alt, spd := round(p.Latitude, 6), round(p.Longitude, 6), round(*p.Altitude, 1), round(math.Min(speed, ceiling), 1)
		events = append(events, scenario.SimulationEvent{ID: id(), TargetID: o.TargetID, At: at.UTC().Format(time.RFC3339Nano), Position: &scenario.PositionPayload{Latitude: lat, Longitude: lng, Altitude: &alt, Speed: &spd}})
		previousAt = at
	}
	return events, nil
}
func round(v float64, n int) float64 { p := math.Pow10(n); return math.Round(v*p) / p }
