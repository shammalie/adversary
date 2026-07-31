/**
 * Phase 2c — air router.
 *
 * Builds runway-aligned departure → climb → cruise → optional loiter →
 * descent → runway-aligned approach polylines with per-vertex altitude.
 * Timing / events are phase 3 (`path-to-events`); this module is geometry only.
 *
 * Aerodromes and runway headings come from the phase-1 seed bundle — no
 * runtime tile fetches.
 */

import {
  destinationPoint,
  haversineDistanceNm,
  initialBearingDegrees,
} from "@/lib/position-telemetry";
import type { VehicleProfile } from "@/lib/geo/vehicle-profiles";
import {
  profileCruiseMidpointKnots,
  resolveVehicleProfile,
} from "@/lib/geo/vehicle-profiles";
import type { VehicleCategory } from "@/types/target";

const NM_TO_M = 1_852;
const MIN_DEPARTURE_NM = 2;
const MAX_DEPARTURE_NM = 8;
const MIN_APPROACH_NM = 2;
const MAX_APPROACH_NM = 8;
const RACETRACK_LEG_FACTOR = 2.5;
/** Full-circle hold samples — dense enough that DP + map polylines read as curves. */
const ORBIT_SAMPLES = 48;
/** Samples per 180° racetrack turn (~7.5° steps). */
const RACETRACK_TURN_SAMPLES = 24;
/** Auto loiter is uncommon — most air tracks are straight transit. */
const LOITER_AUTO_PROBABILITY = 0.15;
const GREAT_CIRCLE_STEP_NM = 25;
const SHORT_HOP_NM = 80;
const BEARING_MATCH_TOLERANCE_DEG = 12;
/** Window utilisation cap so climb/descent and pattern overhead fit. */
const WINDOW_FILL = 0.9;

export interface AerodromeRunway {
  ref: string;
  /** Magnetic/true heading in degrees [0, 360). */
  headingDeg: number;
}

export interface Aerodrome {
  icao: string;
  iata: string;
  name: string;
  class: string;
  eleFt: number;
  latitude: number;
  longitude: number;
  runways: readonly AerodromeRunway[];
}

/** Columnar aerodrome block as stored in `geo-seeds.json`. */
export interface GeoSeedsAerodromesColumnar {
  icao: readonly string[];
  iata: readonly string[];
  name: readonly string[];
  class: readonly string[];
  eleFt: readonly number[];
  lng: readonly number[];
  lat: readonly number[];
  /** Each entry is `[ref, headingDeg][]`. */
  runways: ReadonlyArray<ReadonlyArray<readonly [string, number]>>;
}

export interface GeoSeedsBundle {
  v: number;
  aerodromes: GeoSeedsAerodromesColumnar;
  regions?: ReadonlyArray<{
    id: string;
    name: string;
    bbox: readonly [number, number, number, number];
    supports: readonly string[];
  }>;
}

/** Vertex with required altitude (feet MSL). */
export interface AirPathPoint {
  latitude: number;
  longitude: number;
  altitude: number;
}

export type AirLoiterPattern = "racetrack" | "orbit";

export type AirRouteFailureReason =
  | "no-aerodromes-in-region"
  | "no-suitable-pair"
  | "insufficient-window";

export type AirRouteOk = {
  ok: true;
  path: AirPathPoint[];
  origin: Aerodrome;
  destination: Aerodrome;
  returnToBase: boolean;
  loiter: AirLoiterPattern | null;
  cruiseAltitudeFt: number;
  /** Approximate path length in nautical miles. */
  lengthNm: number;
};

export type AirRouteErr = {
  ok: false;
  reason: AirRouteFailureReason;
  message: string;
};

export type AirRouteResult = AirRouteOk | AirRouteErr;

/**
 * Kinematic knobs the air router needs. Prefer injecting a resolved
 * {@link VehicleProfile}; do not hardcode climb/cruise/turn values here.
 */
export interface AirRouterKinematics {
  cruiseKnots: number;
  climbRateFtPerMin: number;
  descentRateFtPerMin: number;
  turnRadiusM: number;
  typicalFlightLevelFt: number;
  canLoiter: boolean;
  returnsToBase: boolean;
}

export type Bbox = readonly [west: number, south: number, east: number, north: number];

