import { describe, expect, it } from "vitest";

import { createDemoScenario, parseDemoTargetCount } from "@/lib/demo-scenario";
import { CATEGORY_SPEED_RANGES, CATEGORY_TOP_SPEED_KNOTS } from "@/lib/vehicle-speed";
import { simulationScenarioSchema } from "@/lib/simulation-schema";
import { VEHICLE_CATEGORIES } from "@/types/target";

function seededRandom(initial = 11) {
  let seed = initial;
  return () => {
    seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return seed / 4_294_967_296;
  };
}

describe("demo scenario", () => {
  it("builds a valid scenario from generated routes", () => {
    const scenario = createDemoScenario(1_735_000_000_000, seededRandom(), {
      targetCount: 2,
    });
    expect(simulationScenarioSchema.safeParse(scenario).success).toBe(true);
    expect(scenario.targets).toHaveLength(2);
    expect(scenario.events.some((event) => event.position)).toBe(true);
    expect(scenario.events.some((event) => event.message)).toBe(true);
  });

  it("picks a target count between 2 and 100 when not specified", () => {
    const scenario = createDemoScenario(1_735_000_000_000, seededRandom(42));
    expect(scenario.targets.length).toBeGreaterThanOrEqual(2);
    expect(scenario.targets.length).toBeLessThanOrEqual(100);
  });

  it("uses an explicit target count when provided", () => {
    const scenario = createDemoScenario(1_735_000_000_000, seededRandom(), {
      targetCount: 7,
    });
    expect(scenario.targets).toHaveLength(7);
  });

  it("clamps out-of-range target counts into 2–100", () => {
    expect(
      createDemoScenario(1_735_000_000_000, seededRandom(), { targetCount: 1 }).targets,
    ).toHaveLength(2);
    expect(
      createDemoScenario(1_735_000_000_000, seededRandom(), { targetCount: 250 }).targets,
    ).toHaveLength(100);
  });

  it("uses a single vehicle category when one type is selected", () => {
    const scenario = createDemoScenario(Date.now(), () => 0.55, {
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
    const scenario = createDemoScenario(1_735_000_000_000, seededRandom(3), {
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
    const scenario = createDemoScenario(1_735_000_000_000, seededRandom(7), {
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
    const scenario = createDemoScenario(Date.now(), () => 0.55, { targetCount: 3 });
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
    const first = createDemoScenario(1_000, () => 0.1, { targetCount: 2 });
    const second = createDemoScenario(1_000, () => 0.9, { targetCount: 2 });
    const firstLat = first.events.find((event) => event.position)?.position?.latitude;
    const secondLat = second.events.find((event) => event.position)?.position?.latitude;
    // Different RNG → different initial headings/speeds → divergent tracks.
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
    const scenario = createDemoScenario(1_735_000_000_000, seededRandom(), {
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
    const scenario = createDemoScenario(1_735_000_000_000, seededRandom(9), {
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
    const scenario = createDemoScenario(1_735_000_000_000, seededRandom(4), {
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

  it("randomizes start regions across groups when origin is omitted", () => {
    const scenario = createDemoScenario(1_735_000_000_000, seededRandom(12), {
      vehicleSelection: ["boat"],
      targetCount: 16,
    });
    const starts = scenario.targets.map((target) => {
      const position = scenario.events
        .filter((event) => event.targetId === target.id && event.position)
        .toSorted((a, b) => a.at.localeCompare(b.at))[0]?.position;
      expect(position).toBeDefined();
      return position!;
    });
    const latitudes = starts.map((point) => point.latitude);
    const longitudes = starts.map((point) => point.longitude);
    // True world randomization — not the ~10 preset hubs (which span far less uniquely).
    expect(Math.max(...latitudes) - Math.min(...latitudes)).toBeGreaterThan(20);
    expect(Math.max(...longitudes) - Math.min(...longitudes)).toBeGreaterThan(40);

    // Most solo starts should not sit inside the same small pocket.
    let closePairs = 0;
    for (let i = 0; i < starts.length; i += 1) {
      for (let j = i + 1; j < starts.length; j += 1) {
        if (
          Math.abs(starts[i]!.latitude - starts[j]!.latitude) < 0.5 &&
          Math.abs(starts[i]!.longitude - starts[j]!.longitude) < 0.5
        ) {
          closePairs += 1;
        }
      }
    }
    expect(closePairs).toBeLessThan(3);
  });

  it("keeps all demo track latitudes inside the Mercator-safe band", () => {
    const scenario = createDemoScenario(1_735_000_000_000, seededRandom(8), {
      vehicleSelection: ["aircraft"],
      targetCount: 20,
    });
    for (const event of scenario.events) {
      if (!event.position) continue;
      expect(Math.abs(event.position.latitude)).toBeLessThanOrEqual(60);
    }
  });

  it("sometimes groups same-category targets on nearby shared corridors", () => {
    const scenario = createDemoScenario(1_735_000_000_000, seededRandom(19), {
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

    // Grouped corridors should also keep later samples near each other for at least one pair.
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
    const scenario = createDemoScenario(1_735_000_000_000, seededRandom(21), {
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
