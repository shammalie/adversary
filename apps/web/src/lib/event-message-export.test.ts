import { describe, expect, it } from "vitest";

import {
  DEFAULT_EVENT_MESSAGE_EXPORT_OPTIONS,
  formatEventMessages,
  type EventMessageExportOptions,
} from "@/lib/event-message-export";
import type { SimulationEvent, SimulationScenario, TargetDefinition } from "@/types/target";

const baseTarget = (overrides: Partial<TargetDefinition> & Pick<TargetDefinition, "id" | "callsign">): TargetDefinition => ({
  revealOnFirstEvent: false,
  appearOnFirstEvent: false,
  color: "#ff0000",
  profile: {
    vehicleCategory: "aircraft",
    affiliation: "hostile",
    status: "active",
  },
  ...overrides,
});

function scenario(
  targets: TargetDefinition[],
  events: SimulationEvent[],
): SimulationScenario {
  return {
    schemaVersion: 2,
    id: "export-test",
    name: "Export Test",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    priorityTerms: [],
    targets,
    events,
  };
}

const alpha = baseTarget({ id: "alpha", callsign: "ALPHA" });
const bravo = baseTarget({ id: "bravo", callsign: "BRAVO" });

function at(minute: number) {
  return `2026-07-28T12:${String(minute).padStart(2, "0")}:00.000Z`;
}