export interface PlanAirRouteOptions {
  aerodromes: readonly Aerodrome[];
  /** When set, both fields must lie inside (or RTB field inside). */
  bbox?: Bbox;
  /** Available flight window in hours. */
  windowHours: number;
  kinematics: AirRouterKinematics;
  random?: () => number;
  /**
   * Prefer return-to-base when the platform supports it.
   * When omitted, RTB is chosen randomly (~35%) if `returnsToBase`.
   */
  returnToBase?: boolean;
  /**
   * Loiter selection. `"auto"` (default) inserts a hold on ~15% of capable
   * platforms; `"none"` never loiters; `"racetrack"` / `"orbit"` force a pattern.
   */
  loiter?: AirLoiterPattern | "auto" | "none";
  /** Pin origin (and optionally dest) for tests / planner overrides. */
  origin?: Aerodrome;
  destination?: Aerodrome;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHeading(deg: number) {
  return ((deg % 360) + 360) % 360;
}

function shortestHeadingDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

function metersToNm(m: number) {
  return m / NM_TO_M;
}

function nmToMeters(nm: number) {
  return nm * NM_TO_M;
}

/** Unpack columnar seed aerodromes into row objects. */
export function unpackGeoSeedsAerodromes(
  columnar: GeoSeedsAerodromesColumnar,
): Aerodrome[] {
  const n = columnar.lng.length;
  const out: Aerodrome[] = [];
  for (let i = 0; i < n; i += 1) {
    const raw = columnar.runways[i] ?? [];
    const runways: AerodromeRunway[] = [];
    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const ref = String(entry[0] ?? "");
      const headingDeg = Number(entry[1]);
      if (!Number.isFinite(headingDeg)) continue;
      runways.push({ ref, headingDeg: normalizeHeading(headingDeg) });
    }
    out.push({
      icao: columnar.icao[i] ?? "",
      iata: columnar.iata[i] ?? "",
      name: columnar.name[i] ?? "",
      class: columnar.class[i] ?? "",
      eleFt: columnar.eleFt[i] ?? 0,
      longitude: columnar.lng[i]!,
      latitude: columnar.lat[i]!,
      runways,
    });
  }
  return out;
}

export function kinematicsFromProfile(profile: VehicleProfile): AirRouterKinematics {
  return {
    cruiseKnots: profileCruiseMidpointKnots(profile),
    climbRateFtPerMin: profile.climbRateFtPerMin,
    descentRateFtPerMin: profile.descentRateFtPerMin,
    turnRadiusM: profile.turnRadiusM,
    typicalFlightLevelFt: profile.typicalFlightLevelFt,
    canLoiter: profile.canLoiter,
    returnsToBase: profile.returnsToBase,
  };
}

export function kinematicsForSubtype(
  category: VehicleCategory,
  vehicleSubtype?: string,
): AirRouterKinematics {
  return kinematicsFromProfile(resolveVehicleProfile(category, vehicleSubtype));
}

export function aerodromeInBbox(aero: Aerodrome, bbox: Bbox): boolean {
  const [west, south, east, north] = bbox;
  return (
    aero.longitude >= west &&
    aero.longitude <= east &&
    aero.latitude >= south &&
    aero.latitude <= north
  );
}

function usableRunways(aero: Aerodrome): AerodromeRunway[] {
  // Prefer non-zero headings; fall back to any listed runway (heading 0 is valid north).
  return aero.runways.length > 0 ? [...aero.runways] : [{ ref: "north", headingDeg: 0 }];
}

/**
 * Pick the runway whose heading (or reciprocal) best matches `desiredHeading`.
 * Returns the heading to fly (aligned with desired direction).
 */
export function selectRunwayHeading(
  aero: Aerodrome,
  desiredHeading: number,
): { runway: AerodromeRunway; flyHeading: number } {
  const runways = usableRunways(aero);
  let best = runways[0]!;
  let bestFly = best.headingDeg;
  let bestDelta = Math.abs(shortestHeadingDelta(best.headingDeg, desiredHeading));

  for (const rwy of runways) {
    const forward = Math.abs(shortestHeadingDelta(rwy.headingDeg, desiredHeading));
    const reciprocalHdg = normalizeHeading(rwy.headingDeg + 180);
    const back = Math.abs(shortestHeadingDelta(reciprocalHdg, desiredHeading));
    if (forward < bestDelta) {
      best = rwy;
      bestFly = rwy.headingDeg;
      bestDelta = forward;
    }
    if (back < bestDelta) {
      best = rwy;
      bestFly = reciprocalHdg;
      bestDelta = back;
    }
  }
  return { runway: best, flyHeading: bestFly };
}

/** Cruise flight level scaled down for short hops. */
export function cruiseAltitudeForDistance(
  distanceNm: number,
  typicalFlightLevelFt: number,
): number {
  if (typicalFlightLevelFt <= 0) return 0;
  if (distanceNm < 20) {
    return clamp(Math.round(typicalFlightLevelFt * 0.25), 1_500, typicalFlightLevelFt);
  }
  if (distanceNm < SHORT_HOP_NM) {
    return clamp(Math.round(typicalFlightLevelFt * 0.55), 5_000, typicalFlightLevelFt);
  }
  return typicalFlightLevelFt;
}

