import { describe, expect, it } from "vitest";

import { createRuntime, reconcileRuntime, sortEvents } from "@/lib/simulation-engine";
import type { SimulationScenario } from "@/types/target";

function scenario(): SimulationScenario {
  return {
    schemaVersion: 2,
    id: "scenario-1",
    name: "Test",
    createdAt: "2026-07-24T12:00:00.000Z",
    updatedAt: "2026-07-24T12:00:00.000Z",
    priorityTerms: ["critical"],
    targets: [
      {
        id: "target-1",
        callsign: "TEST 01",
        revealOnFirstEvent: true,
        color: "#22d3ee",
        profile: {
          vehicleCategory: "aircraft",
          affiliation: "unknown",
          status: "active",
          identifier: "A1",
        },
      },
    ],
    events: [
      {
        id: "event-b",
        targetId: "target-1",
        at: "2026-07-24T12:00:02.000Z",
        message: "Critical track update",
      },
      {
        id: "event-a",
        targetId: "target-1",
        at: "2026-07-24T12:00:01.000Z",
        message: "Initial contact",
      },
      {
        id: "event-c",
        targetId: "target-1",
        at: "2026-07-24T12:00:02.000Z",
        position: { latitude: 51, longitude: 0, altitude: 1_000 },
        message: "Combined position and message",
      },
    ],
  };
}

describe("simulation engine", () => {
  it("sorts by timestamp and then stable event id", () => {
    expect(sortEvents(scenario().events).map((event) => event.id)).toEqual([
      "event-a",
      "event-b",
      "event-c",
    ]);
  });

  it("reveals masked profiles on first event and ingests combined payloads", () => {
    const runtime = createRuntime(scenario(), new Date("2026-07-24T11:59:00.000Z"));
    const reconciled = reconcileRuntime(runtime, new Date("2026-07-24T12:00:05.000Z"));

    expect(reconciled.processedEventIds).toEqual(["event-a", "event-b", "event-c"]);
    expect(reconciled.status).toBe("completed");
    expect(reconciled.targetStates["target-1"]?.revealed).toBe(true);
    expect(reconciled.targetStates["target-1"]?.profile.vehicleCategory).toBe("aircraft");
    expect(reconciled.targetStates["target-1"]?.trail).toHaveLength(1);
    expect(reconciled.criticalAlertIds).toEqual(["event-b"]);
  });

  it("does not duplicate events across reconciliations", () => {
    const runtime = createRuntime(scenario(), new Date("2026-07-24T12:00:00.000Z"));
    const first = reconcileRuntime(runtime, new Date("2026-07-24T12:00:01.500Z"));
    const second = reconcileRuntime(first, new Date("2026-07-24T12:00:01.900Z"));

    expect(second.ingestedEvents.map((event) => event.id)).toEqual(["event-a"]);
  });
});
