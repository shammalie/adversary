import { describe, expect, it } from "vitest";

import {
  CATEGORY_SPEED_RANGES,
  CATEGORY_TOP_SPEED_KNOTS,
  clampSpeedToCategory,
} from "@/lib/vehicle-speed";
import { VEHICLE_CATEGORIES } from "@/types/target";

describe("vehicle speed", () => {
  it("defines a top speed for every vehicle category", () => {
    for (const category of VEHICLE_CATEGORIES) {
      expect(CATEGORY_TOP_SPEED_KNOTS[category]).toBeGreaterThan(0);
      expect(CATEGORY_SPEED_RANGES[category].maxKnots).toBeLessThanOrEqual(
        CATEGORY_TOP_SPEED_KNOTS[category],
      );
    }
  });

  it("supports fighter-jet class aircraft tops", () => {
    expect(CATEGORY_TOP_SPEED_KNOTS.aircraft).toBe(1_800);
    expect(CATEGORY_SPEED_RANGES.aircraft.maxKnots).toBeGreaterThanOrEqual(1_000);
  });

  it("clamps speeds to the category ceiling", () => {
    expect(clampSpeedToCategory(2_500, "aircraft")).toBe(1_800);
    expect(clampSpeedToCategory(200, "boat")).toBe(80);
    expect(clampSpeedToCategory(40, "car")).toBe(40);
    expect(clampSpeedToCategory(-5, "truck")).toBe(0);
    expect(clampSpeedToCategory(999, undefined)).toBe(999);
  });
});
