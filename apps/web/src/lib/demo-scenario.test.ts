import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  createDemoScenario,
  createSyntheticDemoScenario,
  parseDemoTargetCount,
} from "@/lib/demo-scenario";
import {
  classifyPoint,
  createFixtureFeatureSource,
  haversineMeters,
} from "@/lib/geo/terrain";
import { tileLocalToLngLat } from "@/lib/geo/vector-tile-client";
import { createSeededRandom } from "@/lib/random";
import { planDemoScenario } from "@/lib/scenario-planner";
import { simulationScenarioSchema } from "@/lib/simulation-schema";
import { CATEGORY_SPEED_RANGES, CATEGORY_TOP_SPEED_KNOTS } from "@/lib/vehicle-speed";
import { VEHICLE_CATEGORIES } from "@/types/target";

const seededRandom = (initial = 11) => createSeededRandom(initial);

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "geo/fixtures/tiles",
);

type ManifestEntry = {
  id: string;
  file: string;
  z: number;
  x: number;
  y: number;
};

function loadFixtureSource(ids: string[]) {
  const manifest = JSON.parse(
    readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8"),
  ) as ManifestEntry[];
  const tiles = ids.map((id) => {
    const entry = manifest.find((m) => m.id === id);
    if (!entry) throw new Error(`Missing fixture ${id}`);
    const bytes = readFileSync(join(FIXTURE_DIR, entry.file));
    return { z: entry.z, x: entry.x, y: entry.y, bytes };
  });
  return { source: createFixtureFeatureSource(tiles), tiles };
}

