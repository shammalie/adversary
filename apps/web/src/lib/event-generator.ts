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
  /**
   * When set, every track point is clamped to ±this latitude. Near the bound,
   * headings curve inland gradually so contacts arc parallel instead of spiking.
   */
  maxAbsLatitude?: number;
  random?: () => number;
  idFactory?: () => string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHeading(heading: number) {
  return ((heading % 360) + 360) % 360;
}

function shortestHeadingDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

function clampLatitude(latitude: number, maxAbsLatitude?: number) {
  if (maxAbsLatitude === undefined) return latitude;
  const bound = Math.min(Math.abs(maxAbsLatitude), 90);
  return clamp(latitude, -bound, bound);
}

/** Soft band (degrees of latitude) where tracks start curving away from the clip. */
const LATITUDE_TURN_BUFFER_DEG = 5;

/**
 * Gradual equatorward steer near ±maxAbsLatitude so contacts arc parallel to the
 * bound instead of bouncing with a hard heading flip.
 */
function steerHeadingForLatitudeBound(
  latitude: number,
  heading: number,
  maxAbsLatitude: number | undefined,
  maxHeadingChange: number,
): number {
  if (maxAbsLatitude === undefined) return heading;
  const bound = Math.min(Math.abs(maxAbsLatitude), 90);
  const absLat = Math.abs(latitude);
  const bufferStart = bound - LATITUDE_TURN_BUFFER_DEG;
  if (absLat < bufferStart) return heading;

  const northComponent = Math.cos((heading * Math.PI) / 180);
  const headingTowardPole = latitude >= 0 ? northComponent > 0.02 : northComponent < -0.02;
  if (!headingTowardPole && absLat < bound) return heading;

  const urgency = clamp((absLat - bufferStart) / LATITUDE_TURN_BUFFER_DEG, 0, 1);
  // Prefer the nearer E/W parallel, then a bit equatorward for a rounded turn.
  const eastish = Math.sin((heading * Math.PI) / 180) >= 0;
  let target: number;
  if (latitude >= 0) {
    target = eastish ? 90 + 45 * urgency : 270 - 45 * urgency;
  } else {
    target = eastish ? 90 - 45 * urgency : 270 + 45 * urgency;
  }
  const delta = shortestHeadingDelta(heading, target);
  const maxTurn = maxHeadingChange * (0.75 + urgency * 1.25);
  return normalizeHeading(heading + clamp(delta, -maxTurn, maxTurn));
}

