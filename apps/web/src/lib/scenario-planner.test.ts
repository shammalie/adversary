import { describe, expect, it } from "vitest";

import {
  resolveGroupPlacement,
  type DemoRegion,
} from "@/lib/demo-scenario";
import { createSeededRandom } from "@/lib/random";
import {
  planDemoScenario,
  resolveOtherRouteMode,
  resolveRouteMode,
} from "@/lib/scenario-planner";

const seededRandom = (initial = 11) => createSeededRandom(initial);

const MARITIME_ONLY: DemoRegion = {
  id: "test-maritime",
  name: "Test Maritime Only",
  bbox: [0, 50, 2, 52],
  supports: ["boat", "aircraft", "other"],
};

const LAND_ONLY: DemoRegion = {
  id: "test-land",
  name: "Test Land Only",
  bbox: [-1, 51, 0.5, 52],
  supports: ["car", "truck", "aircraft", "other"],
};

function sequentialIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

describe("region placement", () => {
  it("never assigns cars/trucks to a maritime-only selected region", () => {
    const catalog = [MARITIME_ONLY, LAND_ONLY];
    for (let i = 0; i < 20; i += 1) {
      const car = resolveGroupPlacement(
        "car",
        null,
        ["test-maritime"],
        seededRandom(i + 1),
        false,
        catalog,
      );
      expect(car.regionId).toBeNull();
      expect(car.anywhereFallback).toBe(true);

      const boat = resolveGroupPlacement(
        "boat",
        null,
        ["test-maritime"],
        seededRandom(i + 1),
        false,
        catalog,
      );
      expect(boat.regionId).toBe("test-maritime");
      expect(boat.anywhereFallback).toBe(false);
    }
  });

  it("relocates an incompatible category to another selected region when possible", () => {
    const placement = resolveGroupPlacement(
      "car",
      null,
      ["test-maritime", "test-land"],
      seededRandom(5),
      false,
      [MARITIME_ONLY, LAND_ONLY],
    );
    expect(placement.regionId).toBe("test-land");
    expect(placement.anywhereFallback).toBe(false);
  });

  it("pin beats region selection", () => {
    const pin = { latitude: 40.0, longitude: -75.0 };
    const placement = resolveGroupPlacement(
      "boat",
      pin,
      ["test-maritime"],
      seededRandom(2),
      false,
      [MARITIME_ONLY],
    );
    expect(placement.regionId).toBeNull();
    expect(placement.anywhereFallback).toBe(false);
    expect(Math.abs(placement.base.latitude - pin.latitude)).toBeLessThan(0.2);
    expect(Math.abs(placement.base.longitude - pin.longitude)).toBeLessThan(0.3);
  });
});

describe("route mode helpers", () => {
  it("routes other by water terrain flag", () => {
    expect(resolveOtherRouteMode(true)).toBe("sea");
    expect(resolveOtherRouteMode(false)).toBe("road");
  });

  it("maps categories to router modes", () => {
    expect(resolveRouteMode("aircraft", null)).toBe("air");
    expect(resolveRouteMode("boat", null)).toBe("sea");
    expect(resolveRouteMode("car", null)).toBe("road");
    expect(resolveRouteMode("truck", null)).toBe("road");
  });
});

