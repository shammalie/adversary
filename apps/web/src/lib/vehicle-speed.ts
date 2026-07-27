import type { VehicleCategory } from "@/types/target";

export interface SpeedRange {
  minKnots: number;
  maxKnots: number;
}

/**
 * Absolute ceiling speeds (knots) per vehicle category.
 * Aircraft tops cover high-performance fighters (≈Mach 2+ class).
 */
export const CATEGORY_TOP_SPEED_KNOTS: Record<VehicleCategory, number> = {
  aircraft: 1_800,
  boat: 80,
  car: 130,
  truck: 85,
  other: 100,
};

/**
 * Category-level generation bands (knots). Always within the category top speed.
 * Prefer subtype profiles in `geo/vehicle-profiles.ts` when a vehicleSubtype is
 * known; this table is the fallback for targets with no recognised subtype and
 * for the legacy synthetic event generator.
 */
export const CATEGORY_SPEED_RANGES: Record<VehicleCategory, SpeedRange> = {
  aircraft: { minKnots: 90, maxKnots: 1_400 },
  boat: { minKnots: 6, maxKnots: 50 },
  car: { minKnots: 10, maxKnots: 85 },
  truck: { minKnots: 8, maxKnots: 60 },
  other: { minKnots: 3, maxKnots: 55 },
};

export function clampSpeedToCategory(
  speedKnots: number,
  category?: VehicleCategory,
): number {
  if (!Number.isFinite(speedKnots) || speedKnots < 0) return 0;
  if (!category) return speedKnots;
  return Math.min(speedKnots, CATEGORY_TOP_SPEED_KNOTS[category]);
}
