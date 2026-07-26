import { describe, expect, it } from "vitest";

import { computePreviewRevision, getPreviewRangeMs, getPreviewStartMs } from "@/lib/preview-revision";
import { buildPreviewTargetStates, buildInterpolatedPreviewTargetStates, getEventsDueByTime } from "@/lib/simulation-engine";
import type { SimulationScenario } from "@/types/target";

function baseScenario(overrides?: Partial<SimulationScenario>): SimulationScenario {
  return {
    schemaVersion: 2,
    id: "preview-1",
    name: "Preview",
    createdAt: "2026-07-24T12:00:00.000Z",
    updatedAt: "2026-07-24T12:00:00.000Z",
    priorityTerms: [],
    targets: [
      {
        id: "target-1",
        callsign: "TEST",
        revealOnFirstEvent: false,
        appearOnFirstEvent: false,
        color: "#fff",
        profile: {
          vehicleCategory: "car",
          affiliation: "unknown",
          status: "active",
        },
      },
    ],
    events: [
      {
        id: "e1",
        targetId: "target-1",
        at: "2026-07-24T12:00:00.000Z",
        position: { latitude: 51.5, longitude: -0.12 },
      },
      {
        id: "e2",
        targetId: "target-1",
        at: "2026-07-24T12:10:00.000Z",
        position: { latitude: 51.52, longitude: -0.08 },
      },
    ],
    ...overrides,
  };
}