function climbDistanceNm(options: {
  startAltFt: number;
  cruiseAltFt: number;
  climbRateFtPerMin: number;
  cruiseKnots: number;
}): number {
  const gain = Math.max(0, options.cruiseAltFt - options.startAltFt);
  if (gain <= 0 || options.climbRateFtPerMin <= 0 || options.cruiseKnots <= 0) return 0;
  const hours = gain / options.climbRateFtPerMin / 60;
  return hours * options.cruiseKnots;
}

function descentDistanceNm(options: {
  endAltFt: number;
  cruiseAltFt: number;
  descentRateFtPerMin: number;
  cruiseKnots: number;
}): number {
  const loss = Math.max(0, options.cruiseAltFt - options.endAltFt);
  if (loss <= 0 || options.descentRateFtPerMin <= 0 || options.cruiseKnots <= 0) return 0;
  const hours = loss / options.descentRateFtPerMin / 60;
  return hours * options.cruiseKnots;
}

function sampleGreatCircle(
  from: Pick<AirPathPoint, "latitude" | "longitude">,
  to: Pick<AirPathPoint, "latitude" | "longitude">,
  altitude: number,
  stepNm = GREAT_CIRCLE_STEP_NM,
): AirPathPoint[] {
  const dist = haversineDistanceNm(from, to);
  if (dist < 1e-4) {
    return [{ latitude: from.latitude, longitude: from.longitude, altitude }];
  }
  const bearing = initialBearingDegrees(from, to);
  const steps = Math.max(1, Math.ceil(dist / stepNm));
  const points: AirPathPoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (t === 0) {
      points.push({ latitude: from.latitude, longitude: from.longitude, altitude });
      continue;
    }
    if (t === 1) {
      points.push({ latitude: to.latitude, longitude: to.longitude, altitude });
      continue;
    }
    const p = destinationPoint(from, dist * t, bearing);
    points.push({
      latitude: p.latitude,
      longitude: p.longitude,
      altitude,
    });
  }
  return points;
}

