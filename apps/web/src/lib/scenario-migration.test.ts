import { describe, expect, it } from "vitest";

import { migrateScenarioV1ToV2, migrateVehicleCategory } from "@/lib/scenario-migration";
import { validateScenario } from "@/lib/simulation-schema";
import type { LegacySimulationScenario } from "@/types/target";

const legacy: LegacySimulationScenario = {
  schemaVersion: 1,
  id: "legacy-1",
  name: "Legacy",
  createdAt: "2026-07-24T12:00:00.000Z",
  updatedAt: "2026-07-24T12:00:00.000Z",
  targets: [
    {
      id: "target-1",
      callsign: "ALPHA",
      startsUnknown: true,
      color: "#ffffff",
    },
  ],
  events: [
    {
      id: "identity-1",
      targetId: "target-1",
      type: "identity",
      at: "2026-07-24T12:00:01.000Z",
      profile: {
        vehicleCategory: "car",
        affiliation: "friendly",
        status: "active",
        identifier: "ABC-1",
      },
      message: "Identity established",
    },
    {
      id: "position-1",
      targetId: "target-1",
      type: "position",
      at: "2026-07-24T12:00:02.000Z",
      latitude: 40,
      longitude: -74,
      altitude: 0,
      speed: 30,
      heading: 90,
      course: 90,
    },
    {
      id: "alert-1",
      targetId: "target-1",
      type: "alert",
      at: "2026-07-24T12:00:03.000Z",
      priority: 1,
      message: "Critical stop required",
      code: "STOP",
    },
    {
      id: "status-1",
      targetId: "target-1",
      type: "status",
      at: "2026-07-24T12:00:04.000Z",
      status: "stationary",
      message: "Holding position",
    },
  ],
};

describe("scenario migration", () => {
  it("folds identity into target profiles and converts legacy events", () => {
    const migrated = migrateScenarioV1ToV2(legacy);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.targets[0]?.revealOnFirstEvent).toBe(true);
    expect(migrated.targets[0]?.appearOnFirstEvent).toBe(false);
    expect(migrated.targets[0]?.profile.vehicleCategory).toBe("car");
    expect(migrated.events.some((event) => event.id === "identity-1")).toBe(false);
    expect(migrated.events.find((event) => event.id === "position-1")?.position).toEqual({
      latitude: 40,
      longitude: -74,
      altitude: 0,
      speed: 30,
    });
    expect(migrated.events.find((event) => event.id === "alert-1")?.message).toContain(
      "Critical stop required",
    );
    expect(validateScenario(migrated).success).toBe(true);
  });

  it("maps retired rail vehicle category to other", () => {
    expect(migrateVehicleCategory("rail")).toBe("other");
    expect(migrateVehicleCategory("car")).toBe("car");

    const forced: LegacySimulationScenario = {
      ...legacy,
      targets: [
        {
          id: "target-1",
          callsign: "ALPHA",
          startsUnknown: true,
          color: "#ffffff",
          initialProfile: {
            vehicleCategory: "rail" as unknown as "car",
            affiliation: "unknown",
            status: "active",
          },
        },
      ],
      events: legacy.events.filter((event) => event.type !== "identity"),
    };
    const migrated = migrateScenarioV1ToV2(forced);
    expect(migrated.targets[0]?.profile.vehicleCategory).toBe("other");
    expect(validateScenario(migrated).success).toBe(true);
  });
});
