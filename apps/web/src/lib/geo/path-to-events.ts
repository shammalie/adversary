import {
  destinationPoint,
  haversineDistanceNm,
  initialBearingDegrees,
} from "@/lib/position-telemetry";
import { CATEGORY_TOP_SPEED_KNOTS } from "@/lib/vehicle-speed";
import { MAX_GENERATED_EVENTS } from "@/lib/event-generator";
import {
  profileCruiseMidpointKnots,
  resolveVehicleProfile,
  type VehicleProfile,
} from "@/lib/geo/vehicle-profiles";
import type { PositionPayload, SimulationEvent, VehicleCategory } from "@/types/target";

/** Soft lower bound for simplified tracks on long routes. */
export const PATH_EVENT_BUDGET_MIN = 60;
/** Soft upper bound for simplified tracks. */
export const PATH_EVENT_BUDGET_MAX = 150;

const NM_TO_M = 1_852;
const METERS_PER_DEG_LAT = 111_320;
const MIN_SEGMENT_NM = 1e-6;
/** Floor on turn slowdown so vehicles never crawl to a stop at a vertex. */
const TURN_SPEED_FLOOR = 0.35;

export interface PathPoint {
  latitude: number;
  longitude: number;
  altitude?: number;
}

export interface PathToEventsOptions {
  targetId: string;
  /** Routed polyline in travel order (at least two distinct points). */
  path: readonly PathPoint[];
  startAt: string;
  /** When omitted, duration is derived from path length / cruise. */
  endAt?: string;
  vehicleCategory: VehicleCategory;
  vehicleSubtype?: string;
  /** Override cruise; defaults to profile cruise midpoint. */
  cruiseKnots?: number;
  idFactory?: () => string;
  /**
   * When set, clamp to `1..MAX_GENERATED_EVENTS` and use as the simplify/densify
   * target instead of the default 60–150 band.
   */
  eventCount?: number;
  /**
   * When true and the authored window is longer than the kinematic walk,
   * stretch timestamps to fill the window. Default true.
   */
  retimeToWindow?: boolean;
}

