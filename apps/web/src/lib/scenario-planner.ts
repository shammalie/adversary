/**
 * Phase 4a — streaming async scenario planner.
 *
 * Plans aircraft first (seed-only, no tile I/O) so first contacts appear quickly,
 * then road/sea routes under bounded concurrency. Per-track failures degrade to
 * {@link synthesizeDemoTarget} without discarding successfully routed tracks.
 *
 * Worker cancel uses requestId + in-worker AbortController (AbortSignal is not
 * transferable across the worker boundary).
 */

import geoSeeds from "../../public/geo-seeds.json";
import {
  assignTravelGroupIds,
  atOffsetIso,
  buildTravelPlans,
  clampDemoLatitude,
  demoCallsign,
  demoColor,
  formationOffset,
  GROUP_JOIN_PROBABILITY,
  pickDemoVehicleSubtype,
  resolveCategory,
  resolveScenarioWindow,
  synthesizeDemoTarget,
  type CreateDemoScenarioOptions,
  type CreateDemoScenarioResult,
  type DemoTargetReady,
  type DemoTravelPlan,
} from "@/lib/demo-scenario";
import { demoRegionById } from "@/lib/demo-regions";
import { mergeGeneratedEvents } from "@/lib/event-generator";
import {
  kinematicsFromProfile,
  planAirRoute,
  unpackGeoSeedsAerodromes,
  type Aerodrome,
  type GeoSeedsBundle,
} from "@/lib/geo/air-router";
import {
  createGeoRouterClient,
  type GeoRouterClient,
} from "@/lib/geo/geo-router-client";
import type { GeoRouterLngLat, GeoRouterMode } from "@/lib/geo/geo-router-protocol";
import { pathToEvents, type PathPoint } from "@/lib/geo/path-to-events";
import {
  resolveGenerationCruiseKnots,
  resolveVehicleProfile,
} from "@/lib/geo/vehicle-profiles";
import { haversineDistanceNm } from "@/lib/position-telemetry";
import { createSeededRandom, resolveIdFactory } from "@/lib/random";
import { CATEGORY_TOP_SPEED_KNOTS } from "@/lib/vehicle-speed";
import type {
  Affiliation,
  SimulationEvent,
  SimulationScenario,
  TargetDefinition,
  TargetStatus,
  VehicleCategory,
} from "@/types/target";
import { AFFILIATIONS, TARGET_STATUSES } from "@/types/target";

const DEFAULT_CONCURRENCY = 5;
const ROUTE_TIMEOUT_MS = 12_000;

export type RouteFn = (args: {
  mode: GeoRouterMode;
  origin: GeoRouterLngLat;
  destination: GeoRouterLngLat;
  options?: Record<string, unknown>;
  signal?: AbortSignal;
}) => Promise<GeoRouterLngLat[]>;

