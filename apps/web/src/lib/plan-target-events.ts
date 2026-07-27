/**
 * Single-target authentic route planning for the Compose Random events tab.
 * Reuses demo placement + routers; falls back to synthetic wander on failure.
 */

import geoSeeds from "../../public/geo-seeds.json";
import {
  clampDemoLatitude,
  resolveGroupPlacement,
  type DemoRegionSelection,
} from "@/lib/demo-scenario";
import { demoRegionById } from "@/lib/demo-regions";
import {
  categoryCruiseMidpointKnots,
  generateRouteEvents,
  MAX_GENERATED_EVENTS,
} from "@/lib/event-generator";
import {
  kinematicsFromProfile,
  planAirRoute,
  unpackGeoSeedsAerodromes,
  type Aerodrome,
  type GeoSeedsBundle,
} from "@/lib/geo/air-router";
import { createGeoRouterClient } from "@/lib/geo/geo-router-client";
import type { GeoRouterLngLat } from "@/lib/geo/geo-router-protocol";
import { pathToEvents, type PathPoint } from "@/lib/geo/path-to-events";
import { resolveVehicleProfile } from "@/lib/geo/vehicle-profiles";
import { destinationPoint } from "@/lib/position-telemetry";
import type { SimulationEvent, TargetDefinition, VehicleCategory } from "@/types/target";

const ROUTE_TIMEOUT_MS = 12_000;