interface WalkedPoint {
  latitude: number;
  longitude: number;
  altitude: number;
  /** Instantaneous speed at this vertex (knots). */
  speedKnots: number;
  cumulativeNm: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shortestHeadingDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

function toLocalMeters(
  point: Pick<PathPoint, "latitude" | "longitude">,
  lat0: number,
) {
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  return {
    x: point.longitude * METERS_PER_DEG_LAT * cosLat,
    y: point.latitude * METERS_PER_DEG_LAT,
  };
}

/**
 * Perpendicular distance from `point` to segment `a`→`b`, in metres.
 * Equirectangular projection centred on the segment — fine for DP budgets.
 */
export function perpendicularDistanceMeters(
  point: Pick<PathPoint, "latitude" | "longitude">,
  a: Pick<PathPoint, "latitude" | "longitude">,
  b: Pick<PathPoint, "latitude" | "longitude">,
): number {
  const lat0 = (a.latitude + b.latitude) / 2;
  const p = toLocalMeters(point, lat0);
  const pa = toLocalMeters(a, lat0);
  const pb = toLocalMeters(b, lat0);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-6) {
    const ex = p.x - pa.x;
    const ey = p.y - pa.y;
    return Math.hypot(ex, ey);
  }
  let t = ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / lengthSq;
  t = clamp(t, 0, 1);
  const projX = pa.x + t * dx;
  const projY = pa.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Douglas-Peucker simplification by perpendicular distance in metres.
 * Always retains the first and last vertices.
 */
export function douglasPeuckerSimplify<T extends PathPoint>(
  points: readonly T[],
  toleranceM: number,
): T[] {
  if (points.length <= 2) return [...points];

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIndex = start;
    const a = points[start]!;
    const b = points[end]!;
    for (let i = start + 1; i < end; i += 1) {
      const dist = perpendicularDistanceMeters(points[i]!, a, b);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }
    if (maxDist > toleranceM && maxIndex > start && maxIndex < end) {
      keep[maxIndex] = 1;
      if (maxIndex - start > 1) stack.push([start, maxIndex]);
      if (end - maxIndex > 1) stack.push([maxIndex, end]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

/**
 * Binary-search a metre tolerance so the simplified polyline lands in
 * [PATH_EVENT_BUDGET_MIN, PATH_EVENT_BUDGET_MAX] when the input is long enough.
 * Short inputs are returned as-is (never padded).
 */
export function simplifyToEventBudget<T extends PathPoint>(
  points: readonly T[],
  minCount: number = PATH_EVENT_BUDGET_MIN,
  maxCount: number = PATH_EVENT_BUDGET_MAX,
): T[] {
  if (points.length <= 2) return [...points];

  if (points.length <= maxCount) {
    // Drop near-collinear vertices; never invent points to reach minCount.
    const lightly = douglasPeuckerSimplify(points, 1);
    return lightly.length >= 2 ? lightly : [...points];
  }

  // Find the smallest tolerance that yields ≤ maxCount (keeps the most corners).
  let lo = 0;
  let hi = 50_000;
  let best = douglasPeuckerSimplify(points, hi);
  for (let iter = 0; iter < 28; iter += 1) {
    const mid = (lo + hi) / 2;
    const simplified = douglasPeuckerSimplify(points, mid);
    if (simplified.length > maxCount) {
      lo = mid;
    } else {
      hi = mid;
      best = simplified;
    }
  }

  // If we dropped below minCount, tighten tolerance to recover detail.
  if (best.length < minCount) {
    let recoverLo = 0;
    let recoverHi = hi;
    for (let iter = 0; iter < 24; iter += 1) {
      const mid = (recoverLo + recoverHi) / 2;
      const simplified = douglasPeuckerSimplify(points, mid);
      if (simplified.length < minCount) {
        recoverHi = mid;
      } else if (simplified.length > maxCount) {
        recoverLo = mid;
      } else {
        recoverHi = mid;
        best = simplified;
      }
    }
  }

  if (best.length > maxCount) {
    let grow = Math.max(hi, 1);
    while (best.length > maxCount && grow < 1e7) {
      grow *= 1.5;
      best = douglasPeuckerSimplify(points, grow);
    }
  }

  return best;
}

/**
 * Evenly sample along a polyline by cumulative distance so short/collinear
 * routes still produce enough events for altitude profiles and the budget floor.
 */
export function densifyAlongPath<T extends PathPoint>(
  points: readonly T[],
  targetCount: number,
): Array<T & PathPoint> {
  if (points.length === 0) return [];
  if (points.length === 1 || targetCount <= points.length) return [...points];

  const distances: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    distances.push(distances[i - 1]! + haversineDistanceNm(points[i - 1]!, points[i]!));
  }
  const total = distances[distances.length - 1] ?? 0;
  if (total < MIN_SEGMENT_NM) return [...points];

  const out: Array<T & PathPoint> = [];
  for (let i = 0; i < targetCount; i += 1) {
    if (i === 0) {
      out.push({ ...points[0]! });
      continue;
    }
    if (i === targetCount - 1) {
      out.push({ ...points[points.length - 1]! });
      continue;
    }
    const targetDist = (total * i) / (targetCount - 1);
    let seg = 1;
    while (seg < distances.length - 1 && distances[seg]! < targetDist) seg += 1;
    const prev = points[seg - 1]!;
    const next = points[seg]!;
    const segStart = distances[seg - 1]!;
    const segEnd = distances[seg]!;
    const span = Math.max(segEnd - segStart, MIN_SEGMENT_NM);
    const t = clamp((targetDist - segStart) / span, 0, 1);
    const bearing = initialBearingDegrees(prev, next);
    const stepNm = haversineDistanceNm(prev, next) * t;
    const placed =
      stepNm < MIN_SEGMENT_NM
        ? { latitude: prev.latitude, longitude: prev.longitude }
        : destinationPoint(prev, stepNm, bearing);
    out.push({
      ...prev,
      latitude: placed.latitude,
      longitude: placed.longitude,
    });
  }
  return out;
}

function pathLengthNm(path: readonly PathPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += haversineDistanceNm(path[i - 1]!, path[i]!);
  }
  return total;
}

function turnSpeedFactor(turnAngleDeg: number): number {
  const abs = Math.abs(turnAngleDeg);
  if (abs < 1) return 1;
  // Full slowdown toward the floor by ~90° of heading change.
  return 1 - (1 - TURN_SPEED_FLOOR) * Math.min(1, abs / 90);
}

/**
 * Cap speed by turn radius: v ≈ √(a · R) with a modest lateral accel.
 * Aircraft radii are large so this rarely binds; road vehicles feel corners.
 */
function turnRadiusSpeedCapKnots(turnRadiusM: number, turnAngleDeg: number): number {
  if (Math.abs(turnAngleDeg) < 2) return Number.POSITIVE_INFINITY;
  const lateralAccel = 2.5; // m/s² — conservative for mixed platforms
  const maxMs = Math.sqrt(lateralAccel * Math.max(turnRadiusM, 1));
  return (maxMs * 3_600) / NM_TO_M;
}

function categoryCeilingKnots(category: VehicleCategory, profile: VehicleProfile): number {
  return Math.min(profile.maxKnots, CATEGORY_TOP_SPEED_KNOTS[category]);
}

/**
 * Assert the path can be flown/driven inside the window without exceeding the
 * category/platform ceiling — same contract as assertFeasibleEndWindow, but on
 * routed path length rather than the geodesic chord.
 */
export function assertFeasiblePathWindow(options: {
  startMs: number;
  endMs: number;
  pathLengthNm: number;
  vehicleCategory: VehicleCategory;
  maxKnots: number;
}) {
  if (options.endMs <= options.startMs) {
    throw new Error("End time must be after start time.");
  }
  if (options.pathLengthNm < 0.001) {
    throw new Error("Path must have positive length.");
  }
  const elapsedHours = (options.endMs - options.startMs) / 3_600_000;
  const requiredKnots = options.pathLengthNm / elapsedHours;
  if (requiredKnots > options.maxKnots + 1e-6) {
    throw new Error(
      `Route requires about ${requiredKnots.toFixed(0)} kt average, above the ${options.vehicleCategory} maximum of ${options.maxKnots} kt. Use a later end time or a shorter distance.`,
    );
  }
}

function altitudeAlongPath(options: {
  distanceNm: number;
  totalNm: number;
  profile: VehicleProfile;
  cruiseKnots: number;
  startAltitude: number;
  endAltitude: number;
}): number {
  const { profile, cruiseKnots, totalNm, distanceNm, startAltitude, endAltitude } = options;
  if (profile.climbRateFtPerMin <= 0 && profile.descentRateFtPerMin <= 0) {
    if (totalNm < MIN_SEGMENT_NM) return startAltitude;
    return startAltitude + (endAltitude - startAltitude) * (distanceNm / totalNm);
  }

  const cruiseAlt = profile.typicalFlightLevelFt;
  const climbFt = Math.max(0, cruiseAlt - startAltitude);
  const descentFt = Math.max(0, cruiseAlt - endAltitude);
  const climbHours = profile.climbRateFtPerMin > 0 ? climbFt / profile.climbRateFtPerMin / 60 : 0;
  const descentHours =
    profile.descentRateFtPerMin > 0 ? descentFt / profile.descentRateFtPerMin / 60 : 0;
  let climbNm = climbHours * cruiseKnots;
  let descentNm = descentHours * cruiseKnots;

  // If the path is too short for a full climb+descent, scale the phases.
  if (climbNm + descentNm > totalNm && totalNm > MIN_SEGMENT_NM) {
    const scale = totalNm / (climbNm + descentNm);
    climbNm *= scale;
    descentNm *= scale;
  }

  const cruiseStart = climbNm;
  const cruiseEnd = Math.max(cruiseStart, totalNm - descentNm);

  if (distanceNm <= cruiseStart && climbNm > MIN_SEGMENT_NM) {
    const t = distanceNm / climbNm;
    return startAltitude + (cruiseAlt - startAltitude) * t;
  }
  if (distanceNm >= cruiseEnd && descentNm > MIN_SEGMENT_NM) {
    const t = (distanceNm - cruiseEnd) / descentNm;
    return cruiseAlt + (endAltitude - cruiseAlt) * t;
  }
  if (distanceNm < cruiseStart) {
    return startAltitude + (cruiseAlt - startAltitude) * (distanceNm / Math.max(climbNm, MIN_SEGMENT_NM));
  }
  if (distanceNm > cruiseEnd) {
    return cruiseAlt + (endAltitude - cruiseAlt) * ((distanceNm - cruiseEnd) / Math.max(descentNm, MIN_SEGMENT_NM));
  }
  return cruiseAlt;
}

function dedupePath(path: readonly PathPoint[]): PathPoint[] {
  const out: PathPoint[] = [];
  for (const point of path) {
    const prev = out[out.length - 1];
    if (
      prev &&
      Math.abs(prev.latitude - point.latitude) < 1e-9 &&
      Math.abs(prev.longitude - point.longitude) < 1e-9
    ) {
      continue;
    }
    out.push({
      latitude: point.latitude,
      longitude: point.longitude,
      altitude: point.altitude,
    });
  }
  return out;
}

function walkPath(options: {
  path: readonly PathPoint[];
  profile: VehicleProfile;
  cruiseKnots: number;
  ceilingKnots: number;
}): WalkedPoint[] {
  const { path, profile, cruiseKnots, ceilingKnots } = options;
  const bearings: number[] = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    bearings.push(initialBearingDegrees(path[i]!, path[i + 1]!));
  }

  const walked: WalkedPoint[] = [];
  let cumulativeNm = 0;

  for (let i = 0; i < path.length; i += 1) {
    const point = path[i]!;
    let turnDeg = 0;
    if (i > 0 && i < path.length - 1) {
      turnDeg = shortestHeadingDelta(bearings[i - 1]!, bearings[i]!);
    }
    const factor = turnSpeedFactor(turnDeg);
    const radiusCap = turnRadiusSpeedCapKnots(profile.turnRadiusM, turnDeg);
    const speedKnots = clamp(
      Math.min(cruiseKnots * factor, radiusCap),
      Math.min(profile.cruiseKnots.minKnots * TURN_SPEED_FLOOR, cruiseKnots),
      ceilingKnots,
    );

    if (i > 0) {
      cumulativeNm += haversineDistanceNm(path[i - 1]!, point);
    }

    walked.push({
      latitude: point.latitude,
      longitude: point.longitude,
      // Altitude is applied after simplification so climb/descent survive DP
      // collapsing collinear cruise legs.
      altitude: point.altitude ?? 0,
      speedKnots,
      cumulativeNm,
    });
  }

  return walked;
}

function deriveEndMsFromPath(startMs: number, pathLengthNmValue: number, cruiseKnots: number): number {
  const durationMs = Math.max((pathLengthNmValue / cruiseKnots) * 3_600_000 * 1.02, 1_000);
  return startMs + durationMs;
}

/**
 * Convert a routed polyline into timed SimulationEvents with authored speed and
 * altitude. Applies turn-limited walking, Douglas-Peucker simplification to the
 * 60–150 event budget, and rejects windows that would require speeds above the
 * platform/category ceiling.
 */
export function pathToEvents(options: PathToEventsOptions): SimulationEvent[] {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const profile = resolveVehicleProfile(options.vehicleCategory, options.vehicleSubtype);
  const ceilingKnots = categoryCeilingKnots(options.vehicleCategory, profile);
  const cruiseKnots = clamp(
    options.cruiseKnots ?? profileCruiseMidpointKnots(profile),
    profile.cruiseKnots.minKnots,
    ceilingKnots,
  );

  const path = dedupePath(options.path);
  if (path.length < 2) {
    throw new Error("Path must contain at least two distinct points.");
  }

  const totalNm = pathLengthNm(path);
  if (totalNm < 0.001) {
    throw new Error("Path must have positive length.");
  }

  const startMs = Date.parse(options.startAt);
  if (!Number.isFinite(startMs)) {
    throw new Error("Enter a valid start time.");
  }

  const authoredEnd = options.endAt?.trim();
  let endMs = authoredEnd ? Date.parse(authoredEnd) : deriveEndMsFromPath(startMs, totalNm, cruiseKnots);
  if (!Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("End time must be after start time.");
  }

  assertFeasiblePathWindow({
    startMs,
    endMs,
    pathLengthNm: totalNm,
    vehicleCategory: options.vehicleCategory,
    maxKnots: ceilingKnots,
  });

  const walked = walkPath({ path, profile, cruiseKnots, ceilingKnots });
  const requestedCount =
    options.eventCount !== undefined
      ? clamp(Math.floor(options.eventCount), 1, MAX_GENERATED_EVENTS)
      : null;
  const budgetMin = requestedCount ?? PATH_EVENT_BUDGET_MIN;
  const budgetMax = requestedCount ?? PATH_EVENT_BUDGET_MAX;
  let simplified = simplifyToEventBudget(walked, budgetMin, budgetMax);
  // Collinear legs (typical air great-circles) collapse under DP; densify so
  // climb/cruise/descent and the budget floor remain representable.
  if (simplified.length < budgetMin && walked.length >= 2) {
    const densified = densifyAlongPath(simplified, budgetMin);
    // Re-walk speeds onto densified vertices from nearest walked sample.
    simplified = densified.map((point) => {
      let best = walked[0]!;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const sample of walked) {
        const d = haversineDistanceNm(point, sample);
        if (d < bestDist) {
          bestDist = d;
          best = sample;
        }
      }
      return {
        ...point,
        speedKnots: best.speedKnots,
        cumulativeNm: best.cumulativeNm,
        altitude: point.altitude ?? 0,
      };
    });
  }
  // When the caller asked for an exact count and we still have more vertices
  // than needed, keep endpoints and evenly sample intermediate indices.
  if (requestedCount !== null && simplified.length > requestedCount && simplified.length > 2) {
    const sampled: typeof simplified = [];
    for (let i = 0; i < requestedCount; i += 1) {
      const index =
        i === requestedCount - 1
          ? simplified.length - 1
          : Math.round((i * (simplified.length - 1)) / (requestedCount - 1));
      sampled.push(simplified[index]!);
    }
    simplified = sampled;
  }

