import { describe, expect, it } from "vitest";

import {
  CATEGORY_SPEED_RANGES,
  CATEGORY_TOP_SPEED_KNOTS,
  categoryCruiseMidpointKnots,
  deriveEndAtFromDistance,
  generateRouteEvents,
  MAX_GENERATED_EVENTS,
} from "@/lib/event-generator";
import { haversineDistanceNm, initialBearingDegrees } from "@/lib/position-telemetry";
import { createSeededRandom } from "@/lib/random";
import { VEHICLE_CATEGORIES } from "@/types/target";

function headingDifference(first: number, second: number) {
  return Math.abs(((second - first + 540) % 360) - 180);
}

describe("event generator", () => {
  it("generates the requested number of position-only events", () => {
    let index = 0;
    const events = generateRouteEvents({
      targetId: "target-1",
      count: 8,
      startAt: "2026-07-24T12:00:00.000Z",
      endAt: "2026-07-24T13:00:00.000Z",
      startPoint: { latitude: 51.5, longitude: -0.12, altitude: 0 },
      vehicleCategory: "car",
      random: () => 0.5,
      idFactory: () => `event-${index++}`,
    });
    expect(events).toHaveLength(8);
    expect(events.every((event) => event.position && !event.message)).toBe(true);
    expect(events.every((event) => typeof event.position?.speed === "number")).toBe(true);
  });

  it("respects category speed ranges and distributes timestamps", () => {
    let seed = 0;
    const random = () => {
      seed += 0.17;
      return seed % 1;
    };
    const events = generateRouteEvents({
      targetId: "target-1",
      count: 5,
      startAt: "2026-07-24T12:00:00.000Z",
      endAt: "2026-07-24T14:00:00.000Z",
      startPoint: { latitude: 48.85, longitude: 2.35, altitude: 0 },
      vehicleCategory: "car",
      random,
      idFactory: () => crypto.randomUUID(),
    });
    const range = CATEGORY_SPEED_RANGES.car;
    expect(range.minKnots).toBeLessThan(range.maxKnots);
    expect(Date.parse(events[0]?.at ?? "")).toBeLessThan(Date.parse(events.at(-1)?.at ?? ""));
    expect(events.at(-1)?.position?.latitude).not.toBe(events[0]?.position?.latitude);

    for (const event of events) {
      const speed = event.position?.speed ?? 0;
      expect(speed).toBeGreaterThanOrEqual(range.minKnots);
      expect(speed).toBeLessThanOrEqual(range.maxKnots);
      expect(speed).toBeLessThanOrEqual(CATEGORY_TOP_SPEED_KNOTS.car);
    }
  });

  it("keeps distance consistent with authored speed and elapsed time", () => {
    const events = generateRouteEvents({
      targetId: "target-1",
      count: 10,
      startAt: "2026-07-24T12:00:00.000Z",
      endAt: "2026-07-24T13:00:00.000Z",
      startPoint: { latitude: 51.5, longitude: -0.12, altitude: 8_000 },
      vehicleCategory: "aircraft",
      random: () => 0.42,
      idFactory: () => crypto.randomUUID(),
    });

    for (let index = 1; index < events.length; index += 1) {
      const previous = events[index - 1]!;
      const current = events[index]!;
      const elapsedHours =
        (Date.parse(current.at) - Date.parse(previous.at)) / 3_600_000;
      const expectedDistance = (current.position?.speed ?? 0) * elapsedHours;
      const actualDistance = haversineDistanceNm(previous.position!, current.position!);
      expect(Math.abs(actualDistance - expectedDistance)).toBeLessThan(0.05);
    }
  });

  it("keeps generation ranges within category top speeds", () => {
    for (const category of VEHICLE_CATEGORIES) {
      const range = CATEGORY_SPEED_RANGES[category];
      expect(range.maxKnots).toBeLessThanOrEqual(CATEGORY_TOP_SPEED_KNOTS[category]);
    }
    expect(CATEGORY_TOP_SPEED_KNOTS.aircraft).toBeGreaterThanOrEqual(1_500);
  });

  it("caps extreme counts defensively", () => {
    const events = generateRouteEvents({
      targetId: "target-1",
      count: MAX_GENERATED_EVENTS + 100,
      startAt: "2026-07-24T12:00:00.000Z",
      endAt: "2026-07-24T13:00:00.000Z",
      startPoint: { latitude: 40, longitude: -74, altitude: 0 },
      vehicleCategory: "truck",
      random: () => 0.25,
      idFactory: () => crypto.randomUUID(),
    });
    expect(events).toHaveLength(MAX_GENERATED_EVENTS);
  });

  it.each([
    ["aircraft", 5],
    ["boat", 8],
  ] as const)("creates smooth, frequent %s movement updates", (vehicleCategory, maximumTurn) => {
    const random = createSeededRandom(42);
    const events = generateRouteEvents({
      targetId: "target-smooth",
      count: 60,
      startAt: "2026-07-24T12:00:00.000Z",
      endAt: "2026-07-24T13:00:00.000Z",
      startPoint: { latitude: 51.5, longitude: -0.12, altitude: 2_000 },
      vehicleCategory,
      random,
      idFactory: () => crypto.randomUUID(),
    });
    const bearings = events
      .slice(1)
      .map((event, index) =>
        initialBearingDegrees(
          events[index]?.position ?? { latitude: 0, longitude: 0 },
          event.position ?? { latitude: 0, longitude: 0 },
        ),
      );
    const turnDeltas = bearings
      .slice(1)
      .map((bearing, index) => headingDifference(bearings[index] ?? bearing, bearing));

    expect(events).toHaveLength(60);
    expect(Math.max(...turnDeltas)).toBeLessThanOrEqual(maximumTurn);
  });

  it("derives end time from distance and aircraft cruise midpoint", () => {
    const startPoint = { latitude: 51.5, longitude: -0.12, altitude: 8_000 };
    const endPoint = { latitude: 52.2, longitude: 0.12, altitude: 8_000 };
    const startAt = "2026-07-24T12:00:00.000Z";
    const endAt = deriveEndAtFromDistance({
      startAt,
      startPoint,
      endPoint,
      vehicleCategory: "aircraft",
    });
    const distanceNm = haversineDistanceNm(startPoint, endPoint);
    const hours =
      (Date.parse(endAt) - Date.parse(startAt)) / 3_600_000;
    const impliedKnots = distanceNm / hours;
    expect(impliedKnots).toBeCloseTo(categoryCruiseMidpointKnots("aircraft") / 1.08, 2);
  });

  it("snaps the final event to the end point and keeps speed×time physics", () => {
    let index = 0;
    const startPoint = { latitude: 51.5, longitude: -0.12, altitude: 8_000 };
    const endPoint = { latitude: 52.0, longitude: 0.0, altitude: 10_000 };
    const events = generateRouteEvents({
      targetId: "target-ab",
      count: 12,
      startAt: "2026-07-24T12:00:00.000Z",
      startPoint,
      endPoint,
      vehicleCategory: "aircraft",
      random: () => 0.37,
      idFactory: () => `ab-${index++}`,
    });

    expect(events[0]?.position?.latitude).toBeCloseTo(startPoint.latitude, 5);
    expect(events[0]?.position?.longitude).toBeCloseTo(startPoint.longitude, 5);
    expect(events.at(-1)?.position?.latitude).toBeCloseTo(endPoint.latitude, 5);
    expect(events.at(-1)?.position?.longitude).toBeCloseTo(endPoint.longitude, 5);
    expect(events.at(-1)?.position?.altitude).toBeCloseTo(10_000, 5);
    expect(events[0]?.position?.altitude).toBeCloseTo(8_000, 5);

    for (let eventIndex = 1; eventIndex < events.length; eventIndex += 1) {
      const previous = events[eventIndex - 1]!;
      const current = events[eventIndex]!;
      const elapsedHours =
        (Date.parse(current.at) - Date.parse(previous.at)) / 3_600_000;
      const expectedDistance = (current.position?.speed ?? 0) * elapsedHours;
      const actualDistance = haversineDistanceNm(previous.position!, current.position!);
      expect(Math.abs(actualDistance - expectedDistance)).toBeLessThan(0.05);
    }
  });

  it("does not pad a long-haul A→B route with parked zero-speed leftover events", () => {
    let index = 0;
    const startPoint = { latitude: -27.704648, longitude: 149.923111, altitude: 0 };
    const endPoint = { latitude: 44.261976, longitude: -65.895905, altitude: 0 };
    const startAt = "2026-07-26T14:23:46.244Z";
    const endAt = deriveEndAtFromDistance({
      startAt,
      startPoint,
      endPoint,
      vehicleCategory: "aircraft",
    });
    // High random() biases toward max heading/speed noise — previously arrived early
    // and filled the rest of the window with identical parked points.
    const events = generateRouteEvents({
      targetId: "target-pacific",
      count: 60,
      startAt,
      endAt,
      startPoint,
      endPoint,
      vehicleCategory: "aircraft",
      random: () => 0.92,
      idFactory: () => `pac-${index++}`,
    });

    expect(events.at(-1)?.position?.latitude).toBeCloseTo(endPoint.latitude, 4);
    expect(events.at(-1)?.position?.longitude).toBeCloseTo(endPoint.longitude, 4);

    let parkedTail = 0;
    for (let eventIndex = 1; eventIndex < events.length; eventIndex += 1) {
      const previous = events[eventIndex - 1]!;
      const current = events[eventIndex]!;
      const moved = haversineDistanceNm(previous.position!, current.position!);
      if (moved < 0.05 && (current.position?.speed ?? 0) < 1) {
        parkedTail += 1;
      }
    }
    expect(parkedTail).toBeLessThanOrEqual(1);

    // Still progressing for most of the schedule — last event near derived endAt.
    const lastMs = Date.parse(events.at(-1)!.at);
    const endMs = Date.parse(endAt);
    expect(Math.abs(lastMs - endMs)).toBeLessThan(15 * 60_000);
  });

  it("rejects an end window that exceeds aircraft max speed for the straight-line distance", () => {
    expect(() =>
      generateRouteEvents({
        targetId: "target-ab",
        count: 8,
        startAt: "2026-07-24T12:00:00.000Z",
        endAt: "2026-07-24T12:01:00.000Z",
        startPoint: { latitude: 51.5, longitude: -0.12, altitude: 8_000 },
        endPoint: { latitude: 55.0, longitude: 5.0, altitude: 8_000 },
        vehicleCategory: "aircraft",
        random: () => 0.5,
        idFactory: () => crypto.randomUUID(),
      }),
    ).toThrow(/maximum/i);
  });

  it("requires end time when no end point is provided", () => {
    expect(() =>
      generateRouteEvents({
        targetId: "target-1",
        count: 4,
        startAt: "2026-07-24T12:00:00.000Z",
        startPoint: { latitude: 51.5, longitude: -0.12, altitude: 0 },
        vehicleCategory: "car",
        random: () => 0.5,
        idFactory: () => crypto.randomUUID(),
      }),
    ).toThrow(/end time/i);
  });

  it("stays within maxAbsLatitude and turns gradually near the bound", () => {
    const random = createSeededRandom(7);
    const maxAbsLatitude = 85;
    const events = generateRouteEvents({
      targetId: "target-bound",
      count: 80,
      startAt: "2026-07-24T12:00:00.000Z",
      endAt: "2026-07-24T18:00:00.000Z",
      startPoint: { latitude: 82, longitude: -20, altitude: 30_000 },
      vehicleCategory: "aircraft",
      maxAbsLatitude,
      random,
      idFactory: () => crypto.randomUUID(),
    });

    for (const event of events) {
      expect(Math.abs(event.position?.latitude ?? 999)).toBeLessThanOrEqual(maxAbsLatitude + 1e-6);
    }

    const bearings = events
      .slice(1)
      .map((event, index) =>
        initialBearingDegrees(
          events[index]?.position ?? { latitude: 0, longitude: 0 },
          event.position ?? { latitude: 0, longitude: 0 },
        ),
      );
    const turnDeltas = bearings
      .slice(1)
      .map((bearing, index) => headingDifference(bearings[index] ?? bearing, bearing));

    // Soft steer near the clip — never a hard 180° bounce spike.
    expect(Math.max(...turnDeltas)).toBeLessThanOrEqual(12);
    expect(events.some((event) => Math.abs(event.position?.latitude ?? 0) > 78)).toBe(true);
  });
});
