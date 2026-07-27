import {
  DEMO_REGIONS,
  regionCenter,
} from "@/lib/demo-regions";
import {
  categoryCruiseMidpointKnots,
  generateRouteEvents,
  mergeGeneratedEvents,
} from "@/lib/event-generator";
import { destinationPoint } from "@/lib/position-telemetry";
import { createSeededRandom, resolveIdFactory } from "@/lib/random";
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

export type { DemoRegion } from "@/lib/demo-regions";
export {
  DEMO_REGIONS,
  demoRegionById,
  demoRegionsByIds,
  regionCenter,
  regionsSupporting,
} from "@/lib/demo-regions";

export type DemoVehicleSelection = "random" | readonly VehicleCategory[];

export interface DemoOrigin {
  latitude: number;
  longitude: number;
}

/**
 * `"anywhere"` — world sampling (default when unpinned).
 * A list of region ids — contacts are placed only in compatible selected regions
 * (relocating within the selection, or falling back to anywhere when none fit).
 */
export type DemoRegionSelection = "anywhere" | readonly string[];

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
   * Geographic pin for start points. **Wins over region selection** when set
   * (precedence: pin > regions > anywhere).
   */
  origin?: DemoOrigin;
  /**
   * Region catalogue selection. Ignored when {@link origin} (pin) is set.
   * Defaults to `"anywhere"`.
   */
  regions?: DemoRegionSelection;
  /** Override travel-group join chance (0–1). Defaults to {@link GROUP_JOIN_PROBABILITY}. */
  groupJoinProbability?: number;
  /**
   * When set, replaces the `random` argument with {@link createSeededRandom}
   * and, unless {@link idFactory} is provided, a seeded id factory — so the
   * same seed fully reproduces the scenario (including ids).
   */
  seed?: number;
  /**
   * Optional id factory for targets/events. When omitted and {@link seed} is
   * set, a seed-derived factory is used automatically.
   */
  idFactory?: () => string;
  /** Abort in-flight geo planning (threaded into tile fetches via cancel messages). */
  signal?: AbortSignal;
  /** Called as each target finishes planning (streaming). */
  onTargetReady?: (update: DemoTargetReady) => void;
  /** Max concurrent route requests (default 5). */
  concurrency?: number;
  /**
   * Force the synthetic path for every track (tests / offline). Routed planning
   * is skipped entirely.
   */
  forceSynthetic?: boolean;
  /**
   * Override the region catalogue (tests). Defaults to {@link DEMO_REGIONS}.
   */
  regionCatalog?: readonly import("@/lib/demo-regions").DemoRegion[];
}

/** Streaming callback payload from {@link createDemoScenario}. */
export interface DemoTargetReady {
  target: TargetDefinition;
  events: SimulationEvent[];
  index: number;
  /** True when this track fell back to the synthetic generator. */
  degraded: boolean;
  /** Region id used for placement, or null for pin / anywhere. */
  regionId: string | null;
  /** True when no selected region supported the category (anywhere-sampled). */
  anywhereFallback: boolean;
}

/** Result of async geo-aware demo generation. */
export interface CreateDemoScenarioResult {
  scenario: SimulationScenario;
  /** Tracks that used the synthetic generator after a routing/placement failure. */
  degradedTrackCount: number;
  /** Tracks placed via anywhere-sampling because no selected region supported them. */
  anywhereFallbackCount: number;
  cancelled: boolean;
}

export const MIN_DEMO_TARGETS = 2;
export const MAX_DEMO_TARGETS = 100;

/**
 * Compatibility shim for scenario-builder until phase 4b switches to
 * {@link DEMO_REGIONS}. Centers are bbox midpoints of the typed catalogue.
 */
export const DEMO_START_LOCATIONS = DEMO_REGIONS.map((region) => {
  const center = regionCenter(region);
  return {
    name: region.name,
    latitude: center.latitude,
    longitude: center.longitude,
  };
});

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

