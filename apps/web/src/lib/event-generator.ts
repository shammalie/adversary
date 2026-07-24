import { destinationPoint } from "@/lib/position-telemetry";
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
  endAt: string;
  startPoint: PositionPayload;
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

/**
 * Builds a geodesic track where each leg's distance is speed × elapsed time.
 * Authored position.speed is always set so runtime does not invent speeds.
 */
export function generateRouteEvents(options: GenerateRouteOptions): SimulationEvent[] {
  const random = options.random ?? Math.random;
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const count = clamp(Math.floor(options.count), 1, MAX_GENERATED_EVENTS);
  const startMs = Date.parse(options.startAt);
  const endMs = Date.parse(options.endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("End time must be after start time.");
  }

  const timestamps = distributeTimestamps(startMs, endMs, count);
  let heading = random() * 360;
  let speed = sampleSpeed(options.vehicleCategory, random);
  let current = { ...options.startPoint };
  const events: SimulationEvent[] = [];

  for (let index = 0; index < count; index += 1) {
    if (index > 0) {
      const previousAt = timestamps[index - 1] ?? startMs;
      const currentAt = timestamps[index] ?? endMs;
      const elapsedHours = Math.max((currentAt - previousAt) / 3_600_000, 1 / 3600);
      speed = updateSpeed(options.vehicleCategory, speed, random);
      // Distance is strictly bounded by category speed and elapsed time.
      const distanceNm = speed * elapsedHours;
      const smoothing = CATEGORY_MOVEMENT_SMOOTHING[options.vehicleCategory];
      heading = (heading + (random() * 2 - 1) * smoothing.maxHeadingChange + 360) % 360;
      const nextPoint = destinationPoint(current, distanceNm, heading);
      current = {
        latitude: nextPoint.latitude,
        longitude: nextPoint.longitude,
        altitude: options.startPoint.altitude,
      };
    }

    events.push({
      id: idFactory(),
      targetId: options.targetId,
      at: new Date(timestamps[index] ?? startMs).toISOString(),
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

export function mergeGeneratedEvents(existing: SimulationEvent[], generated: SimulationEvent[]) {
  return [...existing, ...generated].toSorted(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id),
  );
}