function lerpAltitude(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function appendUnique(path: AirPathPoint[], next: AirPathPoint) {
  const prev = path[path.length - 1];
  if (
    prev &&
    Math.abs(prev.latitude - next.latitude) < 1e-9 &&
    Math.abs(prev.longitude - next.longitude) < 1e-9 &&
    Math.abs(prev.altitude - next.altitude) < 0.05
  ) {
    return;
  }
  path.push(next);
}

/**
 * Sample a right-hand 180° turn: centre stays on the aircraft's right.
 * Geographic bearings increase clockwise; a right turn orbits the centre
 * clockwise (increasing bearing from the centre).
 */
function sampleRightTurn180(options: {
  start: Pick<AirPathPoint, "latitude" | "longitude">;
  headingDeg: number;
  radiusNm: number;
  altitudeFt: number;
  samples?: number;
}): AirPathPoint[] {
  const samples = options.samples ?? RACETRACK_TURN_SAMPLES;
  const right = normalizeHeading(options.headingDeg + 90);
  const centre = destinationPoint(options.start, options.radiusNm, right);
  const startBearing = normalizeHeading(right + 180); // from centre → start
  const points: AirPathPoint[] = [];
  for (let i = 1; i <= samples; i += 1) {
    // Clockwise around centre = increasing geographic bearing (right turn)
    const bearing = normalizeHeading(startBearing + (180 * i) / samples);
    const p = destinationPoint(centre, options.radiusNm, bearing);
    points.push({
      latitude: p.latitude,
      longitude: p.longitude,
      altitude: options.altitudeFt,
    });
  }
  return points;
}

/**
 * Centre of a right-hand orbit that is tangent at `entry` for an aircraft
 * arriving on `inboundHeadingDeg`. Centre lies to the right of track so the
 * first clockwise step continues on that heading (no radial spike).
 */
export function rightHandOrbitCentre(
  entry: Pick<AirPathPoint, "latitude" | "longitude">,
  inboundHeadingDeg: number,
  radiusNm: number,
): Pick<AirPathPoint, "latitude" | "longitude"> {
  return destinationPoint(entry, radiusNm, normalizeHeading(inboundHeadingDeg + 90));
}

/**
 * Racetrack holding pattern: two parallel legs joined by 180° turns at the
 * platform turn radius. Geometry closes on the entry point after `circuits`
 * laps (default 2 — matches typical ISR racetrack overlays).
 */
export function buildRacetrack(options: {
  entry: Pick<AirPathPoint, "latitude" | "longitude">;
  inboundHeadingDeg: number;
  turnRadiusM: number;
  altitudeFt: number;
  /** Straight leg length; defaults to ~2.5× turn diameter. */
  legLengthNm?: number;
  /** Number of full circuits; minimum 1. */
  circuits?: number;
}): AirPathPoint[] {
  const radiusNm = Math.max(metersToNm(options.turnRadiusM), 0.15);
  const legNm = options.legLengthNm ?? Math.max(RACETRACK_LEG_FACTOR * radiusNm * 2, 3);
  const hdg = normalizeHeading(options.inboundHeadingDeg);
  const reciprocal = normalizeHeading(hdg + 180);
  const circuits = Math.max(1, Math.floor(options.circuits ?? 2));

  const points: AirPathPoint[] = [
    {
      latitude: options.entry.latitude,
      longitude: options.entry.longitude,
      altitude: options.altitudeFt,
    },
  ];

  for (let lap = 0; lap < circuits; lap += 1) {
    const legStart = points[points.length - 1]!;

    // Leg 1 outbound
    const a = destinationPoint(legStart, legNm, hdg);
    appendUnique(points, { ...a, altitude: options.altitudeFt });

    for (const p of sampleRightTurn180({
      start: a,
      headingDeg: hdg,
      radiusNm,
      altitudeFt: options.altitudeFt,
    })) {
      appendUnique(points, p);
    }

    const b = points[points.length - 1]!;
    // Leg 2 back
    const c = destinationPoint(b, legNm, reciprocal);
    appendUnique(points, { ...c, altitude: options.altitudeFt });

    for (const p of sampleRightTurn180({
      start: c,
      headingDeg: reciprocal,
      radiusNm,
      altitudeFt: options.altitudeFt,
    })) {
      appendUnique(points, p);
    }
  }

  // Snap close to entry
  appendUnique(points, {
    latitude: options.entry.latitude,
    longitude: options.entry.longitude,
    altitude: options.altitudeFt,
  });
  return points;
}

/**
 * Orbit (circular hold) at `radiusM` (≥ turn radius). Samples clockwise
 * (right-hand) for `circuits` full turns. Callers should place `centre` via
 * {@link rightHandOrbitCentre} so `startBearingDeg` is centre→entry and the
 * inbound track is tangent at the first point.
 */
export function buildOrbit(options: {
  centre: Pick<AirPathPoint, "latitude" | "longitude">;
  radiusM: number;
  turnRadiusM: number;
  altitudeFt: number;
  startBearingDeg?: number;
  samples?: number;
  /** Number of full 360° circuits; minimum 1. */
  circuits?: number;
}): AirPathPoint[] {
  const radiusM = Math.max(options.radiusM, options.turnRadiusM);
  const radiusNm = metersToNm(radiusM);
  const samples = options.samples ?? ORBIT_SAMPLES;
  const circuits = Math.max(1, Math.floor(options.circuits ?? 2));
  const start = normalizeHeading(options.startBearingDeg ?? 0);
  const points: AirPathPoint[] = [];
  const totalSamples = samples * circuits;
  for (let i = 0; i <= totalSamples; i += 1) {
    const bearing = normalizeHeading(start + (360 * circuits * i) / totalSamples);
    const p = destinationPoint(options.centre, radiusNm, bearing);
    points.push({
      latitude: p.latitude,
      longitude: p.longitude,
      altitude: options.altitudeFt,
    });
  }
  return points;
}

/**
 * Right-hand circular loiter entered tangentially at `entry` on `inboundHeadingDeg`.
 */
export function buildTangentOrbit(options: {
  entry: Pick<AirPathPoint, "latitude" | "longitude">;
  inboundHeadingDeg: number;
  turnRadiusM: number;
  altitudeFt: number;
  /** Orbit radius; defaults to turn radius. */
  radiusM?: number;
  samples?: number;
  circuits?: number;
}): AirPathPoint[] {
  const radiusM = Math.max(options.radiusM ?? options.turnRadiusM, options.turnRadiusM);
  const radiusNm = metersToNm(radiusM);
  const centre = rightHandOrbitCentre(options.entry, options.inboundHeadingDeg, radiusNm);
  const startBearing = initialBearingDegrees(centre, options.entry);
  return buildOrbit({
    centre,
    radiusM,
    turnRadiusM: options.turnRadiusM,
    altitudeFt: options.altitudeFt,
    startBearingDeg: startBearing,
    samples: options.samples,
    circuits: options.circuits,
  });
}

/** Path length in nm (planar haversine sum). */
export function pathLengthNm(path: readonly AirPathPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += haversineDistanceNm(path[i - 1]!, path[i]!);
  }
  return total;
}

