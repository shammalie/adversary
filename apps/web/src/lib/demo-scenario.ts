import {
  categoryCruiseMidpointKnots,
  generateRouteEvents,
  mergeGeneratedEvents,
} from "@/lib/event-generator";
import { destinationPoint } from "@/lib/position-telemetry";
import { TARGET_COLOR_OPTIONS } from "@/lib/target-colors";
import type {
  Affiliation,
  PositionPayload,
  SimulationEvent,
  SimulationScenario,
  TargetDefinition,
  TargetStatus,
  VehicleCategory,
} from "@/types/target";
import {
  AFFILIATIONS,
  TARGET_STATUSES,
  VEHICLE_CATEGORIES,
} from "@/types/target";

export type DemoVehicleSelection = "random" | readonly VehicleCategory[];

export interface DemoOrigin {
  latitude: number;
  longitude: number;
}

export interface CreateDemoScenarioOptions {
  /**
   * `"random"` — each target picks any vehicle category.
   * A non-empty category list — each target picks from that pool (single type if length 1).
   */
  vehicleSelection?: DemoVehicleSelection;
  /** When omitted, a count in `[2, 100]` is chosen at random. */
  targetCount?: number;
  /**
   * Scenario clock start (ISO). When omitted, uses `now`.
   * Target tracks are scheduled relative to this instant.
   */
  startAt?: string;
  /**
   * Optional scenario clock end (ISO). When set, every track fits inside
   * `[startAt, endAt]`. When omitted, each target gets a random duration.
   */
  endAt?: string;
  /**
   * Geographic center for start points. When omitted, each travel group gets an
   * independent random lat/lng (not limited to preset regions).
   */
  origin?: DemoOrigin;
  /** Override travel-group join chance (0–1). Defaults to {@link GROUP_JOIN_PROBABILITY}. */
  groupJoinProbability?: number;
}

export const MIN_DEMO_TARGETS = 2;
export const MAX_DEMO_TARGETS = 100;

/** Named regions used when randomizing a demo origin. */
export const DEMO_START_LOCATIONS = [
  { name: "London", latitude: 51.5074, longitude: -0.1278 },
  { name: "English Channel", latitude: 50.7, longitude: -1.1 },
  { name: "North Sea", latitude: 55.0, longitude: 3.0 },
  { name: "New York Harbor", latitude: 40.68, longitude: -74.02 },
  { name: "Singapore Strait", latitude: 1.25, longitude: 103.85 },
  { name: "Tokyo Bay", latitude: 35.45, longitude: 139.75 },
  { name: "Persian Gulf", latitude: 26.5, longitude: 51.5 },
  { name: "South China Sea", latitude: 14.5, longitude: 114.0 },
  { name: "Mediterranean", latitude: 35.5, longitude: 18.0 },
  { name: "Gulf of Aden", latitude: 12.5, longitude: 45.0 },
] as const;

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

/** Chance a target joins an existing same-category travel group. */
export const GROUP_JOIN_PROBABILITY = 0.08;

/**
 * Web Mercator practical ceiling (EPSG:3857 ≈ ±85.05°). Demo tracks may use the
 * full map; soft steering near this edge prevents polar clip-line artifacts.
 */
export const DEMO_MAX_ABS_LATITUDE = 85;

interface DemoTravelPlan {
  baseLatitude: number;
  baseLongitude: number;
  endLatitude: number;
  endLongitude: number;
  startDelaySeconds: number;
  durationMinutes: number;
  /** Multi-member groups share an A→B corridor; solos wander independently. */
  sharedPath: boolean;
}

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

export function pickRandomDemoOrigin(
  random: () => number = Math.random,
): DemoOrigin {
  const location = pickOne(DEMO_START_LOCATIONS, random);
  return { latitude: location.latitude, longitude: location.longitude };
}

/** Uniform random point for unpinned demo starts (UI presets are separate). */
function randomWorldOrigin(random: () => number): DemoOrigin {
  return {
    latitude: (random() - 0.5) * 2 * DEMO_MAX_ABS_LATITUDE,
    longitude: (random() - 0.5) * 360,
  };
}

function clampDemoLatitude(latitude: number) {
  return clamp(latitude, -DEMO_MAX_ABS_LATITUDE, DEMO_MAX_ABS_LATITUDE);
}

function resolveTargetCount(random: () => number, override?: number) {
  if (override !== undefined) {
    return clamp(Math.floor(override), MIN_DEMO_TARGETS, MAX_DEMO_TARGETS);
  }
  return (
    MIN_DEMO_TARGETS +
    Math.floor(random() * (MAX_DEMO_TARGETS - MIN_DEMO_TARGETS + 1))
  );
}