export type PlanDemoScenarioDeps = {
  routeFn?: RouteFn;
  aerodromes?: readonly Aerodrome[];
  /**
   * Optional start-point water check for the `other` category.
   * When omitted, mode falls back to {@link resolveRouteMode}.
   */
  isWaterAt?: (
    longitude: number,
    latitude: number,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  /** When true (default), terminate an owned worker client after planning. */
  disposeClient?: boolean;
};

type TrackJob = {
  index: number;
  groupId: number;
  category: VehicleCategory;
  subtype: string;
  plan: DemoTravelPlan;
};

type SharedCorridor = {
  path: PathPoint[];
  mode: GeoRouterMode | "synthetic";
  degraded: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pickOne<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}

function resolveTargetCount(random: () => number, override?: number) {
  if (override !== undefined) {
    return clamp(Math.floor(override), 2, 100);
  }
  return 2 + Math.floor(random() * 99);
}

function formatCategoryLabel(category: VehicleCategory) {
  return `${category[0]!.toUpperCase()}${category.slice(1)}`;
}

function demoName(
  selection: CreateDemoScenarioOptions["vehicleSelection"],
  targetCount: number,
) {
  const resolved = selection ?? "random";
  if (resolved === "random" || resolved.length === 0) {
    return `Random demo (${targetCount} targets)`;
  }
  if (resolved.length === 1) {
    return `${formatCategoryLabel(resolved[0]!)} demo (${targetCount} targets)`;
  }
  return `Mixed demo (${targetCount} targets)`;
}

function demoDescription(
  selection: CreateDemoScenarioOptions["vehicleSelection"],
  targetCount: number,
) {
  const resolved = selection ?? "random";
  if (resolved === "random" || resolved.length === 0) {
    return `Generated demonstration with ${targetCount} contacts across mixed vehicle types.`;
  }
  if (resolved.length === 1) {
    return `Generated demonstration with ${targetCount} ${resolved[0]} contacts.`;
  }
  return `Generated demonstration with ${targetCount} contacts from ${resolved.join(", ")}.`;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Demo scenario planning was cancelled.", "AbortError");
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Route timed out after ${ms}ms`));
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Demo scenario planning was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function offsetPath(path: readonly PathPoint[], dLat: number, dLng: number): PathPoint[] {
  return path.map((point) => ({
    ...point,
    latitude: clampDemoLatitude(point.latitude + dLat),
    longitude: point.longitude + dLng,
  }));
}

function pathLengthNm(path: readonly PathPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += haversineDistanceNm(path[i - 1]!, path[i]!);
  }
  return total;
}

/**
 * Clamp a track end delay so average speed stays inside the profile cruise band.
 * Mock/short router paths paired with long demo durations would otherwise fall
 * below the cruise floor (or above the ceiling) inside pathToEvents.
 */
function clampEndDelayToCruiseBand(options: {
  path: readonly PathPoint[];
  trackStartDelay: number;
  trackEndDelay: number;
  vehicleCategory: VehicleCategory;
  vehicleSubtype?: string;
}): number {
  const profile = resolveVehicleProfile(options.vehicleCategory, options.vehicleSubtype);
  const floor = profile.cruiseKnots.minKnots;
  const ceiling = Math.min(
    profile.maxKnots,
    CATEGORY_TOP_SPEED_KNOTS[options.vehicleCategory],
  );
  const totalNm = pathLengthNm(options.path);
  if (totalNm < 0.001 || floor <= 0 || ceiling <= 0) {
    return options.trackEndDelay;
  }
  const durationSec = Math.max(1, options.trackEndDelay - options.trackStartDelay);
  const requiredKnots = totalNm / (durationSec / 3_600);
  if (requiredKnots < floor) {
    const maxSec = Math.max(60, (totalNm / floor) * 3_600 * 0.98);
    return options.trackStartDelay + maxSec;
  }
  if (requiredKnots > ceiling) {
    const minSec = Math.max(60, (totalNm / ceiling) * 3_600 * 1.02);
    return options.trackStartDelay + minSec;
  }
  return options.trackEndDelay;
}

function greatCirclePath(plan: DemoTravelPlan): PathPoint[] {
  // Omit altitudes so pathToEvents applies the profile vertical curve between
  // authored defaults (aircraft: climb then descend to 0; surface: near-zero).
  return [
    { latitude: plan.baseLatitude, longitude: plan.baseLongitude },
    { latitude: plan.endLatitude, longitude: plan.endLongitude },
  ];
}

/**
 * Route mode for a category. `other` is terrain-routed: sea when the start
 * looks maritime (region supports boat but not car/truck, or longitude/lat
 * heuristics are insufficient) — we prefer sea when the placement region
 * only supports boat among surface types, otherwise road. When pin/anywhere
 * with no region, default to road unless the plan base is clearly oceanic
 * (abs lat < 70 and we have no land region). Simpler rule used here:
 * if region supports boat and not car → sea; else if water-biased maritime
 * region id → sea; else road for `other`.
 */
export function resolveRouteMode(
  category: VehicleCategory,
  regionId: string | null | undefined,
): GeoRouterMode {
  if (category === "aircraft") return "air";
  if (category === "boat") return "sea";
  if (category === "car" || category === "truck") return "road";

  // `other`: sea if start region is maritime-only for surface, else road.
  if (regionId) {
    const region = demoRegionById(regionId);
    if (region) {
      const hasBoat = region.supports.includes("boat");
      const hasRoad =
        region.supports.includes("car") || region.supports.includes("truck");
      if (hasBoat && !hasRoad) return "sea";
    }
  }
  return "road";
}

/**
 * Terrain-aware `other` classification override used when a start-point water
 * flag is known (planner injects after classify, or tests stub it).
 */
export function resolveOtherRouteMode(isWater: boolean): GeoRouterMode {
  return isWater ? "sea" : "road";
}

function loadDefaultAerodromes(): Aerodrome[] {
  const bundle = geoSeeds as unknown as GeoSeedsBundle;
  return unpackGeoSeedsAerodromes(bundle.aerodromes);
}

function sortAircraftFirst(jobs: TrackJob[]): TrackJob[] {
  return [...jobs].sort((a, b) => {
    const aAir = a.category === "aircraft" ? 0 : 1;
    const bAir = b.category === "aircraft" ? 0 : 1;
    if (aAir !== bAir) return aAir - bAir;
    return a.index - b.index;
  });
}

async function planAirPath(
  job: TrackJob,
  aerodromes: readonly Aerodrome[],
  random: () => number,
): Promise<PathPoint[]> {
  const profile = resolveVehicleProfile(job.category, job.subtype);
  const cruiseKnots = resolveGenerationCruiseKnots({
    vehicleCategory: job.category,
    vehicleSubtype: job.subtype,
  });
  const kinematics = {
    ...kinematicsFromProfile(profile),
    cruiseKnots,
  };
  const windowHours = Math.max(job.plan.durationMinutes / 60, 1 / 60);
  const region = job.plan.regionId ? demoRegionById(job.plan.regionId) : undefined;
  const result = planAirRoute({
    aerodromes,
    bbox: region?.bbox,
    windowHours,
    kinematics,
    random,
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  // Preserve router altitudes (start/end field elevations + cruise FL).
  return result.path;
}

async function planSurfacePath(
  job: TrackJob,
  mode: GeoRouterMode,
  routeFn: RouteFn,
  signal: AbortSignal | undefined,
): Promise<PathPoint[]> {
  const coordinates = await withTimeout(
    routeFn({
      mode,
      origin: {
        longitude: job.plan.baseLongitude,
        latitude: job.plan.baseLatitude,
      },
      destination: {
        longitude: job.plan.endLongitude,
        latitude: job.plan.endLatitude,
      },
      signal,
      options:
        mode === "road"
          ? { vehicle: job.category === "truck" ? "truck" : "car" }
          : undefined,
    }),
    ROUTE_TIMEOUT_MS,
    signal,
  );
  if (coordinates.length < 2) {
    throw new Error("Router returned an empty path.");
  }
  return coordinates.map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    // Surface routers typically omit altitude; preserve when present.
    ...("altitude" in point &&
    typeof (point as { altitude?: unknown }).altitude === "number"
      ? { altitude: (point as { altitude: number }).altitude }
      : { altitude: 0 }),
  }));
}

function buildRoutedTarget(args: {
  job: TrackJob;
  path: PathPoint[];
  startMs: number;
  windowSeconds: number | null;
  random: () => number;
  idFactory: () => string;
  degraded: boolean;
}): DemoTargetReady {
  const { job, startMs, windowSeconds, random, idFactory, degraded } = args;
  let path = args.path;

  const offset = job.plan.sharedPath
    ? formationOffset(random)
    : { dLat: 0, dLng: 0 };
  if (offset.dLat !== 0 || offset.dLng !== 0) {
    path = offsetPath(path, offset.dLat, offset.dLng);
  }

  const memberStagger =
    job.plan.sharedPath && windowSeconds !== null
      ? Math.floor(
          random() *
            Math.min(
              40,
              Math.max(0, windowSeconds - job.plan.startDelaySeconds - 60),
            ),
        )
      : job.plan.sharedPath
        ? Math.floor(random() * 40)
        : 0;
  const trackStartDelay = job.plan.startDelaySeconds + memberStagger;
  const rawEndDelay = trackStartDelay + job.plan.durationMinutes * 60;
  const boundedEndDelay =
    windowSeconds !== null
      ? Math.max(trackStartDelay + 60, Math.min(rawEndDelay, windowSeconds))
      : rawEndDelay;
  const trackEndDelay = clampEndDelayToCruiseBand({
    path,
    trackStartDelay,
    trackEndDelay: boundedEndDelay,
    vehicleCategory: job.category,
    vehicleSubtype: job.subtype,
  });

  const targetId = idFactory();
  const target: TargetDefinition = {
    id: targetId,
    callsign: demoCallsign(job.index, random),
    revealOnFirstEvent: true,
    appearOnFirstEvent: false,
    color: demoColor(job.index),
    profile: {
      vehicleCategory: job.category,
      vehicleSubtype: job.subtype,
      affiliation: pickOne(AFFILIATIONS, random) as Affiliation,
      status: pickOne(TARGET_STATUSES, random) as TargetStatus,
      identifier: `${job.category.slice(0, 3).toUpperCase()}-${String(100 + job.index)}`,
      description: `Demo ${job.category} contact.`,
    },
  };

  let events: SimulationEvent[];
  try {
    events = pathToEvents({
      targetId,
      path,
      startAt: atOffsetIso(startMs, trackStartDelay),
      endAt: atOffsetIso(startMs, trackEndDelay),
      vehicleCategory: job.category,
      vehicleSubtype: job.subtype,
      cruiseKnots: resolveGenerationCruiseKnots({
        vehicleCategory: job.category,
        vehicleSubtype: job.subtype,
      }),
      idFactory,
    });
  } catch {
    const fallback = synthesizeDemoTarget({
      index: job.index,
      vehicleCategory: job.category,
      vehicleSubtype: job.subtype,
      plan: job.plan,
      startMs,
      windowSeconds,
      random,
      idFactory,
    });
    return {
      target: fallback.target,
      events: mergeGeneratedEvents(fallback.events, fallback.messages),
      index: job.index,
      degraded: true,
      regionId: job.plan.regionId ?? null,
      anywhereFallback: Boolean(job.plan.anywhereFallback),
    };
  }

  const messages: SimulationEvent[] = [];
  if (random() < 0.35 || job.index < 2) {
    const messageAt =
      trackStartDelay +
      Math.floor(((trackEndDelay - trackStartDelay) / 60) * 30);
    messages.push({
      id: idFactory(),
      targetId,
      at: atOffsetIso(startMs, Math.min(messageAt, trackEndDelay)),
      message: "Track quality improved. Contact maintaining course.",
    });
  }

  return {
    target,
    events: mergeGeneratedEvents(events, messages),
    index: job.index,
    degraded,
    regionId: job.plan.regionId ?? null,
    anywhereFallback: Boolean(job.plan.anywhereFallback),
  };
}

function buildSyntheticReady(
  job: TrackJob,
  startMs: number,
  windowSeconds: number | null,
  random: () => number,
  idFactory: () => string,
): DemoTargetReady {
  const synthesized = synthesizeDemoTarget({
    index: job.index,
    vehicleCategory: job.category,
    vehicleSubtype: job.subtype,
    plan: job.plan,
    startMs,
    windowSeconds,
    random,
    idFactory,
  });
  return {
    target: synthesized.target,
    events: mergeGeneratedEvents(synthesized.events, synthesized.messages),
    index: job.index,
    degraded: true,
    regionId: job.plan.regionId ?? null,
    anywhereFallback: Boolean(job.plan.anywhereFallback),
  };
}

/**
 * Async iterator that yields targets as they complete. Aircraft jobs are
 * scheduled first; overall in-flight work is capped by `concurrency`.
 */
export async function* iterateDemoTargets(
  now = Date.now(),
  random: () => number = Math.random,
  options: CreateDemoScenarioOptions = {},
  deps: PlanDemoScenarioDeps = {},
): AsyncGenerator<DemoTargetReady> {
  if (options.seed !== undefined) {
    random = createSeededRandom(options.seed);
  }

  const vehicleSelection = options.vehicleSelection ?? "random";
  const targetCount = resolveTargetCount(random, options.targetCount);
  const { startMs, endMs } = resolveScenarioWindow(now, options);
  const origin = options.origin ?? null;
  // Share one factory across this iterator (and planDemoScenario when wired
  // through optionsWithIds) so seed alone is fully deterministic.
  const idFactory = resolveIdFactory(options);
  const windowSeconds =
    endMs !== null ? Math.max(60, Math.floor((endMs - startMs) / 1_000)) : null;
  const concurrency = clamp(options.concurrency ?? DEFAULT_CONCURRENCY, 1, 8);
  const signal = options.signal;
  const forceSynthetic = Boolean(options.forceSynthetic);

  const categories = Array.from({ length: targetCount }, () =>
    resolveCategory(vehicleSelection, random),
  );
  const subtypes = categories.map((category) =>
    pickDemoVehicleSubtype(category, random),
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

  const jobs: TrackJob[] = categories.map((category, index) => ({
    index,
    groupId: groupIds[index]!,
    category,
    subtype: subtypes[index]!,
    plan: travelPlans.get(groupIds[index]!)!,
  }));

  if (forceSynthetic) {
    const ordered = sortAircraftFirst(jobs);
    for (const job of ordered) {
      throwIfAborted(signal);
      const ready = buildSyntheticReady(
        job,
        startMs,
        windowSeconds,
        random,
        idFactory,
      );
      options.onTargetReady?.(ready);
      yield ready;
    }
    return;
  }

  const ordered = sortAircraftFirst(jobs);
  const aerodromes = deps.aerodromes ?? loadDefaultAerodromes();

  // Box the client so closure writes are visible to the finally block (CFA).
  const ownedClient: { current: GeoRouterClient | null } = { current: null };
  const routeFn: RouteFn =
    deps.routeFn ??
    ((request) => {
      ownedClient.current ??= createGeoRouterClient();
      return ownedClient.current.route(request);
    });

  const sharedCorridors = new Map<number, Promise<SharedCorridor>>();
  const queue: DemoTargetReady[] = [];
  let queueWaiters: Array<() => void> = [];
  let active = 0;
  let cursor = 0;
  let finished = false;
  let failure: unknown = null;
  let aborted = false;

  const wake = () => {
    const waiters = queueWaiters;
    queueWaiters = [];
    for (const resolve of waiters) resolve();
  };

  const markAbort = (error: unknown) => {
    aborted = true;
    failure = error;
    finished = true;
    wake();
  };

  const enqueue = (ready: DemoTargetReady) => {
    if (aborted) return;
    queue.push(ready);
    options.onTargetReady?.(ready);
    wake();
  };

  const resolveSharedCorridor = (job: TrackJob): Promise<SharedCorridor> => {
    const existing = sharedCorridors.get(job.groupId);
    if (existing) return existing;

    const promise = (async (): Promise<SharedCorridor> => {
      throwIfAborted(signal);
      if (job.category === "aircraft") {
        try {
          const path = await planAirPath(job, aerodromes, random);
          return { path, mode: "air", degraded: false };
        } catch {
          return {
            path: greatCirclePath(job.plan),
            mode: "synthetic",
            degraded: true,
          };
        }
      }

      // `other` by terrain when a water classifier is provided; otherwise
      // region-heuristic via resolveRouteMode.
      let mode = resolveRouteMode(job.category, job.plan.regionId);
      if (job.category === "other" && deps.isWaterAt) {
        try {
          const isWater = await deps.isWaterAt(
            job.plan.baseLongitude,
            job.plan.baseLatitude,
            signal,
          );
          mode = resolveOtherRouteMode(isWater);
        } catch {
          // keep heuristic mode
        }
      }
      try {
        const path = await planSurfacePath(job, mode, routeFn, signal);
        return { path, mode, degraded: false };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        return {
          path: greatCirclePath(job.plan),
          mode: "synthetic",
          degraded: true,
        };
      }
    })();

    sharedCorridors.set(job.groupId, promise);
    return promise;
  };

  const pump = async () => {
    try {
      while (!aborted && cursor < ordered.length && active < concurrency) {
        throwIfAborted(signal);
        const job = ordered[cursor]!;
        cursor += 1;
        active += 1;
        void (async () => {
          try {
            if (aborted) return;
            throwIfAborted(signal);
            const corridor = await resolveSharedCorridor(job);
            throwIfAborted(signal);
            if (corridor.degraded || corridor.mode === "synthetic") {
              enqueue(
                buildSyntheticReady(
                  job,
                  startMs,
                  windowSeconds,
                  random,
                  idFactory,
                ),
              );
            } else {
              enqueue(
                buildRoutedTarget({
                  job,
                  path: corridor.path,
                  startMs,
                  windowSeconds,
                  random,
                  idFactory,
                  degraded: false,
                }),
              );
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              markAbort(error);
            } else if (!aborted) {
              enqueue(
                buildSyntheticReady(
                  job,
                  startMs,
                  windowSeconds,
                  random,
                  idFactory,
                ),
              );
            }
          } finally {
            active -= 1;
            if (aborted || (cursor >= ordered.length && active === 0)) {
              finished = true;
            }
            wake();
            if (!aborted) void pump().catch(markAbort);
          }
        })();
      }
    } catch (error) {
      markAbort(error);
    }
  };

  try {
    void pump();
    let yielded = 0;
    while (yielded < jobs.length) {
      throwIfAborted(signal);
      if (failure) throw failure;
      if (queue.length > 0) {
        const next = queue.shift()!;
        yielded += 1;
        yield next;
        continue;
      }
      if (finished && queue.length === 0) break;
      await new Promise<void>((resolve) => {
        queueWaiters.push(resolve);
      });
    }
    throwIfAborted(signal);
    if (failure) throw failure;
  } finally {
    if (
      ownedClient.current &&
      deps.disposeClient !== false &&
      deps.routeFn === undefined
    ) {
      ownedClient.current.terminate();
    }
  }
}

/**
 * Collect a full scenario from the streaming planner.
 * On abort: returns `{ cancelled: true }` with an empty scenario so callers
 * commit no partial writes.
 */
export async function planDemoScenario(
  now = Date.now(),
  random: () => number = Math.random,
  options: CreateDemoScenarioOptions = {},
  deps: PlanDemoScenarioDeps = {},
): Promise<CreateDemoScenarioResult> {
  if (options.seed !== undefined) {
    random = createSeededRandom(options.seed);
  }

  const createdAt = new Date(now).toISOString();
  // One shared factory for targets/events (iterator) and scenario id below.
  const idFactory = resolveIdFactory(options);
  const optionsWithIds: CreateDemoScenarioOptions = {
    ...options,
    idFactory,
  };
  const vehicleSelection = options.vehicleSelection ?? "random";

  const collected: DemoTargetReady[] = [];
  let cancelled = false;

  try {
    for await (const ready of iterateDemoTargets(
      now,
      random,
      optionsWithIds,
      deps,
    )) {
      collected.push(ready);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      cancelled = true;
    } else {
      throw error;
    }
  }

  if (cancelled) {
    // No partial writes: discard streamed targets on cancel.
    return {
      scenario: {
        schemaVersion: 2,
        id: idFactory(),
        name: "Cancelled demo",
        description: "Demo generation was cancelled.",
        createdAt,
        updatedAt: createdAt,
        priorityTerms: ["critical", "proximity threshold"],
        targets: [],
        events: [],
      },
      degradedTrackCount: 0,
      anywhereFallbackCount: 0,
      cancelled: true,
    };
  }

  collected.sort((a, b) => a.index - b.index);
  const targets = collected.map((entry) => entry.target);
  const events = collected.flatMap((entry) => entry.events);
  const degradedTrackCount = collected.filter((entry) => entry.degraded).length;
  const anywhereFallbackCount = collected.filter(
    (entry) => entry.anywhereFallback,
  ).length;

  const scenario: SimulationScenario = {
    schemaVersion: 2,
    id: idFactory(),
    name: demoName(vehicleSelection, targets.length),
    description: demoDescription(vehicleSelection, targets.length),
    createdAt,
    updatedAt: createdAt,
    priorityTerms: ["critical", "proximity threshold"],
    targets,
    events,
  };

  return {
    scenario,
    degradedTrackCount,
    anywhereFallbackCount,
    cancelled: false,
  };
}

export { resolveOtherRouteMode as classifyOtherRouteMode };