function annotateClimbDescent(options: {
  points: AirPathPoint[];
  originEleFt: number;
  destEleFt: number;
  cruiseAltFt: number;
  climbNm: number;
  descentNm: number;
  totalNm: number;
}): void {
  const { points, originEleFt, destEleFt, cruiseAltFt, climbNm, descentNm, totalNm } =
    options;
  if (points.length === 0 || totalNm < 1e-6) return;

  let cum = 0;
  points[0]!.altitude = originEleFt;
  for (let i = 1; i < points.length; i += 1) {
    cum += haversineDistanceNm(points[i - 1]!, points[i]!);
    const remaining = totalNm - cum;
    if (cum <= climbNm && climbNm > 1e-6) {
      points[i]!.altitude = lerpAltitude(originEleFt, cruiseAltFt, cum / climbNm);
    } else if (remaining <= descentNm && descentNm > 1e-6) {
      const t = 1 - remaining / descentNm;
      points[i]!.altitude = lerpAltitude(cruiseAltFt, destEleFt, clamp(t, 0, 1));
    } else {
      points[i]!.altitude = cruiseAltFt;
    }
  }
  points[points.length - 1]!.altitude = destEleFt;
}

function pickLoiter(
  kinematics: AirRouterKinematics,
  loiterOpt: PlanAirRouteOptions["loiter"],
  random: () => number,
): AirLoiterPattern | null {
  if (loiterOpt === "none") return null;
  if (loiterOpt === "racetrack" || loiterOpt === "orbit") {
    return kinematics.canLoiter ? loiterOpt : null;
  }
  // auto — most flights transit; only a minority hold.
  if (!kinematics.canLoiter) return null;
  if (random() >= LOITER_AUTO_PROBABILITY) return null;
  // Prefer racetrack (typical ISR overlay) when we do hold.
  return random() < 0.65 ? "racetrack" : "orbit";
}