/**
 * Parses a demo target-size input. Valid values are integers in (1, 100] i.e. 2–100.
 * Returns `null` when empty or invalid.
 */
export function parseDemoTargetCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 1 || value > MAX_DEMO_TARGETS)
    return null;
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

const DEMO_COLORS = TARGET_COLOR_OPTIONS.dark.map((option) => option.value);

function demoColor(index: number) {
  return DEMO_COLORS[index % DEMO_COLORS.length]!;
}

function demoCallsign(index: number, random: () => number) {
  const prefix = pickOne(CALLSIGN_PREFIXES, random);
  const number = String(index + 1).padStart(2, "0");
  return `${prefix} ${number}`;
}

/** Aircraft-only starting altitude across low / medium / high bands. */
function demoAircraftAltitude(random: () => number): number {
  const band = random();
  if (band < 0.28) return 1_200 + Math.floor(random() * 6_800);
  if (band < 0.72) return 8_000 + Math.floor(random() * 17_000);
  return 25_000 + Math.floor(random() * 16_000);
}

function scatterNearOrigin(
  origin: DemoOrigin,
  random: () => number,
  spread = 0.35,
) {
  return {
    latitude: clampDemoLatitude(origin.latitude + (random() - 0.5) * spread),
    longitude: origin.longitude + (random() - 0.5) * (spread * 1.55),
  };
}

/** Small lateral offset so formation members are near but not stacked. */
function formationOffset(random: () => number) {
  const scale = 0.006 + random() * 0.02;
  return {
    dLat: (random() - 0.5) * 2 * scale,
    dLng: (random() - 0.5) * 2 * scale,
  };
}

/**
 * Assigns each target a travel-group id. Same-category contacts sometimes join
 * an existing group so they share a start pocket and travel corridor.
 */
function assignTravelGroupIds(
  categories: readonly VehicleCategory[],
  random: () => number,
  joinProbability: number,
): number[] {
  const groupIds: number[] = [];
  const groupsByCategory = new Map<VehicleCategory, number[]>();
  const chance = clamp(joinProbability, 0, 1);

  for (let index = 0; index < categories.length; index += 1) {
    const category = categories[index]!;
    const existing = groupsByCategory.get(category) ?? [];
    if (existing.length > 0 && random() < chance) {
      groupIds.push(pickOne(existing, random));
      continue;
    }
    const groupId = index;
    groupIds.push(groupId);
    groupsByCategory.set(category, [...existing, groupId]);
  }

  return groupIds;
}

function resolveTrackTiming(
  random: () => number,
  windowSeconds: number | null,
): { startDelaySeconds: number; durationMinutes: number } {
  if (windowSeconds !== null) {
    const maxDurationSeconds = Math.max(
      60,
      Math.floor(windowSeconds * (0.45 + random() * 0.5)),
    );
    const durationMinutes = Math.max(1, Math.floor(maxDurationSeconds / 60));
    const slackSeconds = Math.max(0, windowSeconds - durationMinutes * 60);
    return {
      durationMinutes,
      startDelaySeconds:
        slackSeconds > 0 ? Math.floor(random() * slackSeconds) : 0,
    };
  }
  return {
    durationMinutes: 25 + Math.floor(random() * 35),
    startDelaySeconds: 5 + Math.floor(random() * 90),
  };
}

function buildTravelPlans(
  groupIds: readonly number[],
  categories: readonly VehicleCategory[],
  origin: DemoOrigin | null,
  random: () => number,
  windowSeconds: number | null,
): Map<number, DemoTravelPlan> {
  const memberCounts = new Map<number, number>();
  const categoryByGroup = new Map<number, VehicleCategory>();
  for (let index = 0; index < groupIds.length; index += 1) {
    const groupId = groupIds[index]!;
    memberCounts.set(groupId, (memberCounts.get(groupId) ?? 0) + 1);
    if (!categoryByGroup.has(groupId)) {
      categoryByGroup.set(groupId, categories[index]!);
    }
  }

  const plans = new Map<number, DemoTravelPlan>();
  for (const [groupId, memberCount] of memberCounts) {
    const sharedPath = memberCount > 1;
    const category = categoryByGroup.get(groupId)!;
    // Pinned origin → scatter nearby. Unpinned → fresh random world point per group
    // (not the small DEMO_START_LOCATIONS preset list, which looked like clustering).
    const base = origin
      ? scatterNearOrigin(origin, random, sharedPath ? 0.3 : 0.35)
      : randomWorldOrigin(random);
    const timing = resolveTrackTiming(random, windowSeconds);
    const heading = random() * 360;
    const cruise = categoryCruiseMidpointKnots(category);
    const durationHours = Math.max(timing.durationMinutes / 60, 1 / 60);
    // Stay under category max with heading noise slack used by point-to-point generation.
    const maxNm = Math.max(2, cruise * durationHours * 0.72);
    const minNm = Math.min(4, maxNm * 0.35);
    const distanceNm = minNm + random() * Math.max(0, maxNm - minNm);
    const end = destinationPoint(base, distanceNm, heading);
    plans.set(groupId, {
      baseLatitude: clampDemoLatitude(base.latitude),
      baseLongitude: base.longitude,
      endLatitude: clampDemoLatitude(end.latitude),
      endLongitude: end.longitude,
      startDelaySeconds: timing.startDelaySeconds,
      durationMinutes: timing.durationMinutes,
      sharedPath,
    });
  }
  return plans;
}