describe("demo scenario", () => {
  it("builds a valid scenario from generated routes", () => {
    const scenario = createSyntheticDemoScenario(1_735_000_000_000, seededRandom(), {
      targetCount: 2,
    });
    expect(simulationScenarioSchema.safeParse(scenario).success).toBe(true);
    expect(scenario.targets).toHaveLength(2);
    expect(scenario.events.some((event) => event.position)).toBe(true);
    expect(scenario.events.some((event) => event.message)).toBe(true);
  });

  it("picks a target count between 2 and 100 when not specified", () => {
    const scenario = createSyntheticDemoScenario(1_735_000_000_000, seededRandom(42));
    expect(scenario.targets.length).toBeGreaterThanOrEqual(2);
    expect(scenario.targets.length).toBeLessThanOrEqual(100);
  });

  it("uses an explicit target count when provided", () => {
    const scenario = createSyntheticDemoScenario(1_735_000_000_000, seededRandom(), {
      targetCount: 7,
    });
    expect(scenario.targets).toHaveLength(7);
  });

  it("clamps out-of-range target counts into 2–100", () => {
    expect(
      createSyntheticDemoScenario(1_735_000_000_000, seededRandom(), {
        targetCount: 1,
      }).targets,
    ).toHaveLength(2);
    expect(
      createSyntheticDemoScenario(1_735_000_000_000, seededRandom(), {
        targetCount: 250,
      }).targets,
    ).toHaveLength(100);
  });

  it("uses a single vehicle category when one type is selected", () => {
    const scenario = createSyntheticDemoScenario(Date.now(), () => 0.55, {
      vehicleSelection: ["aircraft"],
      targetCount: 5,
    });
    expect(scenario.targets).toHaveLength(5);
    expect(
      scenario.targets.every((target) => target.profile.vehicleCategory === "aircraft"),
    ).toBe(true);
  });

  it("picks only from a multi-selected vehicle pool", () => {
    const pool = ["aircraft", "boat"] as const;
    const scenario = createSyntheticDemoScenario(1_735_000_000_000, seededRandom(3), {
      vehicleSelection: pool,
      targetCount: 20,
    });
    for (const target of scenario.targets) {
      expect(pool).toContain(target.profile.vehicleCategory);
    }
    const categories = new Set(
      scenario.targets.map((target) => target.profile.vehicleCategory),
    );
    expect(categories.size).toBeGreaterThan(1);
  });

  it("can mix vehicle categories in random mode", () => {
    const scenario = createSyntheticDemoScenario(1_735_000_000_000, seededRandom(7), {
      vehicleSelection: "random",
      targetCount: 20,
    });
    const categories = new Set(
      scenario.targets.map((target) => target.profile.vehicleCategory),
    );
    expect(categories.size).toBeGreaterThan(1);
    for (const category of categories) {
      expect(VEHICLE_CATEGORIES).toContain(category);
    }
  });

  it("authors speeds within category bounds on every position event", () => {
    const scenario = createSyntheticDemoScenario(Date.now(), () => 0.55, { targetCount: 3 });
    for (const event of scenario.events) {
      if (!event.position) continue;
      const target = scenario.targets.find((candidate) => candidate.id === event.targetId);
      expect(target).toBeDefined();
      const category = target!.profile.vehicleCategory;
      const speed = event.position.speed;
      expect(typeof speed).toBe("number");
      expect(speed).toBeGreaterThanOrEqual(CATEGORY_SPEED_RANGES[category].minKnots);
      expect(speed).toBeLessThanOrEqual(CATEGORY_SPEED_RANGES[category].maxKnots);
      expect(speed).toBeLessThanOrEqual(CATEGORY_TOP_SPEED_KNOTS[category]);
    }
  });

  it("produces different tracks across loads", () => {
    const first = createSyntheticDemoScenario(1_000, () => 0.1, { targetCount: 2 });
    const second = createSyntheticDemoScenario(1_000, () => 0.9, { targetCount: 2 });
    const firstLat = first.events.find((event) => event.position)?.position?.latitude;
    const secondLat = second.events.find((event) => event.position)?.position?.latitude;
    const firstLast = first.events.filter((event) => event.position).at(-1)?.position;
    const secondLast = second.events.filter((event) => event.position).at(-1)?.position;
    expect(firstLat).toBeDefined();
    expect(secondLat).toBeDefined();
    expect(
      firstLast?.latitude !== secondLast?.latitude ||
        firstLast?.longitude !== secondLast?.longitude,
    ).toBe(true);
  });

  it("schedules tracks relative to an explicit start time", () => {
    const startAt = "2030-01-15T12:00:00.000Z";
    const scenario = createSyntheticDemoScenario(1_735_000_000_000, seededRandom(), {
      targetCount: 2,
      startAt,
      origin: { latitude: 51.5, longitude: -0.12 },
    });
    const times = scenario.events.map((event) => Date.parse(event.at));
    expect(Math.min(...times)).toBeGreaterThanOrEqual(Date.parse(startAt));
  });

  it("keeps all tracks inside an optional end window", () => {
    const startAt = "2030-01-15T12:00:00.000Z";
    const endAt = "2030-01-15T14:00:00.000Z";
    const scenario = createSyntheticDemoScenario(1_735_000_000_000, seededRandom(9), {
      targetCount: 5,
      startAt,
      endAt,
      origin: { latitude: 40.7, longitude: -74.0 },
    });
    const startMs = Date.parse(startAt);
    const endMs = Date.parse(endAt);
    for (const event of scenario.events) {
      const at = Date.parse(event.at);
      expect(at).toBeGreaterThanOrEqual(startMs);
      expect(at).toBeLessThanOrEqual(endMs);
    }
  });

  it("scatters starts around a provided origin", () => {
    const origin = { latitude: 1.25, longitude: 103.85 };
    const scenario = createSyntheticDemoScenario(1_735_000_000_000, seededRandom(4), {
      targetCount: 3,
      origin,
    });
    for (const target of scenario.targets) {
      const position = scenario.events
        .filter((event) => event.targetId === target.id && event.position)
        .toSorted((a, b) => a.at.localeCompare(b.at))[0]?.position;
      expect(position).toBeDefined();
      expect(Math.abs(position!.latitude - origin.latitude)).toBeLessThan(0.2);
      expect(Math.abs(position!.longitude - origin.longitude)).toBeLessThan(0.3);
    }
  });

  it("keeps all demo track latitudes inside the Mercator-safe band", () => {
    const scenario = createSyntheticDemoScenario(1_735_000_000_000, seededRandom(8), {
      vehicleSelection: ["aircraft"],
      targetCount: 20,
    });
    for (const event of scenario.events) {
      if (!event.position) continue;
      expect(Math.abs(event.position.latitude)).toBeLessThanOrEqual(85);
    }
  });

  it("sometimes groups same-category targets on nearby shared corridors", () => {
    const scenario = createSyntheticDemoScenario(1_735_000_000_000, seededRandom(19), {
      vehicleSelection: ["aircraft"],
      targetCount: 24,
      origin: { latitude: 51.5, longitude: -0.12 },
      groupJoinProbability: 0.85,
    });
    const starts = scenario.targets.map((target) => {
      const position = scenario.events
        .filter((event) => event.targetId === target.id && event.position)
        .toSorted((a, b) => a.at.localeCompare(b.at))[0]?.position;
      expect(position).toBeDefined();
      return position!;
    });

    let closePairs = 0;
    for (let i = 0; i < starts.length; i += 1) {
      for (let j = i + 1; j < starts.length; j += 1) {
        const latDelta = Math.abs(starts[i]!.latitude - starts[j]!.latitude);
        const lngDelta = Math.abs(starts[i]!.longitude - starts[j]!.longitude);
        if (latDelta < 0.04 && lngDelta < 0.04) closePairs += 1;
      }
    }
    expect(closePairs).toBeGreaterThan(0);

    const midpoints = scenario.targets.map((target) => {
      const positions = scenario.events
        .filter((event) => event.targetId === target.id && event.position)
        .toSorted((a, b) => a.at.localeCompare(b.at));
      return positions[Math.floor(positions.length / 2)]?.position;
    });
    let midClosePairs = 0;
    for (let i = 0; i < midpoints.length; i += 1) {
      for (let j = i + 1; j < midpoints.length; j += 1) {
        const a = midpoints[i];
        const b = midpoints[j];
        if (!a || !b) continue;
        if (Math.abs(a.latitude - b.latitude) < 0.08 && Math.abs(a.longitude - b.longitude) < 0.08) {
          midClosePairs += 1;
        }
      }
    }
    expect(midClosePairs).toBeGreaterThan(0);
  });

  it("varies aircraft starting altitudes and keeps non-aircraft at surface", () => {
    const scenario = createSyntheticDemoScenario(1_735_000_000_000, seededRandom(21), {
      vehicleSelection: ["aircraft", "boat"],
      targetCount: 30,
      origin: { latitude: 50.7, longitude: -1.1 },
    });

    const aircraftAlts: number[] = [];
    const boatAlts: number[] = [];
    for (const target of scenario.targets) {
      const start = scenario.events
        .filter((event) => event.targetId === target.id && event.position)
        .toSorted((a, b) => a.at.localeCompare(b.at))[0]?.position;
      expect(start).toBeDefined();
      if (target.profile.vehicleCategory === "aircraft") {
        aircraftAlts.push(start!.altitude ?? 0);
      } else if (target.profile.vehicleCategory === "boat") {
        boatAlts.push(start!.altitude ?? 0);
      }
    }

    expect(aircraftAlts.length).toBeGreaterThan(1);
    expect(boatAlts.length).toBeGreaterThan(0);
    expect(Math.min(...aircraftAlts)).toBeGreaterThan(0);
    expect(Math.max(...aircraftAlts) - Math.min(...aircraftAlts)).toBeGreaterThan(5_000);
    expect(boatAlts.every((altitude) => altitude === 0)).toBe(true);
  });

  it("seed alone makes synthetic scenarios fully reproducible including ids", () => {
    const first = createSyntheticDemoScenario(1_000, Math.random, {
      seed: 77,
      targetCount: 3,
      vehicleSelection: ["aircraft"],
      origin: { latitude: 51.5, longitude: -0.12 },
    });
    const second = createSyntheticDemoScenario(1_000, Math.random, {
      seed: 77,
      targetCount: 3,
      vehicleSelection: ["aircraft"],
      origin: { latitude: 51.5, longitude: -0.12 },
    });
    expect(first.id).toBe(second.id);
    expect(first.targets.map((t) => t.id)).toEqual(second.targets.map((t) => t.id));
    expect(first.events.map((e) => e.id)).toEqual(second.events.map((e) => e.id));
    expect(
      first.events
        .filter((e) => e.position)
        .map((e) => [e.position!.latitude, e.position!.longitude]),
    ).toEqual(
      second.events
        .filter((e) => e.position)
        .map((e) => [e.position!.latitude, e.position!.longitude]),
    );
  });
});

