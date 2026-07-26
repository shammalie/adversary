import { describe, expect, it } from "vitest";

import {
  derivePositionSnapshot,
  destinationPoint,
  haversineDistanceNm,
  hasEventPayload,
  initialBearingDegrees,
  interpolatePositionSnapshot,
} from "@/lib/position-telemetry";
import { CATEGORY_TOP_SPEED_KNOTS } from "@/lib/vehicle-speed";

describe("position telemetry", () => {
  it("calculates geodesic distance and bearing", () => {
    const from = { latitude: 51.5074, longitude: -0.1278 };
    const to = { latitude: 51.515, longitude: 0.05 };
    expect(haversineDistanceNm(from, to)).toBeGreaterThan(0);
    expect(initialBearingDegrees(from, to)).toBeGreaterThan(0);
    const next = destinationPoint(from, 10, 90);
    expect(next.longitude).toBeGreaterThan(from.longitude);
  });

  it("uses the short arc across the antimeridian for distance and bearing", () => {
    const west = { latitude: 0, longitude: 170 };
    const east = { latitude: 0, longitude: -170 };
    // 20° of longitude at the equator ≈ 20 * 60 = 1200 nm (short arc).
    const distance = haversineDistanceNm(west, east);
    expect(distance).toBeGreaterThan(1_100);
    expect(distance).toBeLessThan(1_300);
    // Long-way would be ~20_400 nm — must not be near half-earth.
    expect(distance).toBeLessThan(5_000);

    const bearingEast = initialBearingDegrees(west, east);
    expect(bearingEast).toBeGreaterThan(80);
    expect(bearingEast).toBeLessThan(100);

    const bearingWest = initialBearingDegrees(east, west);
    expect(bearingWest).toBeGreaterThan(260);
    expect(bearingWest).toBeLessThan(280);
  });

  it("interpolates across the antimeridian on the short arc", () => {
    const from = derivePositionSnapshot(
      { latitude: 0, longitude: 170, speed: 400 },
      "2026-07-24T12:00:00.000Z",
      undefined,
      "aircraft",
    );
    const mid = interpolatePositionSnapshot(
      from,
      { latitude: 0, longitude: -170, speed: 400 },
      Date.parse(from.at),
      Date.parse("2026-07-24T15:00:00.000Z"),
      Date.parse("2026-07-24T13:30:00.000Z"),
      "aircraft",
    );
    // Halfway along 170 → 190 (unwrapped) normalizes near ±180.
    expect(Math.abs(Math.abs(mid.longitude) - 180)).toBeLessThan(5);
    expect(mid.latitude).toBeCloseTo(0, 0);
  });

  it("derives speed and heading from previous snapshot", () => {
    const previous = derivePositionSnapshot(
      { latitude: 51.5, longitude: -0.1 },
      "2026-07-24T12:00:00.000Z",
    );
    const current = derivePositionSnapshot(
      { latitude: 51.51, longitude: 0.05, altitude: 500 },
      "2026-07-24T12:10:00.000Z",
      previous,
      "boat",
    );
    expect(current.speed).toBeGreaterThan(0);
    expect(current.speed).toBeLessThanOrEqual(CATEGORY_TOP_SPEED_KNOTS.boat);
    expect(current.heading).toBeGreaterThan(0);
    expect(current.altitude).toBe(500);
  });

  it("prefers authored speed over derived speed", () => {
    const previous = derivePositionSnapshot(
      { latitude: 51.5, longitude: -0.1, speed: 12 },
      "2026-07-24T12:00:00.000Z",
    );
    expect(previous.speed).toBe(12);

    const current = derivePositionSnapshot(
      { latitude: 51.51, longitude: 0.05, speed: 42 },
      "2026-07-24T12:10:00.000Z",
      previous,
      "boat",
    );
    expect(current.speed).toBe(42);
  });

  it("clamps derived speed to the vehicle category top speed", () => {
    const previous = derivePositionSnapshot(
      { latitude: 51.5074, longitude: -0.1278 },
      "2026-07-24T12:00:00.000Z",
    );
    // ~6.7 nm in 15 seconds would imply ~1600 kt without a clamp.
    const current = derivePositionSnapshot(
      { latitude: 51.515, longitude: 0.05 },
      "2026-07-24T12:00:15.000Z",
      previous,
      "boat",
    );
    expect(current.speed).toBe(CATEGORY_TOP_SPEED_KNOTS.boat);
  });

  it("allows fighter-class aircraft speeds up to the aircraft top", () => {
    const previous = derivePositionSnapshot(
      { latitude: 51.5, longitude: -0.1, speed: 1_200 },
      "2026-07-24T12:00:00.000Z",
      undefined,
      "aircraft",
    );
    const current = derivePositionSnapshot(
      { latitude: 51.6, longitude: 0.2, speed: 1_650 },
      "2026-07-24T12:05:00.000Z",
      previous,
      "aircraft",
    );
    expect(current.speed).toBe(1_650);
    expect(current.speed).toBeLessThanOrEqual(CATEGORY_TOP_SPEED_KNOTS.aircraft);
  });

  it("uses authored speed while interpolating generated legs", () => {
    const from = derivePositionSnapshot(
      { latitude: 51.5, longitude: -0.1, speed: 30 },
      "2026-07-24T12:00:00.000Z",
      undefined,
      "car",
    );
    const interpolated = interpolatePositionSnapshot(
      from,
      { latitude: 51.51, longitude: -0.09, speed: 30 },
      Date.parse(from.at),
      Date.parse("2026-07-24T12:10:00.000Z"),
      Date.parse("2026-07-24T12:05:00.000Z"),
      "car",
    );
    expect(interpolated.speed).toBe(30);
  });

  it("validates event payloads", () => {
    expect(hasEventPayload({ message: "hello" })).toBe(true);
    expect(hasEventPayload({ position: { latitude: 1, longitude: 2 } })).toBe(true);
    expect(hasEventPayload({})).toBe(false);
  });
});