describe("builder preview helpers", () => {
  it("returns due events for virtual preview time", () => {
    const scenario = baseScenario();
    const due = getEventsDueByTime(scenario, Date.parse("2026-07-24T12:05:00.000Z"));
    expect(due.map((event) => event.id)).toEqual(["e1"]);
  });

  it("builds preview target states without persisting runtime", () => {
    const scenario = baseScenario();
    const states = buildPreviewTargetStates(scenario, ["e1", "e2"]);
    expect(states["target-1"]?.trail).toHaveLength(2);
    expect(states["target-1"]?.position?.latitude).toBe(51.52);
  });

  it("interpolates position and trail between preview events", () => {
    const scenario = baseScenario();
    const midpointMs = Date.parse("2026-07-24T12:05:00.000Z");
    const states = buildInterpolatedPreviewTargetStates(scenario, midpointMs);
    const target = states["target-1"];

    expect(target?.position?.latitude).toBeGreaterThan(51.5);
    expect(target?.position?.latitude).toBeLessThan(51.52);
    expect(target?.trail).toHaveLength(2);
  });

  it("starts preview at the first scheduled event", () => {
    const scenario = baseScenario();
    expect(getPreviewStartMs(scenario)).toBe(Date.parse("2026-07-24T12:00:00.000Z"));
  });

  it("derives preview range from first and last events", () => {
    const scenario = baseScenario();
    expect(getPreviewRangeMs(scenario)).toEqual({
      startMs: Date.parse("2026-07-24T12:00:00.000Z"),
      endMs: Date.parse("2026-07-24T12:10:00.000Z"),
    });
  });

  it("changes preview revision when a target is added", () => {
    const initial = baseScenario();
    const revised = baseScenario({
      targets: [
        ...initial.targets,
        {
          id: "target-2",
          callsign: "NEW",
          revealOnFirstEvent: false,
          appearOnFirstEvent: false,
          color: "#000",
          profile: {
            vehicleCategory: "other",
            affiliation: "unknown",
            status: "active",
          },
        },
      ],
    });
    expect(computePreviewRevision(revised)).not.toBe(computePreviewRevision(initial));
  });

  it("reconciles interleaved events across multiple targets", () => {
    const scenario = baseScenario({
      targets: [
        {
          id: "target-1",
          callsign: "A",
          revealOnFirstEvent: false,
          appearOnFirstEvent: false,
          color: "#fff",
          profile: { vehicleCategory: "car", affiliation: "unknown", status: "active" },
        },
        {
          id: "target-2",
          callsign: "B",
          revealOnFirstEvent: false,
          appearOnFirstEvent: false,
          color: "#000",
          profile: { vehicleCategory: "truck", affiliation: "unknown", status: "active" },
        },
      ],
      events: [
        {
          id: "e1",
          targetId: "target-1",
          at: "2026-07-24T12:00:00.000Z",
          position: { latitude: 51.5, longitude: -0.12 },
        },
        {
          id: "e2",
          targetId: "target-2",
          at: "2026-07-24T12:05:00.000Z",
          position: { latitude: 51.51, longitude: -0.11 },
        },
        {
          id: "e3",
          targetId: "target-1",
          at: "2026-07-24T12:10:00.000Z",
          position: { latitude: 51.52, longitude: -0.08 },
        },
      ],
    });

    const states = buildPreviewTargetStates(scenario, ["e1", "e2", "e3"]);
    expect(states["target-1"]?.trail).toHaveLength(2);
    expect(states["target-2"]?.trail).toHaveLength(1);
  });

  it("keeps appearOnFirstEvent targets unappeared until their first due event", () => {
    const scenario = baseScenario({
      targets: [
        {
          id: "target-1",
          callsign: "A",
          revealOnFirstEvent: false,
          appearOnFirstEvent: false,
          color: "#fff",
          profile: { vehicleCategory: "car", affiliation: "unknown", status: "active" },
        },
        {
          id: "target-2",
          callsign: "B",
          revealOnFirstEvent: false,
          appearOnFirstEvent: true,
          color: "#000",
          profile: { vehicleCategory: "truck", affiliation: "unknown", status: "active" },
        },
      ],
      events: [
        {
          id: "e1",
          targetId: "target-1",
          at: "2026-07-24T12:00:00.000Z",
          position: { latitude: 51.5, longitude: -0.12 },
        },
        {
          id: "e2",
          targetId: "target-2",
          at: "2026-07-24T12:05:00.000Z",
          message: "First contact",
        },
      ],
    });

    const before = buildInterpolatedPreviewTargetStates(
      scenario,
      Date.parse("2026-07-24T12:02:00.000Z"),
    );
    expect(before["target-1"]?.appeared).toBe(true);
    expect(before["target-2"]?.appeared).toBe(false);

    const after = buildInterpolatedPreviewTargetStates(
      scenario,
      Date.parse("2026-07-24T12:06:00.000Z"),
    );
    expect(after["target-2"]?.appeared).toBe(true);
  });

  it("includes newly added targets after revision reset", () => {
    const scenario = baseScenario({
      targets: [
        {
          id: "target-1",
          callsign: "A",
          revealOnFirstEvent: false,
          appearOnFirstEvent: false,
          color: "#fff",
          profile: { vehicleCategory: "car", affiliation: "unknown", status: "active" },
        },
        {
          id: "target-2",
          callsign: "B",
          revealOnFirstEvent: false,
          appearOnFirstEvent: false,
          color: "#000",
          profile: { vehicleCategory: "car", affiliation: "unknown", status: "active" },
        },
      ],
      events: [
        {
          id: "e1",
          targetId: "target-2",
          at: "2026-07-24T12:00:00.000Z",
          position: { latitude: 51.51, longitude: -0.11 },
        },
      ],
    });

    const states = buildPreviewTargetStates(scenario, ["e1"]);
    expect(states["target-2"]?.position?.latitude).toBe(51.51);
    expect(states["target-1"]?.position).toBeUndefined();
  });

  it("processes simultaneous events deterministically", () => {
    const scenario = baseScenario({
      events: [
        {
          id: "e-a",
          targetId: "target-1",
          at: "2026-07-24T12:00:00.000Z",
          message: "A",
        },
        {
          id: "e-b",
          targetId: "target-1",
          at: "2026-07-24T12:00:00.000Z",
          position: { latitude: 51.5, longitude: -0.12 },
        },
      ],
    });

    const due = getEventsDueByTime(scenario, Date.parse("2026-07-24T12:00:00.000Z"));
    expect(due.map((event) => event.id)).toEqual(["e-a", "e-b"]);
  });

  it("resets revision when an event is edited", () => {
    const scenario = baseScenario();
    const edited = baseScenario({
      events: [
        scenario.events[0]!,
        {
          ...scenario.events[1]!,
          position: { latitude: 51.53, longitude: -0.07 },
        },
      ],
    });
    expect(computePreviewRevision(edited)).not.toBe(computePreviewRevision(scenario));
  });
});