describe("formatEventMessages", () => {
  it("formats position with optional telemetry and no message (canonical ALPHA 004)", () => {
    const events: SimulationEvent[] = [
      { id: "a1", targetId: "alpha", at: at(1), position: { latitude: 58.5, longitude: 24.0 } },
      { id: "a2", targetId: "alpha", at: at(2), position: { latitude: 58.6, longitude: 24.05 } },
      // Previous for HDG 258 into 58.90N 24.20E
      {
        id: "a3",
        targetId: "alpha",
        at: at(3),
        position: { latitude: 58.91, longitude: 24.29 },
      },
      {
        id: "a4",
        targetId: "alpha",
        at: at(4),
        position: { latitude: 58.9, longitude: 24.2, altitude: 25000, speed: 780 },
      },
    ];

    const lines = formatEventMessages(scenario([alpha], events)).split("\n");
    expect(lines[3]).toBe("ALPHA 004 POS 58.90N 24.20E ALT 25000 HDG 258 SPD 780 OUT 180");
  });

  it("appends face-value message before OUT (canonical ALPHA 005)", () => {
    const events: SimulationEvent[] = [
      { id: "a1", targetId: "alpha", at: at(1), position: { latitude: 58.5, longitude: 24.0 } },
      { id: "a2", targetId: "alpha", at: at(2), position: { latitude: 58.6, longitude: 24.05 } },
      { id: "a3", targetId: "alpha", at: at(3), position: { latitude: 58.7, longitude: 24.1 } },
      // Previous for HDG 260 into 59.10N 24.40E
      {
        id: "a4",
        targetId: "alpha",
        at: at(4),
        position: { latitude: 59.11, longitude: 24.51 },
      },
      {
        id: "a5",
        targetId: "alpha",
        at: at(5),
        position: { latitude: 59.1, longitude: 24.4, altitude: 24000, speed: 760 },
        message: "BANDIT MANEUVERING WEST",
      },
    ];

    const lines = formatEventMessages(scenario([alpha], events)).split("\n");
    expect(lines[4]).toBe(
      "ALPHA 005 POS 59.10N 24.40E ALT 24000 HDG 260 SPD 760 BANDIT MANEUVERING WEST OUT 240",
    );
  });

  it("keeps message when telemetry is missing or unchecked (canonical BRAVO 001)", () => {
    const events: SimulationEvent[] = [
      {
        id: "b1",
        targetId: "bravo",
        at: at(1),
        position: { latitude: 58.5, longitude: 23.9 },
        message: "CONTACT LOST",
      },
    ];

    const off: EventMessageExportOptions = {
      includeAltitude: false,
      includeHeading: false,
      includeSpeed: false,
    };
    expect(formatEventMessages(scenario([bravo], events), off)).toBe(
      "BRAVO 001 POS 58.50N 23.90E CONTACT LOST OUT 0",
    );

    // Also when checkboxes are on but values are missing/underivable (first point, no alt/speed)
    expect(formatEventMessages(scenario([bravo], events))).toBe(
      "BRAVO 001 POS 58.50N 23.90E CONTACT LOST OUT 0",
    );
  });

  it("formats position-only line with no telemetry and no message (canonical BRAVO 002)", () => {
    const events: SimulationEvent[] = [
      {
        id: "b1",
        targetId: "bravo",
        at: at(1),
        position: { latitude: 58.5, longitude: 23.9 },
        message: "CONTACT LOST",
      },
      {
        id: "b2",
        targetId: "bravo",
        at: at(2),
        position: { latitude: 58.55, longitude: 23.95 },
      },
    ];

    const off: EventMessageExportOptions = {
      includeAltitude: false,
      includeHeading: false,
      includeSpeed: false,
    };
    const lines = formatEventMessages(scenario([bravo], events), off).split("\n");
    expect(lines[1]).toBe("BRAVO 002 POS 58.55N 23.95E OUT 60");
  });

  it("skips message-only events and does not consume ordinals", () => {
    const events: SimulationEvent[] = [
      {
        id: "b-msg",
        targetId: "bravo",
        at: at(0),
        message: "SHOULD NOT APPEAR",
      },
      {
        id: "b1",
        targetId: "bravo",
        at: at(1),
        position: { latitude: 58.5, longitude: 23.9 },
      },
      {
        id: "a-msg",
        targetId: "alpha",
        at: at(2),
        message: "ALSO SKIPPED",
      },
      {
        id: "b2",
        targetId: "bravo",
        at: at(3),
        position: { latitude: 58.55, longitude: 23.95 },
      },
    ];

    const off: EventMessageExportOptions = {
      includeAltitude: false,
      includeHeading: false,
      includeSpeed: false,
    };
    expect(formatEventMessages(scenario([alpha, bravo], events), off)).toBe(
      ["BRAVO 001 POS 58.50N 23.90E OUT 0", "BRAVO 002 POS 58.55N 23.95E OUT 120"].join("\n"),
    );
  });

  it("appends whole-file cumulative relative seconds after OUT", () => {
    const events: SimulationEvent[] = [
      {
        id: "a1",
        targetId: "alpha",
        at: "2026-07-28T12:00:00.000Z",
        position: { latitude: 58.5, longitude: 24.0 },
      },
      {
        id: "b1",
        targetId: "bravo",
        at: "2026-07-28T12:01:30.000Z",
        position: { latitude: 58.6, longitude: 24.1 },
      },
      {
        id: "a2",
        targetId: "alpha",
        at: "2026-07-28T12:02:30.000Z",
        position: { latitude: 58.7, longitude: 24.2 },
      },
    ];
    const off: EventMessageExportOptions = {
      includeAltitude: false,
      includeHeading: false,
      includeSpeed: false,
    };
    expect(formatEventMessages(scenario([alpha, bravo], events), off)).toBe(
      [
        "ALPHA 001 POS 58.50N 24.00E OUT 0",
        "BRAVO 001 POS 58.60N 24.10E OUT 90",
        "ALPHA 002 POS 58.70N 24.20E OUT 150",
      ].join("\n"),
    );
  });

  it("omits whitespace-only messages and exports southern/western hemispheres", () => {
    const events: SimulationEvent[] = [
      {
        id: "a1",
        targetId: "alpha",
        at: at(1),
        position: { latitude: -12.345, longitude: -45.678 },
        message: "   ",
      },
    ];
    expect(formatEventMessages(scenario([alpha], events))).toBe(
      "ALPHA 001 POS 12.35S 45.68W OUT 0",
    );
  });

  it("defaults all telemetry checkboxes on", () => {
    expect(DEFAULT_EVENT_MESSAGE_EXPORT_OPTIONS).toEqual({
      includeAltitude: true,
      includeHeading: true,
      includeSpeed: true,
    });
  });
});