function applyLatitudeBound(
  point: Pick<PositionPayload, "latitude" | "longitude">,
  heading: number,
  maxAbsLatitude: number | undefined,
  maxHeadingChange: number,
): { point: Pick<PositionPayload, "latitude" | "longitude">; heading: number } {
  if (maxAbsLatitude === undefined) {
    return { point, heading };
  }
  const bound = Math.min(Math.abs(maxAbsLatitude), 90);
  if (Math.abs(point.latitude) <= bound) {
    return {
      point,
      heading: steerHeadingForLatitudeBound(
        point.latitude,
        heading,
        maxAbsLatitude,
        maxHeadingChange,
      ),
    };
  }
  // Overshot: clamp and continue a limited turn inland (no instantaneous 180° flip).
  const clamped = {
    latitude: clamp(point.latitude, -bound, bound),
    longitude: point.longitude,
  };
  return {
    point: clamped,
    heading: steerHeadingForLatitudeBound(
      clamped.latitude,
      heading,
      maxAbsLatitude,
      maxHeadingChange,
    ),
  };
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
  /** Override cruise; defaults to category midpoint. */
  cruiseKnots?: number;
}): string {
  const startMs = Date.parse(options.startAt);
  if (!Number.isFinite(startMs)) {
    throw new Error("Enter a valid start time.");
  }
  const distanceNm = haversineDistanceNm(options.startPoint, options.endPoint);
  if (distanceNm < 0.001) {
    throw new Error("End point must be distinct from the start point.");
  }
  const cruiseKnots =
    options.cruiseKnots !== undefined && Number.isFinite(options.cruiseKnots)
      ? options.cruiseKnots
      : categoryCruiseMidpointKnots(options.vehicleCategory);
  // Small slack so biased intermediate legs (heading noise) still fit under max speed.
  const durationMs = Math.max((distanceNm / Math.max(cruiseKnots, 0.1)) * 3_600_000 * 1.08, 1_000);
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
  maxAbsLatitude?: number;
  random: () => number;
  idFactory: () => string;
}): SimulationEvent[] {
  const timestamps = distributeTimestamps(options.startMs, options.endMs, options.count);
  let heading = options.random() * 360;
  let speed = sampleSpeed(options.vehicleCategory, options.random);
  let current: PositionPayload = {
    ...options.startPoint,
    latitude: clampLatitude(options.startPoint.latitude, options.maxAbsLatitude),
  };
  const events: SimulationEvent[] = [];

  for (let index = 0; index < options.count; index += 1) {
    if (index > 0) {
      const previousAt = timestamps[index - 1] ?? options.startMs;
      const currentAt = timestamps[index] ?? options.endMs;
      const elapsedHours = Math.max((currentAt - previousAt) / 3_600_000, 1 / 3600);
      speed = updateSpeed(options.vehicleCategory, speed, options.random);
      const distanceNm = speed * elapsedHours;
      const smoothing = CATEGORY_MOVEMENT_SMOOTHING[options.vehicleCategory];
      heading = normalizeHeading(
        heading + (options.random() * 2 - 1) * smoothing.maxHeadingChange,
      );
      heading = steerHeadingForLatitudeBound(
        current.latitude,
        heading,
        options.maxAbsLatitude,
        smoothing.maxHeadingChange,
      );
      const nextPoint = destinationPoint(current, distanceNm, heading);
      const bounded = applyLatitudeBound(
        nextPoint,
        heading,
        options.maxAbsLatitude,
        smoothing.maxHeadingChange,
      );
      heading = bounded.heading;
      current = {
        latitude: bounded.point.latitude,
        longitude: bounded.point.longitude,
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
  maxAbsLatitude?: number;
  random: () => number;
  idFactory: () => string;
}): SimulationEvent[] {
  const startPoint: PositionPayload = {
    ...options.startPoint,
    latitude: clampLatitude(options.startPoint.latitude, options.maxAbsLatitude),
  };
  const endPoint: PositionPayload = {
    ...options.endPoint,
    latitude: clampLatitude(options.endPoint.latitude, options.maxAbsLatitude),
  };

  assertFeasibleEndWindow({
    startMs: options.startMs,
    endMs: options.endMs,
    startPoint,
    endPoint,
    vehicleCategory: options.vehicleCategory,
  });

  const timestamps = distributeTimestamps(options.startMs, options.endMs, options.count);
  const range = CATEGORY_SPEED_RANGES[options.vehicleCategory];
  const smoothing = CATEGORY_MOVEMENT_SMOOTHING[options.vehicleCategory];
  const totalNm = haversineDistanceNm(startPoint, endPoint);
  const totalHours = Math.max((options.endMs - options.startMs) / 3_600_000, 1 / 3600);
  // Seed near schedule pace (distance / window) so early legs don't burn the route.
  let speed = clamp(totalNm / totalHours, range.minKnots, range.maxKnots);
  let current: PositionPayload = { ...startPoint };
  const events: SimulationEvent[] = [];
  const lastIndex = options.count - 1;
  /** Treat as arrived — avoid emitting parked duplicates for leftover timestamps. */
  const arrivalEpsilonNm = 0.05;

  for (let index = 0; index < options.count; index += 1) {
    const progress = lastIndex === 0 ? 1 : index / lastIndex;
    const altitude = lerpAltitude(startPoint.altitude, endPoint.altitude, progress);

    if (index === 0) {
      events.push({
        id: options.idFactory(),
        targetId: options.targetId,
        at: new Date(timestamps[0] ?? options.startMs).toISOString(),
        position: {
          latitude: Number(startPoint.latitude.toFixed(6)),
          longitude: Number(startPoint.longitude.toFixed(6)),
          altitude,
          speed: Number(speed.toFixed(1)),
        },
      });
      continue;
    }

    const previousAt = timestamps[index - 1] ?? options.startMs;
    const currentAt = timestamps[index] ?? options.endMs;
    const elapsedHours = Math.max((currentAt - previousAt) / 3_600_000, 1 / 3600);
    const remainingNm = haversineDistanceNm(current, endPoint);

    if (index === lastIndex || remainingNm <= arrivalEpsilonNm) {
      const distanceNm = haversineDistanceNm(current, endPoint);
      const geometricSpeed = distanceNm / elapsedHours;
      if (geometricSpeed > range.maxKnots + 1) {
        throw new Error(
          `Final leg requires ${geometricSpeed.toFixed(0)} kt, above the ${options.vehicleCategory} maximum of ${range.maxKnots} kt.`,
        );
      }
      speed = clamp(geometricSpeed, 0, range.maxKnots);
      current = {
        latitude: endPoint.latitude,
        longitude: endPoint.longitude,
        altitude: endPoint.altitude ?? altitude,
      };
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
      // Drop leftover timestamps after arrival — no parked zero-speed tail.
      break;
    }

    const hoursLeftFromPrev = Math.max((options.endMs - previousAt) / 3_600_000, 1 / 3600);
    const hoursLeftAfter = Math.max((options.endMs - currentAt) / 3_600_000, 1 / 3600);
    // Time-proportional slice of remaining distance (pace to arrive at endAt, not early).
    const idealStepNm = remainingNm * (elapsedHours / hoursLeftFromPrev);
    const maxLeaveNm = range.maxKnots * hoursLeftAfter;
    const minStepNm = Math.max(0, remainingNm - maxLeaveNm);
    const maxStepNm = Math.max(0, remainingNm - arrivalEpsilonNm);

    const noise = (options.random() * 2 - 1) * smoothing.maxSpeedChangeFraction;
    let distanceNm = clamp(idealStepNm * (1 + noise), minStepNm, maxStepNm);
    speed = clamp(distanceNm / elapsedHours, 0, range.maxKnots);
    // Allow below category min when the authored window is longer than cruise —
    // otherwise minKnots would force early arrival and idle padding.
    distanceNm = Math.min(speed * elapsedHours, maxStepNm);

    const desiredBearing = initialBearingDegrees(current, endPoint);
    let heading = normalizeHeading(
      desiredBearing + (options.random() * 2 - 1) * smoothing.maxHeadingChange,
    );
    heading = steerHeadingForLatitudeBound(
      current.latitude,
      heading,
      options.maxAbsLatitude,
      smoothing.maxHeadingChange,
    );
    let nextPoint = destinationPoint(current, distanceNm, heading);
    if (remainingNm - haversineDistanceNm(nextPoint, endPoint) < distanceNm * 0.5) {
      heading = steerHeadingForLatitudeBound(
        current.latitude,
        desiredBearing,
        options.maxAbsLatitude,
        smoothing.maxHeadingChange,
      );
      nextPoint = destinationPoint(current, distanceNm, heading);
    }
    const bounded = applyLatitudeBound(
      nextPoint,
      heading,
      options.maxAbsLatitude,
      smoothing.maxHeadingChange,
    );
    speed = clamp(haversineDistanceNm(current, bounded.point) / elapsedHours, 0, range.maxKnots);
    current = {
      latitude: bounded.point.latitude,
      longitude: bounded.point.longitude,
      altitude,
    };

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
 * With `endPoint`, intermediates bias toward the destination and the final event snaps exactly there.
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
      maxAbsLatitude: options.maxAbsLatitude,
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
    maxAbsLatitude: options.maxAbsLatitude,
    random,
    idFactory,
  });
}

export function mergeGeneratedEvents(existing: SimulationEvent[], generated: SimulationEvent[]) {
  return [...existing, ...generated].toSorted(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id),
  );
}
