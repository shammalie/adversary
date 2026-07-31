package geo

import "testing"

func TestVehicleProfilesRespectCategoryCeilings(t *testing.T) {
	for name, profile := range VehicleSubtypeProfiles {
		if profile.MaxKnots > CategoryTopSpeedKnots[profile.Category] {
			t.Fatalf("%s exceeds category ceiling", name)
		}
		if profile.CruiseKnots.MaxKnots > profile.MaxKnots {
			t.Fatalf("%s cruise exceeds platform ceiling", name)
		}
	}
}

func TestResolveGenerationCruiseKnots(t *testing.T) {
	high, low, inRange := 10000.0, 1.0, 450.0
	if got := ResolveGenerationCruiseKnots("aircraft", "Transport", &high); got != 500 {
		t.Fatalf("high override=%f", got)
	}
	if got := ResolveGenerationCruiseKnots("aircraft", "Transport", &low); got != 400 {
		t.Fatalf("low override=%f", got)
	}
	if got := ResolveGenerationCruiseKnots("aircraft", "Transport", &inRange); got != 450 {
		t.Fatalf("in-range override=%f", got)
	}
}

func TestSampleProfileCruiseKnotsIsSeeded(t *testing.T) {
	random := CreateSeededRandom(7)
	profile := ResolveVehicleProfile("car", "Sedan")
	first := SampleProfileCruiseKnots(profile, random)
	if first < profile.CruiseKnots.MinKnots || first > profile.CruiseKnots.MaxKnots {
		t.Fatalf("sample %f outside band", first)
	}
	if first != SampleProfileCruiseKnots(profile, CreateSeededRandom(7)) {
		t.Fatal("seeded random did not reproduce")
	}
}
