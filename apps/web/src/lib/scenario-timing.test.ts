import { describe, expect, it } from "vitest";

import { applyFastForwardTimes, isFastForwardActive } from "@/lib/scenario-timing";
import type { SimulationScenario } from "@/types/target";

function baseScenario(overrides: Partial<SimulationScenario> = {}): SimulationScenario {
  return {
    schemaVersion: 2,
    id: "scenario-1",
    name: "Test",
    createdAt: "2026-07-24T12:00:00.000Z",
    updatedAt: "2026-07-24T12:00:00.000Z",
    priorityTerms: [],
    targets: [
      {
        id: "target-1",
        callsign: "TEST 01",
        revealOnFirstEvent: false,
        appearOnFirstEvent: false,
        color: "#22d3ee",
        profile: {
          vehicleCategory: "aircraft",
          affiliation: "unknown",
          status: "active",
        },
      },
    ],
    events: [
      {
        id: "event-a",
        targetId: "target-1",
        at: "2026-07-24T12:00:00.000Z",
        message: "First",
      },
      {
        id: "event-b",
        targetId: "target-1",
        at: "2026-07-24T12:10:00.000Z",
        message: "Ten minutes later",
      },
    ],
    ...overrides,
  };
}

describe("scenario timing / fast-forward", () => {
  it("treats omit and 1 as inactive", () => {
    expect(isFastForwardActive(undefined)).toBe(false);
    expect(isFastForwardActive(1)).toBe(false);
    expect(isFastForwardActive(0)).toBe(false);
    expect(isFastForwardActive(1.5)).toBe(true);
    expect(isFastForwardActive(10)).toBe(true);
    expect(isFastForwardActive(10.1)).toBe(false);
  });

  it("stamps firesAt from earliest at without rewriting authored at", () => {
    const applied = applyFastForwardTimes(baseScenario({ fastForwardMultiplier: 2 }));

    expect(applied.events.map((event) => event.at)).toEqual([
      "2026-07-24T12:00:00.000Z",
      "2026-07-24T12:10:00.000Z",
    ]);
    expect(applied.events[0]?.firesAt).toBe("2026-07-24T12:00:00.000Z");
    // 10 min / 2 = 5 min after anchor
    expect(applied.events[1]?.firesAt).toBe("2026-07-24T12:05:00.000Z");
  });

  it("recomputes all firesAt when multiplier changes", () => {
    const once = applyFastForwardTimes(baseScenario({ fastForwardMultiplier: 2 }));
    const twice = applyFastForwardTimes({ ...once, fastForwardMultiplier: 5 });

    expect(twice.events[0]?.at).toBe("2026-07-24T12:00:00.000Z");
    expect(twice.events[1]?.at).toBe("2026-07-24T12:10:00.000Z");
    expect(twice.events[1]?.firesAt).toBe("2026-07-24T12:02:00.000Z");
  });

  it("strips firesAt when multiplier is cleared", () => {
    const withFires = applyFastForwardTimes(baseScenario({ fastForwardMultiplier: 2 }));
    expect(withFires.events.every((event) => event.firesAt !== undefined)).toBe(true);

    const cleared = applyFastForwardTimes({
      ...withFires,
      fastForwardMultiplier: undefined,
    });
    expect(cleared.events.every((event) => event.firesAt === undefined)).toBe(true);
    expect(cleared.events.map((event) => event.at)).toEqual([
      "2026-07-24T12:00:00.000Z",
      "2026-07-24T12:10:00.000Z",
    ]);
  });

  it("strips firesAt when multiplier is 1", () => {
    const withFires = applyFastForwardTimes(baseScenario({ fastForwardMultiplier: 2 }));
    const cleared = applyFastForwardTimes({ ...withFires, fastForwardMultiplier: 1 });
    expect(cleared.events.every((event) => event.firesAt === undefined)).toBe(true);
  });
});