function composePointToPoint(options: {
  origin: Aerodrome;
  destination: Aerodrome;
  kinematics: AirRouterKinematics;
  cruiseAltFt: number;
  loiter: AirLoiterPattern | null;
}): AirPathPoint[] {
  const { origin, destination, kinematics, cruiseAltFt, loiter } = options;
  const toward = initialBearingDegrees(origin, destination);
  const fromDest = initialBearingDegrees(destination, origin);
  const dep = selectRunwayHeading(origin, toward);
  const arr = selectRunwayHeading(destination, normalizeHeading(fromDest + 180));

  const gcNm = haversineDistanceNm(origin, destination);
  const climbNm = climbDistanceNm({
    startAltFt: origin.eleFt,
    cruiseAltFt,
    climbRateFtPerMin: kinematics.climbRateFtPerMin,
    cruiseKnots: kinematics.cruiseKnots,
  });
  const descentNm = descentDistanceNm({
    endAltFt: destination.eleFt,
    cruiseAltFt,
    descentRateFtPerMin: kinematics.descentRateFtPerMin,
    cruiseKnots: kinematics.cruiseKnots,
  });

  const depNm = clamp(Math.min(MAX_DEPARTURE_NM, climbNm * 0.35 + MIN_DEPARTURE_NM), MIN_DEPARTURE_NM, MAX_DEPARTURE_NM);
  const appNm = clamp(
    Math.min(MAX_APPROACH_NM, descentNm * 0.35 + MIN_APPROACH_NM),
    MIN_APPROACH_NM,
    MAX_APPROACH_NM,
  );

  const depEnd = destinationPoint(origin, depNm, dep.flyHeading);
  // Approach fix: fly the approach heading into the field, so fix is upstream.
  const approachFix = destinationPoint(
    destination,
    appNm,
    normalizeHeading(arr.flyHeading + 180),
  );

  const path: AirPathPoint[] = [
    { latitude: origin.latitude, longitude: origin.longitude, altitude: origin.eleFt },
  ];

  // Departure (climbing — altitudes refined after assembly)
  const depSamples = Math.max(2, Math.ceil(depNm / 2));
  for (let i = 1; i <= depSamples; i += 1) {
    const t = i / depSamples;
    const p = destinationPoint(origin, depNm * t, dep.flyHeading);
    appendUnique(path, {
      latitude: p.latitude,
      longitude: p.longitude,
      altitude: cruiseAltFt,
    });
  }

  const cruiseDist = haversineDistanceNm(depEnd, approachFix);
  const loiterFrac = 0.45;
  const loiterEntry =
    cruiseDist > 1
      ? destinationPoint(depEnd, cruiseDist * loiterFrac, initialBearingDegrees(depEnd, approachFix))
      : depEnd;

  for (const p of sampleGreatCircle(depEnd, loiterEntry, cruiseAltFt)) {
    appendUnique(path, p);
  }

  if (loiter && cruiseDist > 1) {
    const inbound = initialBearingDegrees(loiterEntry, approachFix);
    // Tangential entry: arrive on `inbound`, hold to the right of track, then
    // continue toward the approach fix (same heading) — never spike through the
    // orbit centre or chord across the hold.
    const pattern =
      loiter === "orbit"
        ? buildTangentOrbit({
            entry: loiterEntry,
            inboundHeadingDeg: inbound,
            turnRadiusM: kinematics.turnRadiusM,
            altitudeFt: cruiseAltFt,
          })
        : buildRacetrack({
            entry: loiterEntry,
            inboundHeadingDeg: inbound,
            turnRadiusM: kinematics.turnRadiusM,
            altitudeFt: cruiseAltFt,
          });
    for (const p of pattern) appendUnique(path, p);
    for (const p of sampleGreatCircle(pattern[pattern.length - 1]!, approachFix, cruiseAltFt)) {
      appendUnique(path, p);
    }
  } else {
    for (const p of sampleGreatCircle(loiterEntry, approachFix, cruiseAltFt)) {
      appendUnique(path, p);
    }
  }

  // Final approach along runway heading
  appendUnique(path, {
    latitude: approachFix.latitude,
    longitude: approachFix.longitude,
    altitude: cruiseAltFt,
  });
  const appSamples = Math.max(2, Math.ceil(appNm / 2));
  for (let i = 1; i <= appSamples; i += 1) {
    const t = i / appSamples;
    const p = destinationPoint(approachFix, appNm * t, arr.flyHeading);
    appendUnique(path, {
      latitude: p.latitude,
      longitude: p.longitude,
      altitude: destination.eleFt,
    });
  }
  appendUnique(path, {
    latitude: destination.latitude,
    longitude: destination.longitude,
    altitude: destination.eleFt,
  });

  const totalNm = pathLengthNm(path);
  let adjClimb = climbNm;
  let adjDescent = descentNm;
  if (adjClimb + adjDescent > totalNm * 0.85 && totalNm > 1e-3) {
    const scale = (totalNm * 0.85) / (adjClimb + adjDescent);
    adjClimb *= scale;
    adjDescent *= scale;
  }
  annotateClimbDescent({
    points: path,
    originEleFt: origin.eleFt,
    destEleFt: destination.eleFt,
    cruiseAltFt,
    climbNm: adjClimb,
    descentNm: adjDescent,
    totalNm,
  });

  return path;
}