export interface DemoTravelPlan {
  baseLatitude: number;
  baseLongitude: number;
  endLatitude: number;
  endLongitude: number;
  startDelaySeconds: number;
  durationMinutes: number;
  /** Multi-member groups share an A→B corridor; solos wander independently. */
  sharedPath: boolean;
  /** Placement region id when region-scoped; null for pin / anywhere. */
  regionId?: string | null;
  /** True when category had no compatible selected region. */
  anywhereFallback?: boolean;
}

export function atOffsetIso(base: number, seconds: number) {
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
  const region = pickOne(DEMO_REGIONS, random);
  return regionCenter(region);
}

/** Uniform random point for unpinned demo starts (UI presets are separate). */
export function randomWorldOrigin(random: () => number): DemoOrigin {
  return {
    latitude: (random() - 0.5) * 2 * DEMO_MAX_ABS_LATITUDE,
    longitude: (random() - 0.5) * 360,
  };
}

export function clampDemoLatitude(latitude: number) {
  return clamp(latitude, -DEMO_MAX_ABS_LATITUDE, DEMO_MAX_ABS_LATITUDE);
}

export function randomPointInBbox(
  bbox: readonly [number, number, number, number],
  random: () => number,
): DemoOrigin {
  const [west, south, east, north] = bbox;
  return {
    latitude: clampDemoLatitude(south + random() * (north - south)),
    longitude: west + random() * (east - west),
  };
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

export function resolveCategory(
  selection: DemoVehicleSelection,
  random: () => number,
): VehicleCategory {
  if (selection === "random" || selection.length === 0) {
    return pickOne(VEHICLE_CATEGORIES, random);
  }
  return pickOne(selection, random);
}

const DEMO_COLORS = TARGET_COLOR_OPTIONS.dark.map((option) => option.value);

export function demoColor(index: number) {
  return DEMO_COLORS[index % DEMO_COLORS.length]!;
}

export function demoCallsign(index: number, random: () => number) {
  const prefix = pickOne(CALLSIGN_PREFIXES, random);
  const number = String(index + 1).padStart(2, "0");
  return `${prefix} ${number}`;
}

/** Aircraft-only starting altitude across low / medium / high bands. */
export function demoAircraftAltitude(random: () => number): number {
  const band = random();
  if (band < 0.28) return 1_200 + Math.floor(random() * 6_800);
  if (band < 0.72) return 8_000 + Math.floor(random() * 17_000);
  return 25_000 + Math.floor(random() * 16_000);
}

export function scatterNearOrigin(
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
export function formationOffset(random: () => number) {
  const scale = 0.006 + random() * 0.02;
  return {
    dLat: (random() - 0.5) * 2 * scale,
    dLng: (random() - 0.5) * 2 * scale,
  };
}

export function pickDemoVehicleSubtype(
  category: VehicleCategory,
  random: () => number,
): string {
  return pickOne(VEHICLE_SUBTYPES[category], random);
}

/**
 * Assigns each target a travel-group id. Same-category contacts sometimes join
 * an existing group so they share a start pocket and travel corridor.
 */
export function assignTravelGroupIds(
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

export function resolveTrackTiming(
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

export type PlacementResolution = {
  base: DemoOrigin;
  regionId: string | null;
  anywhereFallback: boolean;
};

/**
 * Resolve placement for a travel group.
 * Precedence: pin (`origin`) > selected regions > anywhere.
 */
export function resolveGroupPlacement(
  category: VehicleCategory,
  origin: DemoOrigin | null,
  regionSelection: DemoRegionSelection | undefined,
  random: () => number,
  sharedPath: boolean,
  catalog: readonly import("@/lib/demo-regions").DemoRegion[] = DEMO_REGIONS,
): PlacementResolution {
  if (origin) {
    return {
      base: scatterNearOrigin(origin, random, sharedPath ? 0.3 : 0.35),
      regionId: null,
      anywhereFallback: false,
    };
  }

  const selection = regionSelection ?? "anywhere";
  if (selection === "anywhere") {
    return {
      base: randomWorldOrigin(random),
      regionId: null,
      anywhereFallback: false,
    };
  }

  const selectedIds = new Set(selection);
  const selected = catalog.filter((region) => selectedIds.has(region.id));
  const compatible = selected.filter((region) =>
    region.supports.includes(category),
  );
  if (compatible.length > 0) {
    const region = pickOne(compatible, random);
    return {
      base: scatterNearOrigin(
        regionCenter(region),
        random,
        sharedPath ? 0.25 : 0.3,
      ),
      regionId: region.id,
      anywhereFallback: false,
    };
  }

  // No selected region supports this category → anywhere-sample and report.
  return {
    base: randomWorldOrigin(random),
    regionId: null,
    anywhereFallback: true,
  };
}

export function buildTravelPlans(
  groupIds: readonly number[],
  categories: readonly VehicleCategory[],
  origin: DemoOrigin | null,
  random: () => number,
  windowSeconds: number | null,
  regionSelection?: DemoRegionSelection,
  catalog: readonly import("@/lib/demo-regions").DemoRegion[] = DEMO_REGIONS,
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
    const placement = resolveGroupPlacement(
      category,
      origin,
      regionSelection,
      random,
      sharedPath,
      catalog,
    );
    const timing = resolveTrackTiming(random, windowSeconds);
    const heading = random() * 360;
    const cruise = categoryCruiseMidpointKnots(category);
    const durationHours = Math.max(timing.durationMinutes / 60, 1 / 60);
    // Stay under category max with heading noise slack used by point-to-point generation.
    const maxNm = Math.max(2, cruise * durationHours * 0.72);
    const minNm = Math.min(4, maxNm * 0.35);
    const distanceNm = minNm + random() * Math.max(0, maxNm - minNm);
    const end = destinationPoint(placement.base, distanceNm, heading);
    plans.set(groupId, {
      baseLatitude: clampDemoLatitude(placement.base.latitude),
      baseLongitude: placement.base.longitude,
      endLatitude: clampDemoLatitude(end.latitude),
      endLongitude: end.longitude,
      startDelaySeconds: timing.startDelaySeconds,
      durationMinutes: timing.durationMinutes,
      sharedPath,
      regionId: placement.regionId,
      anywhereFallback: placement.anywhereFallback,
    });
  }
  return plans;
}

export function resolveScenarioWindow(
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

export type SynthesizeTargetOptions = {
  index: number;
  vehicleCategory: VehicleCategory;
  vehicleSubtype?: string;
  plan: DemoTravelPlan;
  startMs: number;
  windowSeconds: number | null;
  random: () => number;
  idFactory: () => string;
};

export type SynthesizedTarget = {
  target: TargetDefinition;
  events: SimulationEvent[];
  messages: SimulationEvent[];
};

/**
 * Build one synthetic target + track events. Used by the full synthetic scenario
 * and as the per-track degradation fallback in the geo planner.
 */
export function synthesizeDemoTarget(
  options: SynthesizeTargetOptions,
): SynthesizedTarget {
  const {
    index,
    vehicleCategory,
    plan,
    startMs,
    windowSeconds,
    random,
    idFactory,
  } = options;
  const vehicleSubtype =
    options.vehicleSubtype ?? pickDemoVehicleSubtype(vehicleCategory, random);
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
    altitude: vehicleCategory === "aircraft" ? demoAircraftAltitude(random) : 0,
  };
  const endPoint: PositionPayload | undefined = plan.sharedPath
    ? {
        latitude: clampDemoLatitude(plan.endLatitude + offset.dLat),
        longitude: plan.endLongitude + offset.dLng,
        altitude: startPoint.altitude,
      }
    : undefined;

  const target: TargetDefinition = {
    id: targetId,
    callsign: demoCallsign(index, random),
    revealOnFirstEvent: true,
    appearOnFirstEvent: false,
    color: demoColor(index),
    profile: {
      vehicleCategory,
      vehicleSubtype,
      affiliation: pickOne(AFFILIATIONS, random) as Affiliation,
      status: pickOne(TARGET_STATUSES, random) as TargetStatus,
      identifier: `${vehicleCategory.slice(0, 3).toUpperCase()}-${String(100 + index)}`,
      description: `Demo ${vehicleCategory} contact.`,
    },
  };

  const events = generateRouteEvents({
    targetId,
    count: pointCount,
    startAt: atOffsetIso(startMs, trackStartDelay),
    endAt: atOffsetIso(startMs, trackEndDelay),
    startPoint,
    endPoint,
    vehicleCategory,
    maxAbsLatitude: DEMO_MAX_ABS_LATITUDE,
    random,
    idFactory,
  });

  const messages: SimulationEvent[] = [];
  if (random() < 0.35 || index < 2) {
    const messageAt =
      trackStartDelay +
      Math.floor(((trackEndDelay - trackStartDelay) / 60) * 30);
    messages.push({
      id: idFactory(),
      targetId,
      at: atOffsetIso(startMs, Math.min(messageAt, trackEndDelay)),
      message: pickOne(DEMO_MESSAGES, random),
    });
  }

  return { target, events, messages };
}

/**
 * Fast synchronous demo generator (terrain-blind). Used as the degradation
 * tier when geo routing fails, and by unit tests that must stay offline/fast.
 */
export function createSyntheticDemoScenario(
  now = Date.now(),
  random: () => number = Math.random,
  options: CreateDemoScenarioOptions = {},
): SimulationScenario {
  if (options.seed !== undefined) {
    random = createSeededRandom(options.seed);
  }
  const vehicleSelection = options.vehicleSelection ?? "random";
  const targetCount = resolveTargetCount(random, options.targetCount);
  const { startMs, endMs } = resolveScenarioWindow(now, options);
  const origin = options.origin ?? null;
  const createdAt = new Date(now).toISOString();
  const idFactory = resolveIdFactory(options);
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
    options.regions,
    options.regionCatalog,
  );

  const targets: TargetDefinition[] = [];
  const trackEvents: SimulationEvent[] = [];
  const messages: SimulationEvent[] = [];

  for (let index = 0; index < targetCount; index += 1) {
    const vehicleCategory = categories[index]!;
    const plan = travelPlans.get(groupIds[index]!)!;
    const synthesized = synthesizeDemoTarget({
      index,
      vehicleCategory,
      plan,
      startMs,
      windowSeconds,
      random,
      idFactory,
    });
    targets.push(synthesized.target);
    trackEvents.push(...synthesized.events);
    messages.push(...synthesized.messages);
  }

  return {
    schemaVersion: 2,
    id: idFactory(),
    name: demoName(vehicleSelection, targetCount),
    description: demoDescription(vehicleSelection, targetCount),
    createdAt,
    updatedAt: createdAt,
    priorityTerms: ["critical", "proximity threshold"],
    targets,
    events: mergeGeneratedEvents(trackEvents, messages),
  };
}

/**
 * Async streaming geo-aware demo generation. Delegates to
 * {@link planDemoScenario}. Prefer {@link createSyntheticDemoScenario} in fast
 * unit tests.
 *
 * Phase 4b wires the builder to this API (progress / cancel / region multi-select).
 * Until then, scenario-builder should call {@link createSyntheticDemoScenario}.
 */
export async function createDemoScenario(
  now = Date.now(),
  random: () => number = Math.random,
  options: CreateDemoScenarioOptions = {},
): Promise<CreateDemoScenarioResult> {
  const { planDemoScenario } = await import("@/lib/scenario-planner");
  return planDemoScenario(now, random, options);
}

export function defaultTargetProfile(): TargetDefinition["profile"] {
  return {
    vehicleCategory: "other",
    affiliation: "unknown",
    status: "active",
  };
}
