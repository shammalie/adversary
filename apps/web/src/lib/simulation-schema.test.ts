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
});