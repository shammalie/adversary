package geo

import "testing"

func TestPlanAirRoute_PointToPoint(t *testing.T) {
	origin := Aerodrome{
		ICAO: "TEST", Position: LngLat{Lng: 0, Lat: 0}, Runways: []AerodromeRunway{{Ref: "09", HeadingDeg: 90}},
	}
	destination := Aerodrome{
		ICAO: "DEST", Position: LngLat{Lng: 1, Lat: 0}, Runways: []AerodromeRunway{{Ref: "09", HeadingDeg: 90}},
	}
	rtb := false
	result := PlanAirRoute(PlanAirRouteOptions{
		Aerodromes:   []Aerodrome{origin, destination},
		WindowHours:  2,
		ReturnToBase: &rtb,
		Kinematics: AirKinematics{
			CruiseKnots: 180, ClimbRateFtPerMin: 1500, DescentRateFtPerMin: 1200,
			TurnRadiusM: 1000, TypicalFlightLevelFt: 12000,
		},
	})
	if !result.Ok {
		t.Fatalf("PlanAirRoute() failure = %#v", result)
	}
	if result.Origin == nil || result.Destination == nil || result.Origin.ICAO != origin.ICAO || result.Destination.ICAO != destination.ICAO {
		t.Fatalf("PlanAirRoute() endpoints = %#v", result)
	}
	if len(result.Path) < 3 || result.Path[0].LngLat != origin.Position || result.Path[len(result.Path)-1].LngLat != destination.Position {
		t.Fatalf("PlanAirRoute() path = %#v", result.Path)
	}
}

func TestPlanAirRoute_EmptyBBoxFails(t *testing.T) {
	result := PlanAirRoute(PlanAirRouteOptions{
		Aerodromes:  []Aerodrome{{Position: LngLat{Lng: 0, Lat: 0}}},
		BBox:        &[4]float64{10, 10, 11, 11},
		WindowHours: 1,
		Kinematics:  AirKinematics{CruiseKnots: 100},
	})
	if result.Ok || result.Reason != "no-aerodromes-in-region" {
		t.Fatalf("PlanAirRoute() = %#v, want no-aerodromes-in-region failure", result)
	}
}
