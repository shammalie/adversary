import { generateRouteEvents, mergeGeneratedEvents } from "@/lib/event-generator";
import type {
  Affiliation,
  SimulationEvent,
  SimulationScenario,
  TargetDefinition,
  TargetStatus,
  VehicleCategory,
} from "@/types/target";
import { AFFILIATIONS, TARGET_STATUSES, VEHICLE_CATEGORIES } from "@/types/target";

export type DemoVehicleSelection = "random" | readonly VehicleCategory[];

export interface CreateDemoScenarioOptions {
  /**
   * `"random"` — each target picks any vehicle category.
   * A non-empty category list — each target picks from that pool (single type if length 1).
   */
  vehicleSelection?: DemoVehicleSelection;
  /** When omitted, a count in `[2, 100]` is chosen at random. */
  targetCount?: number;
}

export const MIN_DEMO_TARGETS = 2;
export const MAX_DEMO_TARGETS = 100;

const CALLSIGN_PREFIXES = [
  "VIPER",
  "HARBOR",
  "FALCON",
  "ORCA",
  "RAVEN",
  "STORM",
  "SHADOW",
  "NOMAD",
  "ARROW",
  "SPECTRE",
  "COBRA",
  "DRIFTER",
] as const;

const VEHICLE_SUBTYPES: Record<VehicleCategory, string[]> = {
  aircraft: ["Multi-role fighter", "Transport", "UAV", "Rotary-wing"],
  boat: ["Fast patrol craft", "Cargo vessel", "Fishing trawler", "RHIB"],
  car: ["Sedan", "SUV", "Light utility"],
  truck: ["Cargo truck", "Tanker", "Flatbed"],
  other: ["Unclassified contact", "Mobile platform"],
};

const DEMO_MESSAGES = [
  "Track quality improved. Contact maintaining course.",
  "Critical proximity threshold breached near restricted channel.",
  "Primary sensor contact intermittent.",
  "Identity correlation pending secondary source.",
  "Contact entered monitored sector.",
] as const;

function atOffset(base: number, seconds: number) {
  return new Date(base + seconds * 1_000).toISOString();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pickIndex(length: number, random: () => number) {
  return Math.min(length - 1, Math.floor(random() * length));
}

function pickOne<T>(items: readonly T[], random: () => number): T {
  return items[pickIndex(items.length, random)]!;
}

function resolveTargetCount(random: () => number, override?: number) {
  if (override !== undefined) {
    return clamp(Math.floor(override), MIN_DEMO_TARGETS, MAX_DEMO_TARGETS);
  }
  return MIN_DEMO_TARGETS + Math.floor(random() * (MAX_DEMO_TARGETS - MIN_DEMO_TARGETS + 1));
}

/**
 * Parses a demo target-size input. Valid values are integers in (1, 100] i.e. 2–100.
 * Returns `null` when empty or invalid.
 */
export function parseDemoTargetCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 1 || value > MAX_DEMO_TARGETS) return null;
  return value;
}

function resolveCategory(
  selection: DemoVehicleSelection,
  random: () => number,
): VehicleCategory {
  if (selection === "random" || selection.length === 0) {
    return pickOne(VEHICLE_CATEGORIES, random);
  }
  return pickOne(selection, random);
}

import { TARGET_COLOR_OPTIONS } from "@/lib/target-colors";

const DEMO_COLORS = TARGET_COLOR_OPTIONS.dark.map((option) => option.value);

function demoColor(index: number) {
  return DEMO_COLORS[index % DEMO_COLORS.length]!;
}

function demoCallsign(index: number, random: () => number) {
  const prefix = pickOne(CALLSIGN_PREFIXES, random);
  const number = String(index + 1).padStart(2, "0");
  return `${prefix} ${number}`;
}

function demoStartPoint(category: VehicleCategory, random: () => number) {
  const latitude = 51.4 + random() * 0.35;
  const longitude = -0.45 + random() * 0.55;
  return {
    latitude,
    longitude,
    altitude: category === "aircraft" ? 6_000 + Math.floor(random() * 6_000) : 0,
  };
}

