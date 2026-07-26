import {
  destinationPoint,
  haversineDistanceNm,
  initialBearingDegrees,
} from "@/lib/position-telemetry";
import {
  CATEGORY_SPEED_RANGES,
  type SpeedRange,
} from "@/lib/vehicle-speed";
import type { PositionPayload, SimulationEvent, VehicleCategory } from "@/types/target";

export { CATEGORY_SPEED_RANGES, CATEGORY_TOP_SPEED_KNOTS } from "@/lib/vehicle-speed";
export type { SpeedRange };

export const MAX_GENERATED_EVENTS = 500;

interface MovementSmoothing {
  maxHeadingChange: number;
  maxSpeedChangeFraction: number;
}

const CATEGORY_MOVEMENT_SMOOTHING: Record<VehicleCategory, MovementSmoothing> = {
  aircraft: { maxHeadingChange: 4, maxSpeedChangeFraction: 0.06 },
  boat: { maxHeadingChange: 7, maxSpeedChangeFraction: 0.08 },
  car: { maxHeadingChange: 14, maxSpeedChangeFraction: 0.16 },
  truck: { maxHeadingChange: 12, maxSpeedChangeFraction: 0.12 },
  other: { maxHeadingChange: 15, maxSpeedChangeFraction: 0.18 },
};

