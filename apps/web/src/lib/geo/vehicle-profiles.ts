import {
  CATEGORY_SPEED_RANGES,
  CATEGORY_TOP_SPEED_KNOTS,
  type SpeedRange,
} from "@/lib/vehicle-speed";
import type { VehicleCategory } from "@/types/target";

/**
 * Kinematic profile for a concrete vehicle subtype.
 * This is the single source of truth for cruise bands, turn geometry, and
 * vertical rates used by path-to-events and (later) the air router.
 */
export interface VehicleProfile {
  subtype: string;
  category: VehicleCategory;
  /** Preferred generation / cruise band (knots). */
  cruiseKnots: SpeedRange;
  /** Absolute platform max; always ≤ CATEGORY_TOP_SPEED_KNOTS[category]. */
  maxKnots: number;
  /** Positive climb rate in feet per minute (0 for surface vehicles). */
  climbRateFtPerMin: number;
  /** Positive descent rate in feet per minute (0 for surface vehicles). */
  descentRateFtPerMin: number;
  /** Minimum turn radius in metres at cruise. */
  turnRadiusM: number;
  /** Typical cruise altitude in feet (0 for surface vehicles). */
  typicalFlightLevelFt: number;
  /** Whether the air router may insert a loiter pattern. */
  canLoiter: boolean;
  /** Whether the air router may plan return-to-base (dest = origin). */
  returnsToBase: boolean;
}

function profile(
  partial: Omit<VehicleProfile, "maxKnots"> & { maxKnots: number },
): VehicleProfile {
  const top = CATEGORY_TOP_SPEED_KNOTS[partial.category];
  const maxKnots = Math.min(partial.maxKnots, top);
  const cruiseMax = Math.min(partial.cruiseKnots.maxKnots, maxKnots);
  const cruiseMin = Math.min(partial.cruiseKnots.minKnots, cruiseMax);
  return {
    ...partial,
    maxKnots,
    cruiseKnots: { minKnots: cruiseMin, maxKnots: cruiseMax },
  };
}

/**
 * Subtype-keyed kinematic table. Keys match the display strings historically
 * sampled in demo-scenario (`VEHICLE_SUBTYPES`).
 */