  // Rebuild cumulative distances on the simplified polyline and assign times so
  // distance = speed × elapsed time on every kept segment.
  const distances: number[] = [0];
  for (let i = 1; i < simplified.length; i += 1) {
    distances.push(
      distances[i - 1]! + haversineDistanceNm(simplified[i - 1]!, simplified[i]!),
    );
  }
  const simplifiedNm = distances[distances.length - 1] ?? 0;

  const startAltitude = path[0]?.altitude ?? 0;
  const endAltitude =
    path[path.length - 1]?.altitude ??
    (profile.typicalFlightLevelFt > 0 ? 0 : startAltitude);

  // Apply vertical profile after DP so climb/cruise/descent survive collinear
  // simplification of straight great-circle legs.
  for (let i = 0; i < simplified.length; i += 1) {
    simplified[i]!.altitude = altitudeAlongPath({
      distanceNm: distances[i]!,
      totalNm: simplifiedNm,
      profile,
      cruiseKnots,
      startAltitude,
      endAltitude,
    });
  }

  // Kinematic duration from turn-limited segment speeds.
  let kinematicHours = 0;
  const segmentSpeeds: number[] = [];
  for (let i = 1; i < simplified.length; i += 1) {
    const segNm = distances[i]! - distances[i - 1]!;
    const speed = Math.max(
      Math.min(simplified[i - 1]!.speedKnots, simplified[i]!.speedKnots),
      profile.cruiseKnots.minKnots * TURN_SPEED_FLOOR,
      0.1,
    );
    const capped = Math.min(speed, ceilingKnots);
    segmentSpeeds.push(capped);
    kinematicHours += segNm / capped;
  }