export interface GenerateRouteOptions {
  targetId: string;
  count: number;
  startAt: string;
  /** Required when `endPoint` is omitted. Optional when `endPoint` is set (auto from cruise midpoint). */
  endAt?: string;
  startPoint: PositionPayload;
  /** Aircraft A→B destination. When set, intermediates bias toward this point and the final event snaps here. */
  endPoint?: PositionPayload;
  vehicleCategory: VehicleCategory;
  random?: () => number;
  idFactory?: () => string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sampleSpeed(category: VehicleCategory, random: () => number) {
  const range = CATEGORY_SPEED_RANGES[category];
  return range.minKnots + random() * (range.maxKnots - range.minKnots);
}

function updateSpeed(category: VehicleCategory, previous: number, random: () => number) {
  const range = CATEGORY_SPEED_RANGES[category];
  const smoothing = CATEGORY_MOVEMENT_SMOOTHING[category];
  const maximumChange = (range.maxKnots - range.minKnots) * smoothing.maxSpeedChangeFraction;
  const change = (random() * 2 - 1) * maximumChange;
  return clamp(previous + change, range.minKnots, range.maxKnots);
}

function distributeTimestamps(startMs: number, endMs: number, count: number) {
  if (count <= 1) return [startMs];
  const span = Math.max(endMs - startMs, 1);
  return Array.from({ length: count }, (_, index) =>
    Math.round(startMs + (span * index) / (count - 1)),
  );
}

/** Deterministic cruise used when end time is derived from distance. */
export function categoryCruiseMidpointKnots(category: VehicleCategory) {
  const range = CATEGORY_SPEED_RANGES[category];
  return (range.minKnots + range.maxKnots) / 2;
}

export function deriveEndAtFromDistance(options: {
  startAt: string;
  startPoint: Pick<PositionPayload, "latitude" | "longitude">;
  endPoint: Pick<PositionPayload, "latitude" | "longitude">;
  vehicleCategory: VehicleCategory;
}): string {
  const startMs = Date.parse(options.startAt);
  if (!Number.isFinite(startMs)) {
    throw new Error("Enter a valid start time.");
  }
  const distanceNm = haversineDistanceNm(options.startPoint, options.endPoint);
  if (distanceNm < 0.001) {
    throw new Error("End point must be distinct from the start point.");
  }
  const cruiseKnots = categoryCruiseMidpointKnots(options.vehicleCategory);
  // Small slack so biased intermediate legs (heading noise) still fit under max speed.
  const durationMs = Math.max((distanceNm / cruiseKnots) * 3_600_000 * 1.08, 1_000);
  return new Date(startMs + durationMs).toISOString();
}

export function resolveRouteEndAt(options: {
  startAt: string;
  endAt?: string;
  startPoint: Pick<PositionPayload, "latitude" | "longitude">;
  endPoint?: Pick<PositionPayload, "latitude" | "longitude">;
  vehicleCategory: VehicleCategory;
}): string {
  const authored = options.endAt?.trim();
  if (authored) return authored;
  if (!options.endPoint) {
    throw new Error("End time must be after start time.");
  }
  return deriveEndAtFromDistance({
    startAt: options.startAt,
    startPoint: options.startPoint,
    endPoint: options.endPoint,
    vehicleCategory: options.vehicleCategory,
  });
}

function assertFeasibleEndWindow(options: {
  startMs: number;
  endMs: number;
  startPoint: Pick<PositionPayload, "latitude" | "longitude">;
  endPoint: Pick<PositionPayload, "latitude" | "longitude">;
  vehicleCategory: VehicleCategory;
}) {
  if (options.endMs <= options.startMs) {
    throw new Error("End time must be after start time.");
  }
  const distanceNm = haversineDistanceNm(options.startPoint, options.endPoint);
  if (distanceNm < 0.001) {
    throw new Error("End point must be distinct from the start point.");
  }
  const elapsedHours = (options.endMs - options.startMs) / 3_600_000;
  const requiredKnots = distanceNm / elapsedHours;
  const maxKnots = CATEGORY_SPEED_RANGES[options.vehicleCategory].maxKnots;
  if (requiredKnots > maxKnots) {
    throw new Error(
      `Route requires about ${requiredKnots.toFixed(0)} kt average, above the ${options.vehicleCategory} maximum of ${maxKnots} kt. Use a later end time or a shorter distance.`,
    );
  }
}

function lerpAltitude(
  startAltitude: number | undefined,
  endAltitude: number | undefined,
  progress: number,
) {
  const from = startAltitude ?? 0;
  const to = endAltitude ?? from;
  return from + (to - from) * progress;
}

function generateWanderEvents(options: {
  targetId: string;
  count: number;
  startMs: number;
  endMs: number;
  startPoint: PositionPayload;
  vehicleCategory: VehicleCategory;
  random: () => number;
  idFactory: () => string;
}): SimulationEvent[] {
  const timestamps = distributeTimestamps(options.startMs, options.endMs, options.count);
  let heading = options.random() * 360;
  let speed = sampleSpeed(options.vehicleCategory, options.random);
  let current = { ...options.startPoint };
  const events: SimulationEvent[] = [];

  for (let index = 0; index < options.count; index += 1) {
    if (index > 0) {
      const previousAt = timestamps[index - 1] ?? options.startMs;
      const currentAt = timestamps[index] ?? options.endMs;
      const elapsedHours = Math.max((currentAt - previousAt) / 3_600_000, 1 / 3600);
      speed = updateSpeed(options.vehicleCategory, speed, options.random);
      const distanceNm = speed * elapsedHours;
      const smoothing = CATEGORY_MOVEMENT_SMOOTHING[options.vehicleCategory];
      heading = (heading + (options.random() * 2 - 1) * smoothing.maxHeadingChange + 360) % 360;
      const nextPoint = destinationPoint(current, distanceNm, heading);
      current = {
        latitude: nextPoint.latitude,
        longitude: nextPoint.longitude,
        altitude: options.startPoint.altitude,
      };
    }

    events.push({
      id: options.idFactory(),
      targetId: options.targetId,
      at: new Date(timestamps[index] ?? options.startMs).toISOString(),
      position: {
        latitude: Number(current.latitude.toFixed(6)),
        longitude: Number(current.longitude.toFixed(6)),
        altitude: current.altitude,
        speed: Number(speed.toFixed(1)),
      },
    });
  }

  return events;
}

function generatePointToPointEvents(options: {
  targetId: string;
  count: number;
  startMs: number;
  endMs: number;
  startPoint: PositionPayload;
  endPoint: PositionPayload;
  vehicleCategory: VehicleCategory;
  random: () => number;
  idFactory: () => string;
}): SimulationEvent[] {
  assertFeasibleEndWindow({
    startMs: options.startMs,
    endMs: options.endMs,
    startPoint: options.startPoint,
    endPoint: options.endPoint,
    vehicleCategory: options.vehicleCategory,
  });

  const timestamps = distributeTimestamps(options.startMs, options.endMs, options.count);
  const range = CATEGORY_SPEED_RANGES[options.vehicleCategory];
  const smoothing = CATEGORY_MOVEMENT_SMOOTHING[options.vehicleCategory];
  let speed = sampleSpeed(options.vehicleCategory, options.random);
  let current: PositionPayload = { ...options.startPoint };
  const events: SimulationEvent[] = [];
  const lastIndex = options.count - 1;

  for (let index = 0; index < options.count; index += 1) {
    const progress = lastIndex === 0 ? 1 : index / lastIndex;
    const altitude = lerpAltitude(
      options.startPoint.altitude,
      options.endPoint.altitude,
      progress,
    );

    if (index === 0) {
      events.push({
        id: options.idFactory(),
        targetId: options.targetId,
        at: new Date(timestamps[0] ?? options.startMs).toISOString(),
        position: {
          latitude: Number(options.startPoint.latitude.toFixed(6)),
          longitude: Number(options.startPoint.longitude.toFixed(6)),
          altitude,
          speed: Number(speed.toFixed(1)),
        },
      });
      continue;
    }

    const previousAt = timestamps[index - 1] ?? options.startMs;
    const currentAt = timestamps[index] ?? options.endMs;
    const elapsedHours = Math.max((currentAt - previousAt) / 3_600_000, 1 / 3600);

    if (index === lastIndex) {
      const distanceNm = haversineDistanceNm(current, options.endPoint);
      const geometricSpeed = distanceNm / elapsedHours;
      if (geometricSpeed > range.maxKnots + 1) {
        throw new Error(
          `Final leg requires ${geometricSpeed.toFixed(0)} kt, above the ${options.vehicleCategory} maximum of ${range.maxKnots} kt.`,
        );
      }
      speed = clamp(geometricSpeed, 0, range.maxKnots);
      current = {
        latitude: options.endPoint.latitude,
        longitude: options.endPoint.longitude,
        altitude: options.endPoint.altitude ?? altitude,
      };
    } else {
      const remainingNm = haversineDistanceNm(current, options.endPoint);
      const desiredBearing = initialBearingDegrees(current, options.endPoint);
      const hoursLeftAfter = Math.max((options.endMs - currentAt) / 3_600_000, 1 / 3600);
      const maxLeaveNm = range.maxKnots * hoursLeftAfter;
      const minStepNm = Math.max(0, remainingNm - maxLeaveNm);
      const minSpeedForReserve = minStepNm / elapsedHours;

      speed = updateSpeed(options.vehicleCategory, speed, options.random);
      speed = clamp(Math.max(speed, minSpeedForReserve), range.minKnots, range.maxKnots);

      // Keep distance = speed × Δt. Bias heading to the destination with light noise;
      // fall back to true azimuth when the noisy step would stall closing.
      const distanceNm = Math.min(speed * elapsedHours, Math.max(remainingNm - 1e-6, 0));
      let heading =
        (desiredBearing + (options.random() * 2 - 1) * smoothing.maxHeadingChange + 360) % 360;
      let nextPoint = destinationPoint(current, distanceNm, heading);
      if (remainingNm - haversineDistanceNm(nextPoint, options.endPoint) < distanceNm * 0.5) {
        heading = desiredBearing;
        nextPoint = destinationPoint(current, distanceNm, heading);
      }
      speed = clamp(haversineDistanceNm(current, nextPoint) / elapsedHours, 0, range.maxKnots);
      current = {
        latitude: nextPoint.latitude,
        longitude: nextPoint.longitude,
        altitude,
      };
    }

    events.push({
      id: options.idFactory(),
      targetId: options.targetId,
      at: new Date(timestamps[index] ?? options.startMs).toISOString(),
      position: {
        latitude: Number(current.latitude.toFixed(6)),
        longitude: Number(current.longitude.toFixed(6)),
        altitude: Number((current.altitude ?? altitude).toFixed(1)),
        speed: Number(speed.toFixed(1)),
      },
    });
  }

  return events;
}

/**
 * Builds a geodesic track where each leg's distance is speed × elapsed time.
 * Authored position.speed is always set so runtime does not invent speeds.
 * With `endPoint`, intermediates bias toward the destination and the last event snaps exactly there.
 */
export function generateRouteEvents(options: GenerateRouteOptions): SimulationEvent[] {
  const random = options.random ?? Math.random;
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const count = clamp(Math.floor(options.count), 1, MAX_GENERATED_EVENTS);
  const startMs = Date.parse(options.startAt);
  if (!Number.isFinite(startMs)) {
    throw new Error("Enter a valid start time.");
  }

  const endAt = resolveRouteEndAt({
    startAt: options.startAt,
    endAt: options.endAt,
    startPoint: options.startPoint,
    endPoint: options.endPoint,
    vehicleCategory: options.vehicleCategory,
  });
  const endMs = Date.parse(endAt);
  if (!Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("End time must be after start time.");
  }

  if (options.endPoint) {
    return generatePointToPointEvents({
      targetId: options.targetId,
      count,
      startMs,
      endMs,
      startPoint: options.startPoint,
      endPoint: options.endPoint,
      vehicleCategory: options.vehicleCategory,
      random,
      idFactory,
    });
  }

  return generateWanderEvents({
    targetId: options.targetId,
    count,
    startMs,
    endMs,
    startPoint: options.startPoint,
    vehicleCategory: options.vehicleCategory,
    random,
    idFactory,
  });
}

export function mergeGeneratedEvents(existing: SimulationEvent[], generated: SimulationEvent[]) {
  return [...existing, ...generated].toSorted(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id),
  );
}