function composeReturnToBase(options: {
  field: Aerodrome;
  kinematics: AirRouterKinematics;
  cruiseAltFt: number;
  loiter: AirLoiterPattern | null;
  random: () => number;
}): AirPathPoint[] {
  const { field, kinematics, cruiseAltFt, loiter, random } = options;
  const patrolBearing = selectRunwayHeading(field, random() * 360).flyHeading;
  const radiusNm = metersToNm(kinematics.turnRadiusM);
  // Outbound far enough for a meaningful patrol before the hold / reverse.
  const outboundNm = Math.max(12, radiusNm * 6 + MIN_DEPARTURE_NM * 2);

  const dep = selectRunwayHeading(field, patrolBearing);
  const climbNm = climbDistanceNm({
    startAltFt: field.eleFt,
    cruiseAltFt,
    climbRateFtPerMin: kinematics.climbRateFtPerMin,
    cruiseKnots: kinematics.cruiseKnots,
  });
  const descentNm = descentDistanceNm({
    endAltFt: field.eleFt,
    cruiseAltFt,
    descentRateFtPerMin: kinematics.descentRateFtPerMin,
    cruiseKnots: kinematics.cruiseKnots,
  });

  const path: AirPathPoint[] = [
    { latitude: field.latitude, longitude: field.longitude, altitude: field.eleFt },
  ];

  const depNm = clamp(MIN_DEPARTURE_NM + 1, MIN_DEPARTURE_NM, MAX_DEPARTURE_NM);
  const depEnd = destinationPoint(field, depNm, dep.flyHeading);
  for (let i = 1; i <= 4; i += 1) {
    const p = destinationPoint(field, (depNm * i) / 4, dep.flyHeading);
    appendUnique(path, { ...p, altitude: cruiseAltFt });
  }

  const patrolPoint = destinationPoint(depEnd, outboundNm, patrolBearing);
  for (const p of sampleGreatCircle(depEnd, patrolPoint, cruiseAltFt, 10)) {
    appendUnique(path, p);
  }

  if (loiter) {
    const pattern =
      loiter === "orbit"
        ? buildTangentOrbit({
            entry: patrolPoint,
            inboundHeadingDeg: patrolBearing,
            turnRadiusM: kinematics.turnRadiusM,
            altitudeFt: cruiseAltFt,
          })
        : buildRacetrack({
            entry: patrolPoint,
            inboundHeadingDeg: patrolBearing,
            turnRadiusM: kinematics.turnRadiusM,
            altitudeFt: cruiseAltFt,
          });
    for (const p of pattern) appendUnique(path, p);
  }

  // Hold / patrol ends still heading outbound — reverse with a right 180° before
  // homing, otherwise the return leg is a hairpin chord back on itself.
  const turnStart = path[path.length - 1]!;
  for (const p of sampleRightTurn180({
    start: turnStart,
    headingDeg: patrolBearing,
    radiusNm,
    altitudeFt: cruiseAltFt,
  })) {
    appendUnique(path, p);
  }

  // Return — approach along reciprocal of departure (or best matching runway)
  const homeStart = path[path.length - 1]!;
  const homeBearing = initialBearingDegrees(homeStart, field);
  const arr = selectRunwayHeading(field, homeBearing);
  const appNm = clamp(MIN_APPROACH_NM + 1, MIN_APPROACH_NM, MAX_APPROACH_NM);
  const approachFix = destinationPoint(field, appNm, normalizeHeading(arr.flyHeading + 180));

  for (const p of sampleGreatCircle(homeStart, approachFix, cruiseAltFt, 10)) {
    appendUnique(path, p);
  }
  for (let i = 1; i <= 4; i += 1) {
    const p = destinationPoint(approachFix, (appNm * i) / 4, arr.flyHeading);
    appendUnique(path, { ...p, altitude: field.eleFt });
  }
  appendUnique(path, {
    latitude: field.latitude,
    longitude: field.longitude,
    altitude: field.eleFt,
  });

  const totalNm = pathLengthNm(path);
  let adjClimb = climbNm;
  let adjDescent = descentNm;
  if (adjClimb + adjDescent > totalNm * 0.85 && totalNm > 1e-3) {
    const scale = (totalNm * 0.85) / (adjClimb + adjDescent);
    adjClimb *= scale;
    adjDescent *= scale;
  }
  annotateClimbDescent({
    points: path,
    originEleFt: field.eleFt,
    destEleFt: field.eleFt,
    cruiseAltFt,
    climbNm: adjClimb,
    descentNm: adjDescent,
    totalNm,
  });

  return path;
}

function estimateMinHours(lengthNm: number, cruiseKnots: number): number {
  if (cruiseKnots <= 0) return Number.POSITIVE_INFINITY;
  return lengthNm / cruiseKnots;
}

function sameField(a: Aerodrome, b: Aerodrome): boolean {
  return (
    Math.abs(a.latitude - b.latitude) < 1e-5 && Math.abs(a.longitude - b.longitude) < 1e-5
  );
}

function candidatesInRegion(
  aerodromes: readonly Aerodrome[],
  bbox: Bbox | undefined,
): Aerodrome[] {
  return bbox ? aerodromes.filter((a) => aerodromeInBbox(a, bbox)) : [...aerodromes];
}

/**
 * Plan an air route. Synchronous — seed-only, no tile I/O.
 */
