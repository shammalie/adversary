import { describe, expect, it } from "vitest";

import {
  CATEGORY_SPEED_RANGES,
  CATEGORY_TOP_SPEED_KNOTS,
} from "@/lib/vehicle-speed";
import {
  categoryFallbackProfile,
  profileCruiseMidpointKnots,
  resolveVehicleProfile,
  VEHICLE_SUBTYPE_PROFILES,
} from "@/lib/geo/vehicle-profiles";
import { VEHICLE_CATEGORIES } from "@/types/target";

const EXPECTED_SUBTYPES = [
  "Multi-role fighter",
  "Transport",
  "UAV",
  "Rotary-wing",
  "Fast patrol craft",
  "Cargo vessel",
  "Fishing trawler",
  "RHIB",
  "Sedan",
  "SUV",
  "Light utility",
  "Cargo truck",
  "Tanker",
  "Flatbed",
  "Unclassified contact",
  "Mobile platform",
] as const;

describe("vehicle profiles", () => {
  it("defines a profile for every demo subtype", () => {
    for (const subtype of EXPECTED_SUBTYPES) {
      expect(VEHICLE_SUBTYPE_PROFILES[subtype]).toBeDefined();
    }
  });

  it("keeps every profile within the category top-speed ceiling", () => {
    for (const profile of Object.values(VEHICLE_SUBTYPE_PROFILES)) {
      expect(profile.maxKnots).toBeLessThanOrEqual(CATEGORY_TOP_SPEED_KNOTS[profile.category]);
      expect(profile.cruiseKnots.maxKnots).toBeLessThanOrEqual(profile.maxKnots);
      expect(profile.cruiseKnots.minKnots).toBeLessThanOrEqual(profile.cruiseKnots.maxKnots);
      expect(profile.turnRadiusM).toBeGreaterThan(0);
    }
  });

  it("lets subtype profiles override the wide category bands", () => {
    const transport = resolveVehicleProfile("aircraft", "Transport");
    const fighter = resolveVehicleProfile("aircraft", "Multi-role fighter");
    const categoryBand = CATEGORY_SPEED_RANGES.aircraft;

    expect(transport.cruiseKnots.maxKnots).toBeLessThan(categoryBand.maxKnots);
    expect(fighter.cruiseKnots.minKnots).toBeGreaterThan(categoryBand.minKnots);
    // The bug this phase fixes: Transport must not share the fighter-capable band.
    expect(transport.maxKnots).toBeLessThan(fighter.maxKnots);
    expect(profileCruiseMidpointKnots(transport)).toBeLessThan(600);
    expect(profileCruiseMidpointKnots(fighter)).toBeGreaterThan(400);
  });

  it("falls back to CATEGORY_SPEED_RANGES when subtype is missing or unknown", () => {
    for (const category of VEHICLE_CATEGORIES) {
      const fallback = resolveVehicleProfile(category);
      const unknown = resolveVehicleProfile(category, "Not A Real Subtype");
      const range = CATEGORY_SPEED_RANGES[category];

      expect(fallback.cruiseKnots).toEqual(range);
      expect(unknown.cruiseKnots).toEqual(range);
      expect(categoryFallbackProfile(category).maxKnots).toBe(range.maxKnots);
    }
  });

  it("marks loiter and RTB only on appropriate aircraft subtypes", () => {
    expect(resolveVehicleProfile("aircraft", "UAV").canLoiter).toBe(true);
    expect(resolveVehicleProfile("aircraft", "Transport").canLoiter).toBe(false);
    expect(resolveVehicleProfile("aircraft", "Transport").returnsToBase).toBe(true);
    expect(resolveVehicleProfile("car", "Sedan").canLoiter).toBe(false);
    expect(resolveVehicleProfile("car", "Sedan").returnsToBase).toBe(false);
  });
});
