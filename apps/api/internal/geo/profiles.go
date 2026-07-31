package geo

import (
	"math"
	"strings"
)

// VehicleProfile describes the kinematics of a concrete vehicle subtype.
type VehicleProfile struct {
	Subtype, Category                      string
	CruiseKnots                            SpeedRange
	MaxKnots                               float64
	ClimbRateFtPerMin, DescentRateFtPerMin float64
	TurnRadiusM, TypicalFlightLevelFt      float64
	CanLoiter, ReturnsToBase               bool
}

func vehicleProfile(p VehicleProfile) VehicleProfile {
	top := CategoryTopSpeedKnots[p.Category]
	p.MaxKnots = math.Min(p.MaxKnots, top)
	p.CruiseKnots.MaxKnots = math.Min(p.CruiseKnots.MaxKnots, p.MaxKnots)
	p.CruiseKnots.MinKnots = math.Min(p.CruiseKnots.MinKnots, p.CruiseKnots.MaxKnots)
	return p
}

func p(subtype, category string, min, max, ceiling, climb, descent, radius, level float64, loiter, rtb bool) VehicleProfile {
	return vehicleProfile(VehicleProfile{subtype, category, SpeedRange{min, max}, ceiling, climb, descent, radius, level, loiter, rtb})
}

// VehicleSubtypeProfiles is the canonical subtype-keyed kinematic table.
var VehicleSubtypeProfiles = map[string]VehicleProfile{
	"Multi-role fighter":   p("Multi-role fighter", "aircraft", 420, 520, 1200, 25000, 8000, 2500, 35000, true, true),
	"Transport":            p("Transport", "aircraft", 400, 480, 500, 2500, 2000, 8000, 33000, false, true),
	"UAV":                  p("UAV", "aircraft", 70, 140, 180, 1000, 800, 1200, 15000, true, true),
	"Rotary-wing":          p("Rotary-wing", "aircraft", 100, 140, 170, 1500, 1200, 400, 3000, true, true),
	"Fast patrol craft":    p("Fast patrol craft", "boat", 22, 35, 45, 0, 0, 80, 0, false, false),
	"Cargo vessel":         p("Cargo vessel", "boat", 12, 18, 22, 0, 0, 400, 0, false, false),
	"Fishing trawler":      p("Fishing trawler", "boat", 6, 10, 14, 0, 0, 150, 0, false, false),
	"RHIB":                 p("RHIB", "boat", 20, 32, 45, 0, 0, 40, 0, false, false),
	"Sedan":                p("Sedan", "car", 35, 70, 85, 0, 0, 12, 0, false, false),
	"SUV":                  p("SUV", "car", 30, 65, 80, 0, 0, 14, 0, false, false),
	"Light utility":        p("Light utility", "car", 25, 55, 70, 0, 0, 11, 0, false, false),
	"Cargo truck":          p("Cargo truck", "truck", 40, 55, 65, 0, 0, 25, 0, false, false),
	"Tanker":               p("Tanker", "truck", 35, 50, 60, 0, 0, 30, 0, false, false),
	"Flatbed":              p("Flatbed", "truck", 35, 55, 65, 0, 0, 28, 0, false, false),
	"Unclassified contact": p("Unclassified contact", "other", 5, 40, 55, 0, 0, 40, 0, false, false),
	"Mobile platform":      p("Mobile platform", "other", 3, 25, 40, 0, 0, 50, 0, false, false),
}

func CategoryFallbackProfile(category string) VehicleProfile {
	r := CategorySpeedRanges[category]
	aircraft := category == "aircraft"
	radius := 20.0
	if aircraft {
		radius = 6000
	} else if category == "boat" {
		radius = 200
	}
	climb, descent, level := 0.0, 0.0, 0.0
	if aircraft {
		climb, descent, level = 2000, 1500, 25000
	}
	return vehicleProfile(VehicleProfile{category, category, r, r.MaxKnots, climb, descent, radius, level, aircraft, aircraft})
}

func ResolveVehicleProfile(category, subtype string) VehicleProfile {
	if profile, ok := VehicleSubtypeProfiles[strings.TrimSpace(subtype)]; ok {
		return profile
	}
	return CategoryFallbackProfile(category)
}

func ProfileCruiseMidpointKnots(profile VehicleProfile) float64 {
	return math.Min((profile.CruiseKnots.MinKnots+profile.CruiseKnots.MaxKnots)/2, profile.MaxKnots)
}

func SampleProfileCruiseKnots(profile VehicleProfile, random func() float64) float64 {
	if random == nil {
		random = func() float64 { return 0.5 }
	}
	return profile.CruiseKnots.MinKnots + random()*(profile.CruiseKnots.MaxKnots-profile.CruiseKnots.MinKnots)
}

func ResolveGenerationCruiseKnots(category, subtype string, maxCruiseKnots *float64) float64 {
	profile := ResolveVehicleProfile(category, subtype)
	ceiling := math.Min(profile.MaxKnots, CategoryTopSpeedKnots[category])
	if maxCruiseKnots == nil || math.IsNaN(*maxCruiseKnots) || math.IsInf(*maxCruiseKnots, 0) {
		return math.Min(ProfileCruiseMidpointKnots(profile), ceiling)
	}
	return math.Min(ceiling, math.Max(profile.CruiseKnots.MinKnots, *maxCruiseKnots))
}