export const VEHICLE_SUBTYPE_PROFILES: Readonly<Record<string, VehicleProfile>> = {
  "Multi-role fighter": profile({
    subtype: "Multi-role fighter",
    category: "aircraft",
    cruiseKnots: { minKnots: 420, maxKnots: 520 },
    maxKnots: 1_200,
    climbRateFtPerMin: 25_000,
    descentRateFtPerMin: 8_000,
    turnRadiusM: 2_500,
    typicalFlightLevelFt: 35_000,
    canLoiter: true,
    returnsToBase: true,
  }),
  Transport: profile({
    subtype: "Transport",
    category: "aircraft",
    cruiseKnots: { minKnots: 400, maxKnots: 480 },
    maxKnots: 500,
    climbRateFtPerMin: 2_500,
    descentRateFtPerMin: 2_000,
    turnRadiusM: 8_000,
    typicalFlightLevelFt: 33_000,
    canLoiter: false,
    returnsToBase: true,
  }),
  UAV: profile({
    subtype: "UAV",
    category: "aircraft",
    cruiseKnots: { minKnots: 70, maxKnots: 140 },
    maxKnots: 180,
    climbRateFtPerMin: 1_000,
    descentRateFtPerMin: 800,
    turnRadiusM: 1_200,
    typicalFlightLevelFt: 15_000,
    canLoiter: true,
    returnsToBase: true,
  }),
  "Rotary-wing": profile({
    subtype: "Rotary-wing",
    category: "aircraft",
    cruiseKnots: { minKnots: 100, maxKnots: 140 },
    maxKnots: 170,
    climbRateFtPerMin: 1_500,
    descentRateFtPerMin: 1_200,
    turnRadiusM: 400,
    typicalFlightLevelFt: 3_000,
    canLoiter: true,
    returnsToBase: true,
  }),
  "Fast patrol craft": profile({
    subtype: "Fast patrol craft",
    category: "boat",
    cruiseKnots: { minKnots: 22, maxKnots: 35 },
    maxKnots: 45,
    climbRateFtPerMin: 0,
    descentRateFtPerMin: 0,
    turnRadiusM: 80,
    typicalFlightLevelFt: 0,
    canLoiter: false,
    returnsToBase: false,
  }),
  "Cargo vessel": profile({
    subtype: "Cargo vessel",
    category: "boat",
    cruiseKnots: { minKnots: 12, maxKnots: 18 },
    maxKnots: 22,
    climbRateFtPerMin: 0,
    descentRateFtPerMin: 0,
    turnRadiusM: 400,
    typicalFlightLevelFt: 0,
    canLoiter: false,
    returnsToBase: false,
  }),
  "Fishing trawler": profile({
    subtype: "Fishing trawler",
    category: "boat",
    cruiseKnots: { minKnots: 6, maxKnots: 10 },
    maxKnots: 14,
    climbRateFtPerMin: 0,
    descentRateFtPerMin: 0,
    turnRadiusM: 150,
    typicalFlightLevelFt: 0,
    canLoiter: false,
    returnsToBase: false,
  }),
  RHIB: profile({
    subtype: "RHIB",
    category: "boat",
    cruiseKnots: { minKnots: 20, maxKnots: 32 },
    maxKnots: 45,
    climbRateFtPerMin: 0,
    descentRateFtPerMin: 0,
    turnRadiusM: 40,
    typicalFlightLevelFt: 0,
    canLoiter: false,
    returnsToBase: false,
  }),
  Sedan: profile({
    subtype: "Sedan",
    category: "car",
    cruiseKnots: { minKnots: 35, maxKnots: 70 },
    maxKnots: 85,
    climbRateFtPerMin: 0,
    descentRateFtPerMin: 0,
    turnRadiusM: 12,
    typicalFlightLevelFt: 0,
    canLoiter: false,
    returnsToBase: false,
  }),
  SUV: profile({
    subtype: "SUV",
    category: "car",
    cruiseKnots: { minKnots: 30, maxKnots: 65 },
    maxKnots: 80,
    climbRateFtPerMin: 0,
    descentRateFtPerMin: 0,
    turnRadiusM: 14,
    typicalFlightLevelFt: 0,
    canLoiter: false,
    returnsToBase: false,
  }),
  "Light utility": profile({
    subtype: "Light utility",
    category: "car",
    cruiseKnots: { minKnots: 25, maxKnots: 55 },
    maxKnots: 70,
    climbRateFtPerMin: 0,
    descentRateFtPerMin: 0,
    turnRadiusM: 11,
    typicalFlightLevelFt: 0,
    canLoiter: false,
    returnsToBase: false,
  }),
  "Cargo truck": profile({
    subtype: "Cargo truck",
    category: "truck",
    cruiseKnots: { minKnots: 40, maxKnots: 55 },
    maxKnots: 65,
    climbRateFtPerMin: 0,
    descentRateFtPerMin: 0,
    turnRadiusM: 25,
    typicalFlightLevelFt: 0,
    canLoiter: false,
    returnsToBase: false,
  }),
  Tanker: profile({
    subtype: "Tanker",
    category: "truck",
    cruiseKnots: { minKnots: 35, maxKnots: 50 },
    maxKnots: 60,
    climbRateFtPerMin: 0,
    descentRateFtPerMin: 0,
    turnRadiusM: 30,
    typicalFlightLevelFt: 0,
    canLoiter: false,
    returnsToBase: false,
  }),
  Flatbed: profile({
    subtype: "Flatbed",
    category: "truck",
    cruiseKnots: { minKnots: 35, maxKnots: 55 },
    maxKnots: 65,
    climbRateFtPerMin: 0,
    descentRateFtPerMin: 0,
    turnRadiusM: 28,
    typicalFlightLevelFt: 0,
    canLoiter: false,
    returnsToBase: false,
  }),
  "Unclassified contact": profile({
    subtype: "Unclassified contact",
    category: "other",
    cruiseKnots: { minKnots: 5, maxKnots: 40 },
    maxKnots: 55,
    climbRateFtPerMin: 0,
    descentRateFtPerMin: 0,
    turnRadiusM: 40,
    typicalFlightLevelFt: 0,
    canLoiter: false,
    returnsToBase: false,
  }),
  "Mobile platform": profile({
    subtype: "Mobile platform",
    category: "other",
    cruiseKnots: { minKnots: 3, maxKnots: 25 },
    maxKnots: 40,
    climbRateFtPerMin: 0,
    descentRateFtPerMin: 0,
    turnRadiusM: 50,
    typicalFlightLevelFt: 0,
    canLoiter: false,
    returnsToBase: false,
  }),
};

/** Category-only fallback when a target has no recognised subtype. */
export function categoryFallbackProfile(category: VehicleCategory): VehicleProfile {
  const range = CATEGORY_SPEED_RANGES[category];
  const isAircraft = category === "aircraft";
  return profile({
    subtype: category,
    category,
    cruiseKnots: { ...range },
    maxKnots: range.maxKnots,
    climbRateFtPerMin: isAircraft ? 2_000 : 0,
    descentRateFtPerMin: isAircraft ? 1_500 : 0,
    turnRadiusM: isAircraft ? 6_000 : category === "boat" ? 200 : 20,
    typicalFlightLevelFt: isAircraft ? 25_000 : 0,
    canLoiter: isAircraft,
    returnsToBase: isAircraft,
  });
}

/**
 * Resolve the kinematic profile for a target.
 * Known subtypes win; otherwise {@link CATEGORY_SPEED_RANGES} backs the band.
 */
export function resolveVehicleProfile(
  category: VehicleCategory,
  vehicleSubtype?: string,
): VehicleProfile {
  const key = vehicleSubtype?.trim();
  if (key) {
    const match = VEHICLE_SUBTYPE_PROFILES[key];
    if (match) return match;
  }
  return categoryFallbackProfile(category);
}

/** Midpoint of the profile cruise band, clamped to the platform max. */
export function profileCruiseMidpointKnots(profile: VehicleProfile): number {
  const mid = (profile.cruiseKnots.minKnots + profile.cruiseKnots.maxKnots) / 2;
  return Math.min(mid, profile.maxKnots);
}

/** Sample a cruise speed inside the profile band. */
export function sampleProfileCruiseKnots(
  profile: VehicleProfile,
  random: () => number = Math.random,
): number {
  const { minKnots, maxKnots } = profile.cruiseKnots;
  return minKnots + random() * (maxKnots - minKnots);
}
