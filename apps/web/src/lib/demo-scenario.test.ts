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
