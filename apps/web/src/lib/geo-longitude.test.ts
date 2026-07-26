import { describe, expect, it } from "vitest";

import {
  lngLatBoundsForPoints,
  normalizeLongitude,
  shortestLongitudeDelta,
  unwrapLineLongitudes,
} from "@/lib/geo-longitude";

describe("geo-longitude", () => {
  describe("normalizeLongitude", () => {
    it("leaves values in [-180, 180] unchanged (except -180 → 180)", () => {
      expect(normalizeLongitude(0)).toBe(0);
      expect(normalizeLongitude(170)).toBe(170);
      expect(normalizeLongitude(-170)).toBe(-170);
      expect(normalizeLongitude(180)).toBe(180);
      expect(normalizeLongitude(-180)).toBe(180);
    });

    it("wraps world-copy longitudes into [-180, 180]", () => {
      expect(normalizeLongitude(190)).toBe(-170);
      expect(normalizeLongitude(-190)).toBe(170);
      expect(normalizeLongitude(540)).toBe(180);
      expect(normalizeLongitude(-540)).toBe(180);
    });
  });

  describe("shortestLongitudeDelta", () => {
    it("returns short eastward delta across the antimeridian", () => {
      expect(shortestLongitudeDelta(170, -170)).toBe(20);
    });

    it("returns short westward delta across the antimeridian", () => {
      expect(shortestLongitudeDelta(-170, 170)).toBe(-20);
    });

    it("returns ordinary deltas when not wrapping", () => {
      expect(shortestLongitudeDelta(10, 30)).toBe(20);
      expect(shortestLongitudeDelta(30, 10)).toBe(-20);
    });
  });

  describe("unwrapLineLongitudes", () => {
    it("unwraps a Pacific crossing so consecutive steps stay short", () => {
      const unwrapped = unwrapLineLongitudes([
        [170, 0],
        [-170, 0],
        [-160, 5],
      ]);
      expect(unwrapped[0]).toEqual([170, 0]);
      expect(unwrapped[1]![0]).toBeCloseTo(190, 6);
      expect(unwrapped[1]![1]).toBe(0);
      expect(unwrapped[2]![0]).toBeCloseTo(200, 6);
      expect(unwrapped[2]![1]).toBe(5);
      expect(Math.abs(unwrapped[1]![0] - unwrapped[0]![0])).toBeLessThanOrEqual(180);
      expect(Math.abs(unwrapped[2]![0] - unwrapped[1]![0])).toBeLessThanOrEqual(180);
    });

    it("leaves non-wrapping lines unchanged", () => {
      expect(
        unwrapLineLongitudes([
          [-10, 50],
          [0, 51],
          [10, 52],
        ]),
      ).toEqual([
        [-10, 50],
        [0, 51],
        [10, 52],
      ]);
    });

    it("returns empty for empty input", () => {
      expect(unwrapLineLongitudes([])).toEqual([]);
    });
  });

  describe("lngLatBoundsForPoints", () => {
    it("returns null for empty input", () => {
      expect(lngLatBoundsForPoints([])).toBeNull();
    });

    it("returns a point box for a single coordinate", () => {
      expect(lngLatBoundsForPoints([{ longitude: 12, latitude: 48 }])).toEqual([
        [12, 48],
        [12, 48],
      ]);
    });

    it("uses naive min/max when the span does not cross the dateline", () => {
      expect(
        lngLatBoundsForPoints([
          { longitude: -10, latitude: 40 },
          { longitude: 20, latitude: 50 },
        ]),
      ).toEqual([
        [-10, 40],
        [20, 50],
      ]);
    });

    it("frames the short Pacific span across the antimeridian", () => {
      const bounds = lngLatBoundsForPoints([
        { longitude: 170, latitude: -10 },
        { longitude: -170, latitude: 10 },
      ]);
      expect(bounds).not.toBeNull();
      const [[west, south], [east, north]] = bounds!;
      expect(west).toBe(170);
      expect(east).toBe(190);
      expect(south).toBe(-10);
      expect(north).toBe(10);
      expect(east - west).toBeLessThan(50);
    });
  });
});