function resolveRouteMode(
  category: VehicleCategory,
  regionId: string | null | undefined,
): "air" | "sea" | "road" {
  if (category === "aircraft") return "air";
  if (category === "boat") return "sea";
  if (category === "car" || category === "truck") return "road";
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

function resolveOtherRouteMode(isWater: boolean): "air" | "sea" | "road" {
  return isWater ? "sea" : "road";
}

export type PlanTargetRouteEventsOptions = {
  target: TargetDefinition;
  regions?: DemoRegionSelection;
  startAt: string;
  endAt?: string;
  eventCount: number;
  signal?: AbortSignal;
  random?: () => number;
  idFactory?: () => string;
  /** Test override for air aerodromes. */
  aerodromes?: readonly Aerodrome[];
  /** Test override for surface routing. */
  routeFn?: (args: {
    mode: "road" | "sea";
    origin: GeoRouterLngLat;
    destination: GeoRouterLngLat;
    options?: Record<string, unknown>;
    signal?: AbortSignal;
  }) => Promise<GeoRouterLngLat[]>;
  isWaterAt?: (
    longitude: number,
    latitude: number,
    signal?: AbortSignal,
  ) => Promise<boolean>;
};

export type PlanTargetRouteEventsResult = {
  events: SimulationEvent[];
  degraded: boolean;
  anywhereFallback: boolean;
  regionId: string | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Target route planning was cancelled.", "AbortError");
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
      reject(new DOMException("Target route planning was cancelled.", "AbortError"));
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

function loadDefaultAerodromes(): Aerodrome[] {
  const bundle = geoSeeds as unknown as GeoSeedsBundle;
  return unpackGeoSeedsAerodromes(bundle.aerodromes);
}

function syntheticFallback(options: {
  target: TargetDefinition;
  startAt: string;
  endAt: string | undefined;
  eventCount: number;
  startPoint: { latitude: number; longitude: number };
  idFactory: () => string;
  random: () => number;
}): SimulationEvent[] {
  const category = options.target.profile.vehicleCategory;
  return generateRouteEvents({
    targetId: options.target.id,
    count: options.eventCount,
    startAt: options.startAt,
    endAt: options.endAt,
    startPoint: {
      latitude: options.startPoint.latitude,
      longitude: options.startPoint.longitude,
      altitude: category === "aircraft" ? 8_000 : 0,
    },
    vehicleCategory: category,
    random: options.random,
    idFactory: options.idFactory,
  });
}

/**
 * Plan authentic geo events for an existing target in selected regions
 * (or anywhere). Falls back to synthetic wander when routing fails.
 */
export async function planTargetRouteEvents(
  options: PlanTargetRouteEventsOptions,
): Promise<PlanTargetRouteEventsResult> {
  const random = options.random ?? Math.random;
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const eventCount = clamp(Math.floor(options.eventCount), 1, MAX_GENERATED_EVENTS);
  const category = options.target.profile.vehicleCategory;
  const subtype = options.target.profile.vehicleSubtype;
  const regions = options.regions ?? "anywhere";

  throwIfAborted(options.signal);

  const placement = resolveGroupPlacement(category, null, regions, random, false);
  const startMs = Date.parse(options.startAt);
  if (!Number.isFinite(startMs)) {
    throw new Error("Enter a valid start time.");
  }

  let endAt = options.endAt?.trim() || undefined;
  if (endAt) {
    const endMs = Date.parse(endAt);
    if (!Number.isFinite(endMs) || endMs <= startMs) {
      throw new Error("End time must be after start time.");
    }
  } else {
    // Default ~1 hour window when omitted (demo-style optional end).
    endAt = new Date(startMs + 60 * 60_000).toISOString();
  }

  const endMs = Date.parse(endAt);
  const durationMinutes = Math.max(1, Math.floor((endMs - startMs) / 60_000));
  const cruise = categoryCruiseMidpointKnots(category);
  const durationHours = Math.max(durationMinutes / 60, 1 / 60);
  const maxNm = Math.max(2, cruise * durationHours * 0.72);
  const minNm = Math.min(4, maxNm * 0.35);
  const distanceNm = minNm + random() * Math.max(0, maxNm - minNm);
  const heading = random() * 360;
  const end = destinationPoint(placement.base, distanceNm, heading);
  const origin = {
    latitude: clampDemoLatitude(placement.base.latitude),
    longitude: placement.base.longitude,
  };
  const destination = {
    latitude: clampDemoLatitude(end.latitude),
    longitude: end.longitude,
  };

  let mode = resolveRouteMode(category, placement.regionId);
  if (category === "other" && options.isWaterAt) {
    try {
      const isWater = await options.isWaterAt(
        origin.longitude,
        origin.latitude,
        options.signal,
      );
      mode = resolveOtherRouteMode(isWater);
    } catch {
      // keep resolveRouteMode result
    }
  }

  const fallbackBase = {
    target: options.target,
    startAt: options.startAt,
    endAt,
    eventCount,
    startPoint: origin,
    idFactory,
    random,
  };

  try {
    throwIfAborted(options.signal);
    let path: PathPoint[];

    if (mode === "air") {
      const aerodromes = options.aerodromes ?? loadDefaultAerodromes();
      const profile = resolveVehicleProfile(category, subtype);
      const kinematics = kinematicsFromProfile(profile);
      const region = placement.regionId ? demoRegionById(placement.regionId) : undefined;
      const result = planAirRoute({
        aerodromes,
        bbox: region?.bbox,
        windowHours: durationHours,
        kinematics,
        random,
      });
      if (!result.ok) {
        throw new Error(result.message);
      }
      path = result.path;
    } else {
      const client = options.routeFn
        ? null
        : createGeoRouterClient();
      try {
        const routeFn =
          options.routeFn ??
          ((args: {
            mode: "road" | "sea";
            origin: GeoRouterLngLat;
            destination: GeoRouterLngLat;
            options?: Record<string, unknown>;
            signal?: AbortSignal;
          }) =>
            client!.route({
              mode: args.mode,
              origin: args.origin,
              destination: args.destination,
              options: args.options,
              signal: args.signal,
            }));

        const coordinates = await withTimeout(
          routeFn({
            mode,
            origin: { longitude: origin.longitude, latitude: origin.latitude },
            destination: {
              longitude: destination.longitude,
              latitude: destination.latitude,
            },
            signal: options.signal,
            options:
              mode === "road"
                ? { vehicle: category === "truck" ? "truck" : "car" }
                : undefined,
          }),
          ROUTE_TIMEOUT_MS,
          options.signal,
        );
        if (coordinates.length < 2) {
          throw new Error("Router returned an empty path.");
        }
        path = coordinates.map((point) => ({
          latitude: point.latitude,
          longitude: point.longitude,
          altitude: 0,
        }));
      } finally {
        client?.terminate();
      }
    }

    const events = pathToEvents({
      targetId: options.target.id,
      path,
      startAt: options.startAt,
      endAt,
      vehicleCategory: category,
      vehicleSubtype: subtype,
      eventCount,
      idFactory,
    });

    return {
      events,
      degraded: false,
      anywhereFallback: placement.anywhereFallback,
      regionId: placement.regionId,
    };
  } catch (error) {
    if (
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }
    return {
      events: syntheticFallback(fallbackBase),
      degraded: true,
      anywhereFallback: placement.anywhereFallback,
      regionId: placement.regionId,
    };
  }
}
