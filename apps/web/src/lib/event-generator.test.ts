import { describe, expect, it } from "vitest";

import {
  CATEGORY_SPEED_RANGES,
  CATEGORY_TOP_SPEED_KNOTS,
  generateRouteEvents,
  MAX_GENERATED_EVENTS,
} from "@/lib/event-generator";
import { haversineDistanceNm, initialBearingDegrees } from "@/lib/position-telemetry";
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
    let seed = 42;
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed / 4_294_967_296;
    };
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
});
