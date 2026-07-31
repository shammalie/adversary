package geo

// KinematicsFromProfile maps a VehicleProfile into air-router kinematics.
func KinematicsFromProfile(p VehicleProfile) AirKinematics {
	return AirKinematics{
		CruiseKnots:          ProfileCruiseMidpointKnots(p),
		ClimbRateFtPerMin:    p.ClimbRateFtPerMin,
		DescentRateFtPerMin:  p.DescentRateFtPerMin,
		TurnRadiusM:          p.TurnRadiusM,
		TypicalFlightLevelFt: p.TypicalFlightLevelFt,
		CanLoiter:            p.CanLoiter,
		ReturnsToBase:        p.ReturnsToBase,
	}
}
