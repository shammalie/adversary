import { describe, expect, it } from "vitest";

import {
  formatSpeedInUnit,
  fromKnots,
  parseSpeedInput,
  roundSpeed,
  toKnots,
} from "@/lib/speed-units";

describe("speed units", () => {
  it("converts major units to and from knots", () => {
    expect(roundSpeed(toKnots(450, "mph"))).toBe(391);
    expect(roundSpeed(fromKnots(391, "mph"))).toBe(450);
    expect(roundSpeed(toKnots(100, "km/h"))).toBe(54);
    expect(roundSpeed(toKnots(10, "m/s"))).toBe(19.4);
    expect(roundSpeed(toKnots(100, "ft/s"))).toBe(59.2);
    expect(roundSpeed(toKnots(1, "mach"))).toBe(661.5);
  });

  it("parses freeform measurement entry", () => {
    expect(parseSpeedInput("450 mph")).toEqual({ amount: 450, unit: "mph", knots: 391 });
    expect(parseSpeedInput("100km/h")).toEqual({ amount: 100, unit: "km/h", knots: 54 });
    expect(parseSpeedInput("12.5 m/s")).toEqual({ amount: 12.5, unit: "m/s", knots: 24.3 });
    expect(parseSpeedInput("180", "kt")).toEqual({ amount: 180, unit: "kt", knots: 180 });
    expect(parseSpeedInput("")).toBeNull();
    expect(parseSpeedInput("fast")).toBeNull();
  });

  it("formats display amounts without trailing noise", () => {
    expect(formatSpeedInUnit(180, "kt")).toBe("180");
    expect(formatSpeedInUnit(toKnots(450, "mph"), "mph")).toBe("450");
  });
});
