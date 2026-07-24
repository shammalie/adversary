import { describe, expect, it } from "vitest";

import {
  formatValidationIssueLabel,
  getIssuesForEvent,
  getIssuesForTarget,
  getScenarioValidationIssues,
  getValidationIssueFocusId,
  groupValidationIssues,
} from "@/lib/scenario-validation-ui";

describe("scenario validation ui", () => {
  it("groups issues by section", () => {
    const issues = getScenarioValidationIssues({
      schemaVersion: 2,
      id: "s1",
      name: "",
      createdAt: "2026-07-24T12:00:00.000Z",
      updatedAt: "2026-07-24T12:00:00.000Z",
      priorityTerms: [],
      targets: [],
      events: [],
    });

    const grouped = groupValidationIssues(issues);
    expect(grouped.scenario.length).toBeGreaterThan(0);
    expect(grouped.targets.length).toBeGreaterThan(0);
    expect(grouped.events.length).toBeGreaterThan(0);
  });

  it("maps target and event issues by id", () => {
    const scenario = {
      schemaVersion: 2 as const,
      id: "s1",
      name: "Test",
      createdAt: "2026-07-24T12:00:00.000Z",
      updatedAt: "2026-07-24T12:00:00.000Z",
      priorityTerms: [],
      targets: [
        {
          id: "target-1",
          callsign: "",
          revealOnFirstEvent: true,
          color: "bad",
          profile: {
            vehicleCategory: "aircraft" as const,
            affiliation: "unknown" as const,
            status: "active" as const,
          },
        },
      ],
      events: [
        {
          id: "event-1",
          targetId: "missing-target",
          at: "2026-07-24T12:00:00.000Z",
        },
      ],
    };

    const issues = getScenarioValidationIssues(scenario);
    expect(getIssuesForTarget(issues, "target-1", scenario).length).toBeGreaterThan(0);
    expect(getIssuesForEvent(issues, "event-1", scenario).length).toBeGreaterThan(0);

    const callsignIssue = issues.find((issue) => issue.path === "targets.0.callsign");
    expect(callsignIssue).toBeDefined();
    expect(formatValidationIssueLabel(callsignIssue!, scenario)).toContain("callsign");
    expect(getValidationIssueFocusId(callsignIssue!, scenario)).toBe("target-1-callsign");

    const eventPayloadIssue = issues.find((issue) => issue.path === "events.0.message");
    expect(eventPayloadIssue).toBeDefined();
    expect(getValidationIssueFocusId(eventPayloadIssue!, scenario)).toBe("edit-event-1-message");
  });

  it("focuses per-event field controls for position and time issues", () => {
    const scenario = {
      schemaVersion: 2 as const,
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
            vehicleCategory: "aircraft" as const,
            affiliation: "unknown" as const,
            status: "active" as const,
          },
        },
      ],
      events: [
        {
          id: "event-1",
          targetId: "target-1",
          at: "not-a-date",
          position: { latitude: 120, longitude: -0.1 },
        },
      ],
    };

    const issues = getScenarioValidationIssues(scenario);
    const atIssue = issues.find((issue) => issue.field === "at");
    const latitudeIssue = issues.find((issue) => issue.field === "position.latitude");

    expect(atIssue).toBeDefined();
    expect(getValidationIssueFocusId(atIssue!, scenario)).toBe("edit-event-1-at");
    expect(latitudeIssue).toBeDefined();
    expect(getValidationIssueFocusId(latitudeIssue!, scenario)).toBe("edit-event-1-latitude");
  });
});