function resolveScenarioWindow(
  now: number,
  options: CreateDemoScenarioOptions,
): { startMs: number; endMs: number | null } {
  const startMs = options.startAt ? Date.parse(options.startAt) : now;
  const resolvedStart = Number.isFinite(startMs) ? startMs : now;
  if (!options.endAt?.trim()) {
    return { startMs: resolvedStart, endMs: null };
  }
  const endMs = Date.parse(options.endAt);
  if (!Number.isFinite(endMs) || endMs <= resolvedStart) {
    return { startMs: resolvedStart, endMs: null };
  }
  return { startMs: resolvedStart, endMs };
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
  const { startMs, endMs } = resolveScenarioWindow(now, options);
  const origin = options.origin ?? null;
  const createdAt = new Date(now).toISOString();
  const idFactory = () => crypto.randomUUID();
  const windowSeconds =
    endMs !== null ? Math.max(60, Math.floor((endMs - startMs) / 1_000)) : null;

  const categories = Array.from({ length: targetCount }, () =>
    resolveCategory(vehicleSelection, random),
  );
  const groupIds = assignTravelGroupIds(
    categories,
    random,
    options.groupJoinProbability ?? GROUP_JOIN_PROBABILITY,
  );
  const travelPlans = buildTravelPlans(
    groupIds,
    categories,
    origin,
    random,
    windowSeconds,
  );

  const targets: TargetDefinition[] = [];
  const trackEvents: SimulationEvent[] = [];
  const messages: SimulationEvent[] = [];

  for (let index = 0; index < targetCount; index += 1) {
    const vehicleCategory = categories[index]!;
    const plan = travelPlans.get(groupIds[index]!)!;
    const targetId = idFactory();
    const pointCount = 10 + Math.floor(random() * 15);
    const offset = plan.sharedPath
      ? formationOffset(random)
      : { dLat: 0, dLng: 0 };
    const memberStagger =
      plan.sharedPath && windowSeconds !== null
        ? Math.floor(
            random() *
              Math.min(
                40,
                Math.max(0, windowSeconds - plan.startDelaySeconds - 60),
              ),
          )
        : plan.sharedPath
          ? Math.floor(random() * 40)
          : 0;
    const trackStartDelay = plan.startDelaySeconds + memberStagger;
    const rawEndDelay = trackStartDelay + plan.durationMinutes * 60;
    const trackEndDelay =
      windowSeconds !== null
        ? Math.max(trackStartDelay + 60, Math.min(rawEndDelay, windowSeconds))
        : rawEndDelay;

    const startPoint: PositionPayload = {
      latitude: clampDemoLatitude(plan.baseLatitude + offset.dLat),
      longitude: plan.baseLongitude + offset.dLng,
      altitude:
        vehicleCategory === "aircraft" ? demoAircraftAltitude(random) : 0,
    };
    const endPoint: PositionPayload | undefined = plan.sharedPath
      ? {
          latitude: clampDemoLatitude(plan.endLatitude + offset.dLat),
          longitude: plan.endLongitude + offset.dLng,
          altitude: startPoint.altitude,
        }
      : undefined;

    targets.push({
      id: targetId,
      callsign: demoCallsign(index, random),
      revealOnFirstEvent: true,
      appearOnFirstEvent: false,
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
        startAt: atOffset(startMs, trackStartDelay),
        endAt: atOffset(startMs, trackEndDelay),
        startPoint,
        endPoint,
        vehicleCategory,
        maxAbsLatitude: DEMO_MAX_ABS_LATITUDE,
        random,
        idFactory,
      }),
    );

    if (random() < 0.35 || index < 2) {
      const messageAt =
        trackStartDelay +
        Math.floor(((trackEndDelay - trackStartDelay) / 60) * 30);
      messages.push({
        id: idFactory(),
        targetId,
        at: atOffset(startMs, Math.min(messageAt, trackEndDelay)),
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