function formatCategoryLabel(category: VehicleCategory) {
  return `${category[0]!.toUpperCase()}${category.slice(1)}`;
}

function demoName(selection: DemoVehicleSelection, targetCount: number) {
  if (selection === "random" || selection.length === 0) {
    return `Random demo (${targetCount} targets)`;
  }
  if (selection.length === 1) {
    return `${formatCategoryLabel(selection[0]!)} demo (${targetCount} targets)`;
  }
  return `Mixed demo (${targetCount} targets)`;
}

function demoDescription(selection: DemoVehicleSelection, targetCount: number) {
  if (selection === "random" || selection.length === 0) {
    return `Generated demonstration with ${targetCount} contacts across mixed vehicle types.`;
  }
  if (selection.length === 1) {
    return `Generated demonstration with ${targetCount} ${selection[0]} contacts.`;
  }
  return `Generated demonstration with ${targetCount} contacts from ${selection.join(", ")}.`;
}

/**
 * Builds a fresh demo scenario. Position tracks come from generateRouteEvents
 * so each load is random and speed/distance/time stay physically consistent.
 * Target count defaults to a random value in [2, 100].
 */
export function createDemoScenario(
  now = Date.now(),
  random: () => number = Math.random,
  options: CreateDemoScenarioOptions = {},
): SimulationScenario {
  const vehicleSelection = options.vehicleSelection ?? "random";
  const targetCount = resolveTargetCount(random, options.targetCount);
  const createdAt = new Date(now).toISOString();
  const idFactory = () => crypto.randomUUID();

  const targets: TargetDefinition[] = [];
  const trackEvents: SimulationEvent[] = [];
  const messages: SimulationEvent[] = [];

  for (let index = 0; index < targetCount; index += 1) {
    const vehicleCategory = resolveCategory(vehicleSelection, random);
    const targetId = idFactory();
    const durationMinutes = 25 + Math.floor(random() * 35);
    const startDelaySeconds = 5 + Math.floor(random() * 90);
    const pointCount = 10 + Math.floor(random() * 15);

    targets.push({
      id: targetId,
      callsign: demoCallsign(index, random),
      revealOnFirstEvent: true,
      color: demoColor(index),
      profile: {
        vehicleCategory,
        vehicleSubtype: pickOne(VEHICLE_SUBTYPES[vehicleCategory], random),
        affiliation: pickOne(AFFILIATIONS, random) as Affiliation,
        status: pickOne(TARGET_STATUSES, random) as TargetStatus,
        identifier: `${vehicleCategory.slice(0, 3).toUpperCase()}-${String(100 + index)}`,
        description: `Demo ${vehicleCategory} contact.`,
      },
    });

    trackEvents.push(
      ...generateRouteEvents({
        targetId,
        count: pointCount,
        startAt: atOffset(now, startDelaySeconds),
        endAt: atOffset(now, startDelaySeconds + durationMinutes * 60),
        startPoint: demoStartPoint(vehicleCategory, random),
        vehicleCategory,
        random,
        idFactory,
      }),
    );

    if (random() < 0.35 || index < 2) {
      messages.push({
        id: idFactory(),
        targetId,
        at: atOffset(now, startDelaySeconds + Math.floor(durationMinutes * 30)),
        message: pickOne(DEMO_MESSAGES, random),
      });
    }
  }

  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    name: demoName(vehicleSelection, targetCount),
    description: demoDescription(vehicleSelection, targetCount),
    createdAt,
    updatedAt: createdAt,
    priorityTerms: ["critical", "proximity threshold"],
    targets,
    events: mergeGeneratedEvents(trackEvents, messages),
  };
}

export function defaultTargetProfile(): TargetDefinition["profile"] {
  return {
    vehicleCategory: "other",
    affiliation: "unknown",
    status: "active",
  };
}