describe("planDemoScenario", () => {
  it("degrades per-track rather than all-or-nothing", async () => {
    let calls = 0;
    const result = await planDemoScenario(
      1_735_000_000_000,
      seededRandom(3),
      {
        vehicleSelection: ["car", "aircraft"],
        targetCount: 4,
        origin: { latitude: 51.5, longitude: -0.12 },
        idFactory: sequentialIds("deg"),
        concurrency: 2,
      },
      {
        aerodromes: [
          {
            icao: "EGLL",
            iata: "LHR",
            name: "Heathrow",
            class: "international",
            eleFt: 83,
            latitude: 51.47,
            longitude: -0.46,
            runways: [{ ref: "09L", headingDeg: 90 }],
          },
          {
            icao: "EGKK",
            iata: "LGW",
            name: "Gatwick",
            class: "international",
            eleFt: 202,
            latitude: 51.15,
            longitude: -0.19,
            runways: [{ ref: "08R", headingDeg: 80 }],
          },
        ],
        routeFn: async ({ mode }) => {
          calls += 1;
          if (mode === "road") {
            throw new Error("tile failure");
          }
          return [
            { longitude: -0.46, latitude: 51.47 },
            { longitude: -0.19, latitude: 51.15 },
          ];
        },
      },
    );

    expect(result.cancelled).toBe(false);
    expect(result.scenario.targets).toHaveLength(4);
    expect(result.degradedTrackCount).toBeGreaterThan(0);
    expect(result.degradedTrackCount).toBeLessThan(4);
    expect(calls).toBeGreaterThan(0);
  });

  it("cancellation mid-generation leaves no partial writes", async () => {
    const controller = new AbortController();

    const slowRoute = () =>
      new Promise<{ longitude: number; latitude: number }[]>((resolve) => {
        setTimeout(() => {
          resolve([
            { longitude: 0, latitude: 50 },
            { longitude: 1, latitude: 51 },
          ]);
        }, 80);
      });

    queueMicrotask(() => controller.abort());

    const result = await planDemoScenario(
      1_735_000_000_000,
      seededRandom(1),
      {
        vehicleSelection: ["car"],
        targetCount: 6,
        origin: { latitude: 51.5, longitude: -0.12 },
        signal: controller.signal,
        idFactory: sequentialIds("cancel"),
        concurrency: 2,
      },
      { routeFn: async () => slowRoute() },
    );

    expect(result.cancelled).toBe(true);
    expect(result.scenario.targets).toHaveLength(0);
    expect(result.scenario.events).toHaveLength(0);
  });

  it("seeded run with idFactory is reproducible", async () => {
    const options = {
      vehicleSelection: ["aircraft"] as const,
      targetCount: 3,
      origin: { latitude: 51.5, longitude: -0.12 },
      seed: 99,
      forceSynthetic: true,
    };

    const first = await planDemoScenario(1_000, Math.random, {
      ...options,
      idFactory: sequentialIds("a"),
    });
    const second = await planDemoScenario(1_000, Math.random, {
      ...options,
      idFactory: sequentialIds("a"),
    });

    expect(first.scenario.targets.map((t) => t.callsign)).toEqual(
      second.scenario.targets.map((t) => t.callsign),
    );
    expect(
      first.scenario.events
        .filter((e) => e.position)
        .map((e) => [e.position!.latitude, e.position!.longitude]),
    ).toEqual(
      second.scenario.events
        .filter((e) => e.position)
        .map((e) => [e.position!.latitude, e.position!.longitude]),
    );
  });

  it("seed alone (no idFactory) reproduces scenario ids and geometry", async () => {
    const options = {
      vehicleSelection: ["aircraft"] as const,
      targetCount: 3,
      origin: { latitude: 51.5, longitude: -0.12 },
      seed: 42,
      forceSynthetic: true,
    };

    const first = await planDemoScenario(1_000, Math.random, options);
    const second = await planDemoScenario(1_000, Math.random, options);

    expect(first.scenario.id).toBe(second.scenario.id);
    expect(first.scenario.targets.map((t) => t.id)).toEqual(
      second.scenario.targets.map((t) => t.id),
    );
    expect(first.scenario.events.map((e) => e.id)).toEqual(
      second.scenario.events.map((e) => e.id),
    );
    expect(
      first.scenario.events
        .filter((e) => e.position)
        .map((e) => [e.position!.latitude, e.position!.longitude]),
    ).toEqual(
      second.scenario.events
        .filter((e) => e.position)
        .map((e) => [e.position!.latitude, e.position!.longitude]),
    );
  });

  it("reports anywhere fallback for incompatible maritime-only selection", async () => {
    const result = await planDemoScenario(
      1_735_000_000_000,
      seededRandom(8),
      {
        vehicleSelection: ["car"],
        targetCount: 4,
        regions: ["test-maritime"],
        regionCatalog: [MARITIME_ONLY],
        forceSynthetic: true,
        idFactory: sequentialIds("fb"),
      },
    );
    expect(result.anywhereFallbackCount).toBe(4);
    expect(result.scenario.targets).toHaveLength(4);
  });

  it("streams aircraft before surface contacts when mixed", async () => {
    const liveOrder: string[] = [];
    // Alternate categories so we get both aircraft and cars.
    let flip = 0;
    const alternating = () => {
      flip += 1;
      // First half of picks lean aircraft (high), then car (low) within a
      // two-item pool: values < 0.5 → car, >= 0.5 → aircraft.
      return flip % 2 === 0 ? 0.75 : 0.1;
    };
    await planDemoScenario(
      1_735_000_000_000,
      alternating,
      {
        vehicleSelection: ["car", "aircraft"],
        targetCount: 4,
        origin: { latitude: 51.5, longitude: -0.12 },
        idFactory: sequentialIds("live"),
        concurrency: 4,
        onTargetReady: (update) => {
          liveOrder.push(update.target.profile.vehicleCategory);
        },
      },
      {
        aerodromes: [
          {
            icao: "EGLL",
            iata: "LHR",
            name: "Heathrow",
            class: "international",
            eleFt: 83,
            latitude: 51.47,
            longitude: -0.46,
            runways: [{ ref: "09L", headingDeg: 90 }],
          },
          {
            icao: "EGKK",
            iata: "LGW",
            name: "Gatwick",
            class: "international",
            eleFt: 202,
            latitude: 51.15,
            longitude: -0.19,
            runways: [{ ref: "08R", headingDeg: 80 }],
          },
        ],
        routeFn: async () => {
          await new Promise((r) => setTimeout(r, 30));
          return [
            { longitude: -0.12, latitude: 51.5 },
            { longitude: -0.1, latitude: 51.52 },
          ];
        },
      },
    );
    expect(liveOrder).toContain("aircraft");
    expect(liveOrder).toContain("car");
    const firstNonAir = liveOrder.findIndex((c) => c !== "aircraft");
    if (firstNonAir > 0) {
      expect(liveOrder.slice(0, firstNonAir).every((c) => c === "aircraft")).toBe(
        true,
      );
    } else {
      // All aircraft first (no cars yet) or aircraft were scheduled first.
      expect(liveOrder[0]).toBe("aircraft");
    }
  });
});