export function planAirRoute(options: PlanAirRouteOptions): AirRouteResult {
  const random = options.random ?? Math.random;
  const { kinematics, windowHours } = options;
  const pool = candidatesInRegion(options.aerodromes, options.bbox);

  if (pool.length === 0) {
    return {
      ok: false,
      reason: "no-aerodromes-in-region",
      message: "No aerodromes available in the requested region.",
    };
  }

  const wantRtb =
    options.returnToBase ??
    (kinematics.returnsToBase && random() < 0.35);

  if (wantRtb && kinematics.returnsToBase) {
    const field = options.origin ?? pool[Math.floor(random() * pool.length)]!;
    const loiter = pickLoiter(kinematics, options.loiter, random);
    // Probe length with a representative cruise altitude
    const probeAlt = cruiseAltitudeForDistance(40, kinematics.typicalFlightLevelFt);
    const path = composeReturnToBase({
      field,
      kinematics,
      cruiseAltFt: probeAlt,
      loiter,
      random,
    });
    const lengthNm = pathLengthNm(path);
    const hours = estimateMinHours(lengthNm, kinematics.cruiseKnots);
    if (hours > windowHours * WINDOW_FILL) {
      return {
        ok: false,
        reason: "insufficient-window",
        message: `Return-to-base pattern needs ~${hours.toFixed(1)} h at ${kinematics.cruiseKnots.toFixed(0)} kt; window is ${windowHours.toFixed(1)} h.`,
      };
    }
    return {
      ok: true,
      path,
      origin: field,
      destination: field,
      returnToBase: true,
      loiter,
      cruiseAltitudeFt: probeAlt,
      lengthNm,
    };
  }

  // Point-to-point: find a flyable pair within the window.
  const origin = options.origin ?? pool[Math.floor(random() * pool.length)]!;
  const maxNm = kinematics.cruiseKnots * windowHours * WINDOW_FILL;

  type Pair = { dest: Aerodrome; dist: number };
  const viable: Pair[] = [];

  if (options.destination) {
    const dist = haversineDistanceNm(origin, options.destination);
    if (!sameField(origin, options.destination) && dist <= maxNm && dist >= 5) {
      viable.push({ dest: options.destination, dist });
    }
  } else {
    for (const dest of pool) {
      if (sameField(origin, dest)) continue;
      const dist = haversineDistanceNm(origin, dest);
      if (dist < 5 || dist > maxNm) continue;
      // Prefer destinations that leave room for climb/descent/loiter overhead (~15%).
      if (dist > maxNm * 0.85) continue;
      viable.push({ dest, dist });
    }
  }

  if (viable.length === 0) {
    return {
      ok: false,
      reason: "no-suitable-pair",
      message: `No destination aerodrome within range (~${maxNm.toFixed(0)} nm at ${kinematics.cruiseKnots.toFixed(0)} kt for ${windowHours.toFixed(1)} h).`,
    };
  }

  const pick = viable[Math.floor(random() * viable.length)]!;
  const destination = pick.dest;
  const cruiseAltFt = cruiseAltitudeForDistance(pick.dist, kinematics.typicalFlightLevelFt);
  const loiter = pickLoiter(kinematics, options.loiter, random);

  const path = composePointToPoint({
    origin,
    destination,
    kinematics,
    cruiseAltFt,
    loiter,
  });
  const lengthNm = pathLengthNm(path);
  const hours = estimateMinHours(lengthNm, kinematics.cruiseKnots);
  if (hours > windowHours * WINDOW_FILL) {
    return {
      ok: false,
      reason: "insufficient-window",
      message: `Route length ~${lengthNm.toFixed(0)} nm needs ~${hours.toFixed(1)} h; window is ${windowHours.toFixed(1)} h.`,
    };
  }

  return {
    ok: true,
    path,
    origin,
    destination,
    returnToBase: false,
    loiter,
    cruiseAltitudeFt: cruiseAltFt,
    lengthNm,
  };
}

/** Bearing of the first non-trivial segment — used by tests for runway alignment. */
export function departureBearingDeg(path: readonly AirPathPoint[]): number {
  for (let i = 1; i < path.length; i += 1) {
    const d = haversineDistanceNm(path[0]!, path[i]!);
    if (d > 0.2) return initialBearingDegrees(path[0]!, path[i]!);
  }
  return initialBearingDegrees(path[0]!, path[1] ?? path[0]!);
}

/** Bearing of the final approach segment into the last point. */
export function arrivalBearingDeg(path: readonly AirPathPoint[]): number {
  const end = path[path.length - 1]!;
  for (let i = path.length - 2; i >= 0; i -= 1) {
    const d = haversineDistanceNm(path[i]!, end);
    if (d > 0.2) return initialBearingDegrees(path[i]!, end);
  }
  return initialBearingDegrees(path[path.length - 2] ?? end, end);
}

export function headingMatchesRunway(
  headingDeg: number,
  aero: Aerodrome,
  toleranceDeg = BEARING_MATCH_TOLERANCE_DEG,
): boolean {
  for (const rwy of usableRunways(aero)) {
    if (Math.abs(shortestHeadingDelta(headingDeg, rwy.headingDeg)) <= toleranceDeg) {
      return true;
    }
    if (
      Math.abs(shortestHeadingDelta(headingDeg, normalizeHeading(rwy.headingDeg + 180))) <=
      toleranceDeg
    ) {
      return true;
    }
  }
  return false;
}

export { metersToNm, nmToMeters, normalizeHeading, shortestHeadingDelta };