  const windowHours = (endMs - startMs) / 3_600_000;
  const retime = options.retimeToWindow !== false;

  // Average speed implied by fitting the simplified path into the window.
  const requiredAvg = simplifiedNm / windowHours;
  if (requiredAvg > ceilingKnots + 1e-6) {
    throw new Error(
      `Route requires about ${requiredAvg.toFixed(0)} kt average, above the ${options.vehicleCategory} maximum of ${ceilingKnots} kt. Use a later end time or a shorter distance.`,
    );
  }

  let scale = 1;
  if (retime && kinematicHours > 1e-9) {
    // Stretch or compress the kinematic schedule into the authored window.
    // Compression is only allowed up to the ceiling (already checked via requiredAvg).
    scale = windowHours / kinematicHours;
  } else if (!retime && kinematicHours > windowHours + 1e-9) {
    throw new Error(
      `Route requires about ${(simplifiedNm / kinematicHours).toFixed(0)} kt average over ${kinematicHours.toFixed(2)} h, which does not fit the authored window.`,
    );
  }

  const events: SimulationEvent[] = [];
  let elapsedHours = 0;

  for (let i = 0; i < simplified.length; i += 1) {
    const point = simplified[i]!;
    let speedKnots: number;
    if (i === 0) {
      speedKnots = Math.min(point.speedKnots, ceilingKnots);
    } else {
      const segNm = distances[i]! - distances[i - 1]!;
      const baseSpeed = segmentSpeeds[i - 1]!;
      const dt = (segNm / baseSpeed) * scale;
      elapsedHours += dt;
      // Authored speed is the geometric pace on this segment after retiming.
      speedKnots = dt > 0 ? Math.min(segNm / dt, ceilingKnots) : baseSpeed;
    }

    const atMs =
      i === simplified.length - 1
        ? endMs
        : Math.round(startMs + elapsedHours * 3_600_000);

    events.push({
      id: idFactory(),
      targetId: options.targetId,
      at: new Date(i === 0 ? startMs : atMs).toISOString(),
      position: {
        latitude: Number(point.latitude.toFixed(6)),
        longitude: Number(point.longitude.toFixed(6)),
        altitude: Number(point.altitude.toFixed(1)),
        speed: Number(speedKnots.toFixed(1)),
      } satisfies PositionPayload,
    });
  }

  // Ensure the final timestamp is exactly endAt after rounding.
  const last = events[events.length - 1];
  if (last) {
    last.at = new Date(endMs).toISOString();
  }

  return events;
}
