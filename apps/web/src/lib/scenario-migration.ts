import { normalizePriorityTerms } from "@/lib/priority-terms";
import type {
  LegacySimulationScenario,
  SimulationEvent,
  SimulationScenario,
  TargetDefinition,
  TargetProfile,
  VehicleCategory,
} from "@/types/target";
import { VEHICLE_CATEGORIES } from "@/types/target";

const VEHICLE_CATEGORY_SET = new Set<string>(VEHICLE_CATEGORIES);

/** Maps retired categories (e.g. rail) onto supported ones. */
export function migrateVehicleCategory(category: unknown): VehicleCategory {
  if (category === "rail") return "other";
  if (typeof category === "string" && VEHICLE_CATEGORY_SET.has(category)) {
    return category as VehicleCategory;
  }
  return "other";
}

function mergeProfile(base: Partial<TargetProfile>, patch: Partial<TargetProfile>): TargetProfile {
  return {
    vehicleCategory: migrateVehicleCategory(
      patch.vehicleCategory ?? base.vehicleCategory ?? "other",
    ),
    vehicleSubtype: patch.vehicleSubtype ?? base.vehicleSubtype,
    affiliation: patch.affiliation ?? base.affiliation ?? "unknown",
    status: patch.status ?? base.status ?? "active",
    identifier: patch.identifier ?? base.identifier,
    description: patch.description ?? base.description,
  };
}

/** Rewrites retired vehicle categories on an already-loaded v2 scenario. */
export function migrateRetiredVehicleCategories(scenario: SimulationScenario): SimulationScenario {
  let changed = false;
  const targets = scenario.targets.map((target) => {
    const vehicleCategory = migrateVehicleCategory(target.profile.vehicleCategory);
    if (vehicleCategory === target.profile.vehicleCategory) return target;
    changed = true;
    return {
      ...target,
      profile: { ...target.profile, vehicleCategory },
    };
  });
  return changed ? { ...scenario, targets } : scenario;
}

export function migrateScenarioV1ToV2(scenario: LegacySimulationScenario): SimulationScenario {
  const identityProfiles = new Map<string, Partial<TargetProfile>>();
  const extraMessages: SimulationEvent[] = [];
  const priorityTerms = new Set<string>();

  for (const event of scenario.events) {
    if (event.type === "identity") {
      const current = identityProfiles.get(event.targetId) ?? {};
      identityProfiles.set(event.targetId, mergeProfile(current, event.profile));
      if (event.message?.trim()) {
        extraMessages.push({
          id: `${event.id}-msg`,
          targetId: event.targetId,
          at: event.at,
          message: event.message.trim(),
        });
      }
    }
    if ((event.type === "message" || event.type === "alert") && event.priority === 1) {
      const words = event.message.split(/\s+/).filter((word) => word.length > 3);
      for (const word of words.slice(0, 3)) priorityTerms.add(word);
    }
  }

  const targets: TargetDefinition[] = scenario.targets.map((target) => ({
    id: target.id,
    callsign: target.callsign,
    revealOnFirstEvent: target.startsUnknown,
    appearOnFirstEvent: false,
    color: target.color,
    profile: mergeProfile(target.initialProfile ?? {}, identityProfiles.get(target.id) ?? {}),
  }));

  const convertedEvents: SimulationEvent[] = [];
  for (const event of scenario.events) {
    if (event.type === "identity") continue;
    if (event.type === "position") {
      convertedEvents.push({
        id: event.id,
        targetId: event.targetId,
        at: event.at,
        position: {
          latitude: event.latitude,
          longitude: event.longitude,
          altitude: event.altitude,
          speed: event.speed,
        },
      });
      continue;
    }
    if (event.type === "message") {
      convertedEvents.push({
        id: event.id,
        targetId: event.targetId,
        at: event.at,
        message: event.message,
      });
      continue;
    }
    if (event.type === "alert") {
      const message = event.code ? `[${event.code}] ${event.message}` : event.message;
      convertedEvents.push({ id: event.id, targetId: event.targetId, at: event.at, message });
      continue;
    }
    if (event.type === "status") {
      convertedEvents.push({
        id: event.id,
        targetId: event.targetId,
        at: event.at,
        message: event.message?.trim() || `Status changed to ${event.status}.`,
      });
    }
  }

  const events = [...convertedEvents, ...extraMessages].toSorted(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id),
  );

  return {
    schemaVersion: 2,
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    createdAt: scenario.createdAt,
    updatedAt: new Date().toISOString(),
    priorityTerms: normalizePriorityTerms([...priorityTerms]),
    targets,
    events,
  };
}

export function isLegacyScenario(value: unknown): value is LegacySimulationScenario {
  return (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    (value as { schemaVersion: number }).schemaVersion === 1
  );
}
