import { describe, expect, it } from "vitest";

import { simulationEventSchema, validateScenario } from "@/lib/simulation-schema";

describe("simulation schema", () => {
  it("requires at least one payload section", () => {
    const result = simulationEventSchema.safeParse({
      id: "e1",
      targetId: "t1",
      at: "2026-07-24T12:00:00.000Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/position|message/i);
    }
  });

  it("accepts combined position and message payloads", () => {
    const result = simulationEventSchema.safeParse({
      id: "e1",
      targetId: "t1",
      at: "2026-07-24T12:00:00.000Z",
      position: { latitude: 51, longitude: 0 },
      message: "Contact steady",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional authored speed on position", () => {
    const result = simulationEventSchema.safeParse({
      id: "e1",
      targetId: "t1",
      at: "2026-07-24T12:00:00.000Z",
      position: { latitude: 51, longitude: 0, speed: 180 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative speed", () => {
    const result = simulationEventSchema.safeParse({
      id: "e1",
      targetId: "t1",
      at: "2026-07-24T12:00:00.000Z",
      position: { latitude: 51, longitude: 0, speed: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects authored speed above 2000 kt by default", () => {
    const result = simulationEventSchema.safeParse({
      id: "e1",
      targetId: "t1",
      at: "2026-07-24T12:00:00.000Z",
      position: { latitude: 51, longitude: 0, speed: 2_500 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => /2,000 kt/i.test(issue.message))).toBe(true);
    }
  });

  it("accepts authored speed above 2000 kt when ignoreKinematicLimits is set", () => {
    const result = simulationEventSchema.safeParse({
      id: "e1",
      targetId: "t1",
      at: "2026-07-24T12:00:00.000Z",
      ignoreKinematicLimits: true,
      position: { latitude: 51, longitude: 0, speed: 12_000 },
    });
    expect(result.success).toBe(true);
  });

  it("uses friendly messages for empty targets and events", () => {
    const result = validateScenario({
      schemaVersion: 2,
      id: "s1",
      name: "Test",
      createdAt: "2026-07-24T12:00:00.000Z",
      updatedAt: "2026-07-24T12:00:00.000Z",
      priorityTerms: [],
      targets: [],
      events: [],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((issue) => issue.message);
    expect(messages).toContain("Each scenario must include at least one target.");
    expect(messages).toContain("Each target must have at least one event.");
  });

  it("defaults omitted appearOnFirstEvent to false", () => {
    const result = validateScenario({
      schemaVersion: 2,
      id: "s1",
      name: "Test",
      createdAt: "2026-07-24T12:00:00.000Z",
      updatedAt: "2026-07-24T12:00:00.000Z",
      priorityTerms: [],
      targets: [
        {
          id: "target-1",
          callsign: "ALPHA",
          revealOnFirstEvent: true,
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
          id: "event-1",
          targetId: "target-1",
          at: "2026-07-24T12:00:00.000Z",
          message: "Ping",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.targets[0]?.appearOnFirstEvent).toBe(false);
  });

  it("rejects revealOnFirstEvent and appearOnFirstEvent both true", () => {
    const result = validateScenario({
      schemaVersion: 2,
      id: "s1",
      name: "Test",
      createdAt: "2026-07-24T12:00:00.000Z",
      updatedAt: "2026-07-24T12:00:00.000Z",
      priorityTerms: [],
      targets: [
        {
          id: "target-1",
          callsign: "ALPHA",
          revealOnFirstEvent: true,
          appearOnFirstEvent: true,
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
          id: "event-1",
          targetId: "target-1",
          at: "2026-07-24T12:00:00.000Z",
          message: "Ping",
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (issue) =>
          issue.message === "Choose reveal on first event or appear on first event, not both." &&
          issue.path.join(".") === "targets.0.appearOnFirstEvent",
      ),
    ).toBe(true);
  });

  it("requires every target to have at least one event", () => {
    const result = validateScenario({
      schemaVersion: 2,
      id: "s1",
      name: "Test",
      createdAt: "2026-07-24T12:00:00.000Z",
      updatedAt: "2026-07-24T12:00:00.000Z",
      priorityTerms: [],
      targets: [
        {
          id: "target-1",
          callsign: "ALPHA",
          revealOnFirstEvent: true,
          color: "#22d3ee",
          profile: {
            vehicleCategory: "aircraft",
            affiliation: "unknown",
            status: "active",
          },
        },
        {
          id: "target-2",
          callsign: "BRAVO",
          revealOnFirstEvent: true,
          color: "#f59e0b",
          profile: {
            vehicleCategory: "boat",
            affiliation: "unknown",
            status: "active",
          },
        },
      ],
      events: [
        {
          id: "event-1",
          targetId: "target-1",
          at: "2026-07-24T12:00:00.000Z",
          message: "Only alpha has an event",
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (issue) =>
          issue.message === "Each target must have at least one event." &&
          issue.path.join(".") === "targets.1.callsign",
      ),
    ).toBe(true);
  });

  it("accepts optional non-negative delaySeconds", () => {
    const result = validateScenario({
      schemaVersion: 2,
      id: "s1",
      name: "Test",
      createdAt: "2026-07-24T12:00:00.000Z",
      updatedAt: "2026-07-24T12:00:00.000Z",
      delaySeconds: 45,
      priorityTerms: [],
      targets: [
        {
          id: "target-1",
          callsign: "ALPHA",
          revealOnFirstEvent: true,
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
          id: "event-1",
          targetId: "target-1",
          at: "2026-07-24T12:00:00.000Z",
          message: "Ping",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.delaySeconds).toBe(45);
  });

  it("rejects negative delaySeconds", () => {
    const result = validateScenario({
      schemaVersion: 2,
      id: "s1",
      name: "Test",
      createdAt: "2026-07-24T12:00:00.000Z",
      updatedAt: "2026-07-24T12:00:00.000Z",
      delaySeconds: -1,
      priorityTerms: [],
      targets: [
        {
          id: "target-1",
          callsign: "ALPHA",
          revealOnFirstEvent: true,
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
          id: "event-1",
          targetId: "target-1",
          at: "2026-07-24T12:00:00.000Z",
          message: "Ping",
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (issue) =>
          issue.path.join(".") === "delaySeconds" &&
          /negative/i.test(issue.message),
      ),
    ).toBe(true);
  });

  it("accepts fastForwardMultiplier in (1, 10] with optional firesAt", () => {
    const result = validateScenario({
      schemaVersion: 2,
      id: "s1",
      name: "Test",
      createdAt: "2026-07-24T12:00:00.000Z",
      updatedAt: "2026-07-24T12:00:00.000Z",
      fastForwardMultiplier: 2.5,
      priorityTerms: [],
      targets: [
        {
          id: "target-1",
          callsign: "ALPHA",
          revealOnFirstEvent: true,
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
          id: "event-1",
          targetId: "target-1",
          at: "2026-07-24T12:00:00.000Z",
          firesAt: "2026-07-24T12:00:00.000Z",
          message: "Ping",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.fastForwardMultiplier).toBe(2.5);
    expect(result.data.events[0]?.firesAt).toBe("2026-07-24T12:00:00.000Z");
  });

  it("rejects fastForwardMultiplier of 1, 0, or above 10", () => {
    for (const fastForwardMultiplier of [1, 0, -2, 10.1, 11]) {
      const result = validateScenario({
        schemaVersion: 2,
        id: "s1",
        name: "Test",
        createdAt: "2026-07-24T12:00:00.000Z",
        updatedAt: "2026-07-24T12:00:00.000Z",
        fastForwardMultiplier,
        priorityTerms: [],
        targets: [
          {
            id: "target-1",
            callsign: "ALPHA",
            revealOnFirstEvent: true,
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
            id: "event-1",
            targetId: "target-1",
            at: "2026-07-24T12:00:00.000Z",
            message: "Ping",
          },
        ],
      });
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(
        result.error.issues.some((issue) => issue.path.join(".") === "fastForwardMultiplier"),
      ).toBe(true);
    }
  });
});