describe("createDemoScenario (async)", () => {
  it("returns a valid scenario via the async geo planner path", async () => {
    const result = await createDemoScenario(1_735_000_000_000, Math.random, {
      seed: 12,
      targetCount: 2,
      vehicleSelection: ["aircraft"],
      origin: { latitude: 51.5, longitude: -0.12 },
      forceSynthetic: true,
    });
    expect(result.cancelled).toBe(false);
    expect(simulationScenarioSchema.safeParse(result.scenario).success).toBe(true);
    expect(result.scenario.targets).toHaveLength(2);
  });

  it("same seed alone reproduces the full scenario including ids", async () => {
    const options = {
      seed: 99,
      targetCount: 3,
      vehicleSelection: ["aircraft"] as const,
      origin: { latitude: 51.5, longitude: -0.12 },
      forceSynthetic: true,
    };
    const first = await createDemoScenario(1_000, Math.random, options);
    const second = await createDemoScenario(1_000, Math.random, options);
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

  it("places road vehicles near roads, boats on water, aircraft near aerodromes", async () => {
    const { source: londonSource } = loadFixtureSource(["london-z10"]);
    const { source: oceanSource, tiles: oceanTiles } = loadFixtureSource(["ocean-z9"]);
    const oceanTile = oceanTiles[0]!;
    const [oceanLng, oceanLat] = tileLocalToLngLat(
      oceanTile.z,
      oceanTile.x,
      oceanTile.y,
      2048,
      2048,
    );
    const roadA = { longitude: -0.1278, latitude: 51.519 };
    const roadB = { longitude: -0.12, latitude: 51.51 };
    const aerodromes = [
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
    ] as const;

    const cars = await planDemoScenario(
      1_735_000_000_000,
      Math.random,
      {
        seed: 3,
        vehicleSelection: ["car"],
        targetCount: 2,
        origin: { latitude: 51.519, longitude: -0.1278 },
        groupJoinProbability: 0,
      },
      {
        routeFn: async () => [
          { longitude: roadA.longitude, latitude: roadA.latitude },
          { longitude: roadB.longitude, latitude: roadB.latitude },
        ],
      },
    );
    expect(cars.degradedTrackCount).toBe(0);
    for (const target of cars.scenario.targets) {
      for (const event of cars.scenario.events) {
        if (event.targetId !== target.id || !event.position) continue;
        const terrain = await classifyPoint(
          londonSource,
          [event.position.longitude, event.position.latitude],
          { waterZoom: 10, roadZoom: 10, maxRoadDistanceM: 5_000 },
        );
        expect(terrain.nearestRoad).not.toBeNull();
        expect(terrain.nearestRoad!.distanceM).toBeLessThan(2_000);
      }
    }

    const boats = await planDemoScenario(
      1_735_000_000_000,
      Math.random,
      {
        seed: 4,
        vehicleSelection: ["boat"],
        targetCount: 2,
        origin: { latitude: oceanLat, longitude: oceanLng },
        groupJoinProbability: 0,
      },
      {
        routeFn: async () => [
          { longitude: oceanLng, latitude: oceanLat },
          { longitude: oceanLng + 0.01, latitude: oceanLat + 0.005 },
        ],
      },
    );
    expect(boats.degradedTrackCount).toBe(0);
    for (const event of boats.scenario.events) {
      if (!event.position) continue;
      const terrain = await classifyPoint(
        oceanSource,
        [event.position.longitude, event.position.latitude],
        { waterZoom: oceanTile.z, roadZoom: oceanTile.z },
      );
      expect(terrain.isNavigableWater).toBe(true);
      expect(terrain.isWater).toBe(true);
    }

    const aircraft = await planDemoScenario(
      1_735_000_000_000,
      Math.random,
      {
        seed: 5,
        vehicleSelection: ["aircraft"],
        targetCount: 2,
        origin: { latitude: 51.47, longitude: -0.46 },
        groupJoinProbability: 0,
      },
      { aerodromes: [...aerodromes] },
    );
    expect(aircraft.degradedTrackCount).toBe(0);
    for (const target of aircraft.scenario.targets) {
      const start = aircraft.scenario.events
        .filter((event) => event.targetId === target.id && event.position)
        .toSorted((a, b) => a.at.localeCompare(b.at))[0]?.position;
      expect(start).toBeDefined();
      const nearestM = Math.min(
        ...aerodromes.map((aero) =>
          haversineMeters(
            [start!.longitude, start!.latitude],
            [aero.longitude, aero.latitude],
          ),
        ),
      );
      // Runway-aligned departure starts on-field.
      expect(nearestM).toBeLessThan(8_000);
    }
  });
});

describe("parseDemoTargetCount", () => {
  it("accepts integers from 2 to 100", () => {
    expect(parseDemoTargetCount("2")).toBe(2);
    expect(parseDemoTargetCount("100")).toBe(100);
    expect(parseDemoTargetCount(" 42 ")).toBe(42);
  });

  it("rejects empty, non-integers, and out-of-range values", () => {
    expect(parseDemoTargetCount("")).toBeNull();
    expect(parseDemoTargetCount("   ")).toBeNull();
    expect(parseDemoTargetCount("1")).toBeNull();
    expect(parseDemoTargetCount("0")).toBeNull();
    expect(parseDemoTargetCount("101")).toBeNull();
    expect(parseDemoTargetCount("2.5")).toBeNull();
    expect(parseDemoTargetCount("abc")).toBeNull();
  });
});
