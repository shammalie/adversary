import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createSeededRandom } from "@/lib/random";
import {
  destinationPoint,
  haversineDistanceNm,
  initialBearingDegrees,
} from "@/lib/position-telemetry";
import {
  arrivalBearingDeg,
  buildOrbit,
  buildRacetrack,
  buildTangentOrbit,
  departureBearingDeg,
  headingMatchesRunway,
  kinematicsFromProfile,
  metersToNm,
  pathLengthNm,
  planAirRoute,
  rightHandOrbitCentre,
  unpackGeoSeedsAerodromes,
  type Aerodrome,
  type GeoSeedsBundle,
} from "@/lib/geo/air-router";
import { resolveVehicleProfile } from "@/lib/geo/vehicle-profiles";

const SEEDS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../public/geo-seeds.json",
);

function fixtureField(
  partial: Partial<Aerodrome> & Pick<Aerodrome, "latitude" | "longitude" | "name">,
): Aerodrome {
  return {
    icao: partial.icao ?? "",
    iata: partial.iata ?? "",
    class: partial.class ?? "international",
    eleFt: partial.eleFt ?? 0,
    runways: partial.runways ?? [
      { ref: "09", headingDeg: 90 },
      { ref: "27", headingDeg: 270 },
    ],
    ...partial,
  };
}

/** Heathrow-ish and Amsterdam-ish synthetic pair (~200 nm). */
const ORIGIN = fixtureField({
  name: "Origin Field",
  icao: "EGLL",
  iata: "LHR",
  latitude: 51.47,
  longitude: -0.46,
  eleFt: 80,
  runways: [
    { ref: "09L", headingDeg: 90 },
    { ref: "27R", headingDeg: 270 },
  ],
});

const DEST = fixtureField({
  name: "Destination Field",
  icao: "EHAM",
  iata: "AMS",
  latitude: 52.31,
  longitude: 4.77,
  eleFt: 10,
  runways: [
    { ref: "18", headingDeg: 183 },
    { ref: "36", headingDeg: 3 },
  ],
});

const FIGHTER = kinematicsFromProfile(resolveVehicleProfile("aircraft", "Multi-role fighter"));
const UAV = kinematicsFromProfile(resolveVehicleProfile("aircraft", "UAV"));
const TRANSPORT = kinematicsFromProfile(resolveVehicleProfile("aircraft", "Transport"));

describe("loiter geometry", () => {
  it("returns a racetrack to its entry point", () => {
    const entry = { latitude: 51.5, longitude: 0.5 };
    const track = buildRacetrack({
      entry,
      inboundHeadingDeg: 90,
      turnRadiusM: 2_500,
      altitudeFt: 20_000,
      legLengthNm: 8,
    });
    const end = track[track.length - 1]!;
    expect(haversineDistanceNm(entry, end)).toBeLessThan(0.35);
    expect(track.length).toBeGreaterThan(10);
  });

  it("turns right on racetrack arcs (clockwise, not a bow-tie)", () => {
    // Northbound leg: a right 180° must bulge east/north of the turn centre.
    // The old CCW sampling put the arc midpoint south and produced a figure-8.
    const entry = { latitude: 50.0, longitude: 0.0 };
    const hdg = 0;
    const turnRadiusM = 4_000;
    const radiusNm = metersToNm(turnRadiusM);
    const legNm = 10;
    const track = buildRacetrack({
      entry,
      inboundHeadingDeg: hdg,
      turnRadiusM,
      altitudeFt: 10_000,
      legLengthNm: legNm,
    });

    const a = destinationPoint(entry, legNm, hdg);
    const turn1Centre = destinationPoint(a, radiusNm, 90);
    // Mid-arc of a right turn from west-of-centre is north of the centre.
    const midExpected = destinationPoint(turn1Centre, radiusNm, 0);

    let nearest = Infinity;
    for (const p of track) {
      nearest = Math.min(nearest, haversineDistanceNm(midExpected, p));
    }
    expect(nearest).toBeLessThan(radiusNm * 0.25);

    // Opposite (wrong) mid-arc should stay far — guards against left-turn regression.
    const wrongMid = destinationPoint(turn1Centre, radiusNm, 180);
    let nearestWrong = Infinity;
    for (const p of track) {
      nearestWrong = Math.min(nearestWrong, haversineDistanceNm(wrongMid, p));
    }
    expect(nearestWrong).toBeGreaterThan(radiusNm * 0.5);
  });

  it("keeps an orbit within tolerance of its radius", () => {
    const centre = { latitude: 51.5, longitude: 0.5 };
    const radiusM = 3_000;
    const orbit = buildOrbit({
      centre,
      radiusM,
      turnRadiusM: 2_500,
      altitudeFt: 15_000,
      samples: 36,
      circuits: 1,
    });
    const radiusNm = metersToNm(radiusM);
    for (const p of orbit) {
      const d = haversineDistanceNm(centre, p);
      expect(Math.abs(d - radiusNm)).toBeLessThan(radiusNm * 0.08);
    }
    // Closed loop
    expect(haversineDistanceNm(orbit[0]!, orbit[orbit.length - 1]!)).toBeLessThan(0.05);
  });

  it("enters a tangent orbit without a radial spike through the centre", () => {
    const entry = { latitude: 51.5, longitude: 0.5 };
    const inbound = 90; // eastbound
    const turnRadiusM = 2_500;
    const radiusNm = metersToNm(turnRadiusM);
    const orbit = buildTangentOrbit({
      entry,
      inboundHeadingDeg: inbound,
      turnRadiusM,
      altitudeFt: 15_000,
      samples: 48,
      circuits: 1,
    });

    // First point is on the circumference at entry, not at the centre.
    expect(haversineDistanceNm(entry, orbit[0]!)).toBeLessThan(0.05);
    const centre = rightHandOrbitCentre(entry, inbound, radiusNm);
    expect(haversineDistanceNm(centre, orbit[0]!)).toBeGreaterThan(radiusNm * 0.9);

    // Early step continues roughly east (tangent), not south into/through centre.
    const step = orbit[Math.max(1, Math.floor(orbit.length / 16))]!;
    const stepBearing = initialBearingDegrees(orbit[0]!, step);
    const delta = Math.abs(((stepBearing - inbound + 540) % 360) - 180);
    expect(delta).toBeLessThan(35);

    // No orbit vertex near the centre (guards the old centre=entry bug).
    for (const p of orbit) {
      expect(haversineDistanceNm(centre, p)).toBeGreaterThan(radiusNm * 0.85);
    }
  });

  it("builds multi-circuit racetracks that still close on entry", () => {
    const entry = { latitude: 51.5, longitude: 0.5 };
    const track = buildRacetrack({
      entry,
      inboundHeadingDeg: 90,
      turnRadiusM: 2_500,
      altitudeFt: 20_000,
      legLengthNm: 6,
      circuits: 2,
    });
    expect(haversineDistanceNm(entry, track[track.length - 1]!)).toBeLessThan(0.35);
    const single = buildRacetrack({
      entry,
      inboundHeadingDeg: 90,
      turnRadiusM: 2_500,
      altitudeFt: 20_000,
      legLengthNm: 6,
      circuits: 1,
    });
    expect(track.length).toBeGreaterThan(single.length);
  });

  it("respects turn radius on racetrack turns (no tighter than R)", () => {
    const turnRadiusM = 4_000;
    const radiusNm = metersToNm(turnRadiusM);
    const entry = { latitude: 50.0, longitude: 0.0 };
    const hdg = 0;
    const legNm = 10;
    const track = buildRacetrack({
      entry,
      inboundHeadingDeg: hdg,
      turnRadiusM,
      altitudeFt: 10_000,
      legLengthNm: legNm,
    });

    // Known turn centres from the same construction as buildRacetrack
    const a = destinationPoint(entry, legNm, hdg);
    const turn1Centre = destinationPoint(a, radiusNm, 90);
    // End of first turn ≈ destination(turn1Centre, radiusNm, 90)
    const b = destinationPoint(turn1Centre, radiusNm, 90);
    const c = destinationPoint(b, legNm, 180);
    const turn2Centre = destinationPoint(c, radiusNm, 270);

    let onArc = 0;
    for (const p of track) {
      const d1 = haversineDistanceNm(turn1Centre, p);
      const d2 = haversineDistanceNm(turn2Centre, p);
      if (Math.abs(d1 - radiusNm) < radiusNm * 0.12) onArc += 1;
      if (Math.abs(d2 - radiusNm) < radiusNm * 0.12) onArc += 1;
    }
    expect(onArc).toBeGreaterThan(8);
    // No point should cut inside ~75% of R toward either centre while near the arc
    for (const p of track) {
      const d1 = haversineDistanceNm(turn1Centre, p);
      const d2 = haversineDistanceNm(turn2Centre, p);
      expect(d1).toBeGreaterThanOrEqual(radiusNm * 0.75);
      expect(d2).toBeGreaterThanOrEqual(radiusNm * 0.75);
    }
  });
});

describe("planAirRoute", () => {
  it("aligns departure and arrival bearings with real runway headings", () => {
    const result = planAirRoute({
      aerodromes: [ORIGIN, DEST],
      windowHours: 4,
      kinematics: FIGHTER,
      returnToBase: false,
      loiter: "none",
      origin: ORIGIN,
      destination: DEST,
      random: createSeededRandom(7),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dep = departureBearingDeg(result.path);
    const arr = arrivalBearingDeg(result.path);
    expect(headingMatchesRunway(dep, ORIGIN)).toBe(true);
    expect(headingMatchesRunway(arr, DEST)).toBe(true);
  });

  it("produces climb then cruise plateau then descent altitudes", () => {
    const result = planAirRoute({
      aerodromes: [ORIGIN, DEST],
      windowHours: 4,
      kinematics: TRANSPORT,
      returnToBase: false,
      loiter: "none",
      origin: ORIGIN,
      destination: DEST,
      random: createSeededRandom(3),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const alts = result.path.map((p) => p.altitude);
    expect(alts[0]).toBeLessThan(1_000);
    expect(alts[alts.length - 1]).toBeLessThan(1_000);
    const peak = Math.max(...alts);
    expect(peak).toBeGreaterThan(10_000);
    const peakIdx = alts.indexOf(peak);
    expect(peakIdx).toBeGreaterThan(1);
    expect(peakIdx).toBeLessThan(alts.length - 2);

    // Rising into the plateau
    expect(alts[Math.floor(peakIdx / 2)]!).toBeGreaterThan(alts[0]!);
    // Falling after the plateau
    const after = alts.slice(peakIdx);
    const late = after[Math.floor(after.length * 0.75)]!;
    expect(late).toBeLessThan(peak);
  });

  it("return-to-base starts and ends at the same field with a mid loiter", () => {
    const result = planAirRoute({
      aerodromes: [ORIGIN, DEST],
      windowHours: 6,
      kinematics: UAV,
      returnToBase: true,
      loiter: "racetrack",
      origin: ORIGIN,
      random: createSeededRandom(11),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.returnToBase).toBe(true);
    expect(result.loiter).toBe("racetrack");
    expect(result.origin.icao).toBe(result.destination.icao);
    expect(haversineDistanceNm(result.path[0]!, result.path[result.path.length - 1]!)).toBeLessThan(
      0.05,
    );
    // Non-degenerate: must leave the field
    expect(pathLengthNm(result.path)).toBeGreaterThan(20);
    expect(
      Math.max(...result.path.map((p) => haversineDistanceNm(ORIGIN, p))),
    ).toBeGreaterThan(5);
  });

  it("return-to-base reverses with a turn instead of a hairpin chord", () => {
    const result = planAirRoute({
      aerodromes: [ORIGIN, DEST],
      windowHours: 6,
      kinematics: UAV,
      returnToBase: true,
      loiter: "none",
      origin: ORIGIN,
      random: createSeededRandom(19),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loiter).toBeNull();

    // Find the outbound tip (max distance from field), then the next ~12 points
    // should arc rather than a single segment flipping ~180° toward home.
    let tipIdx = 0;
    let tipDist = 0;
    for (let i = 0; i < result.path.length; i += 1) {
      const d = haversineDistanceNm(ORIGIN, result.path[i]!);
      if (d > tipDist) {
        tipDist = d;
        tipIdx = i;
      }
    }
    expect(tipIdx).toBeGreaterThan(2);
    expect(tipIdx).toBeLessThan(result.path.length - 3);

    let maxStepTurn = 0;
    const arcEnd = Math.min(result.path.length - 1, tipIdx + 16);
    for (let i = Math.max(1, tipIdx - 1); i < arcEnd; i += 1) {
      const h1 = initialBearingDegrees(result.path[i - 1]!, result.path[i]!);
      const h2 = initialBearingDegrees(result.path[i]!, result.path[i + 1]!);
      const delta = Math.abs(((h2 - h1 + 540) % 360) - 180);
      maxStepTurn = Math.max(maxStepTurn, delta);
    }
    // A hairpin chord would jump ~180° in one step; a sampled 180° turn stays gradual.
    expect(maxStepTurn).toBeLessThan(40);
  });

  it("auto-loiter is uncommon (~15% of capable flights)", () => {
    let withLoiter = 0;
    const trials = 200;
    for (let i = 0; i < trials; i += 1) {
      const result = planAirRoute({
        aerodromes: [ORIGIN, DEST],
        windowHours: 4,
        kinematics: FIGHTER,
        returnToBase: false,
        loiter: "auto",
        origin: ORIGIN,
        destination: DEST,
        random: createSeededRandom(2_000 + i),
      });
      if (result.ok && result.loiter) withLoiter += 1;
    }
    const rate = withLoiter / trials;
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.3);
  });

  it("returns a typed failure when no pair fits the window", () => {
    const result = planAirRoute({
      aerodromes: [ORIGIN, DEST],
      windowHours: 0.05,
      kinematics: UAV,
      returnToBase: false,
      origin: ORIGIN,
      destination: DEST,
      random: createSeededRandom(1),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason === "no-suitable-pair" || result.reason === "insufficient-window").toBe(
      true,
    );
  });

  it("returns no-aerodromes-in-region for an empty bbox", () => {
    const result = planAirRoute({
      aerodromes: [ORIGIN, DEST],
      bbox: [10, 10, 11, 11],
      windowHours: 4,
      kinematics: FIGHTER,
      random: createSeededRandom(2),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no-aerodromes-in-region");
  });

  it("unpacks columnar geo-seeds and routes between real fields", () => {
    const bundle = JSON.parse(readFileSync(SEEDS_PATH, "utf8")) as GeoSeedsBundle;
    const aerodromes = unpackGeoSeedsAerodromes(bundle.aerodromes);
    expect(aerodromes.length).toBeGreaterThan(100);

    const egll = aerodromes.find((a) => a.icao === "EGLL" || a.iata === "LHR");
    const eham = aerodromes.find((a) => a.icao === "EHAM" || a.iata === "AMS");
    // Seeds may not include every major airport depending on mining filters;
    // fall back to any two London-region fields with runways.
    const london = aerodromes.filter(
      (a) =>
        a.latitude > 51 &&
        a.latitude < 52 &&
        a.longitude > -1 &&
        a.longitude < 1 &&
        a.runways.length > 0,
    );
    const origin = egll ?? london[0];
    const dest =
      eham ??
      london.find(
        (a) =>
          origin &&
          haversineDistanceNm(origin, a) > 20 &&
          haversineDistanceNm(origin, a) < 200,
      ) ??
      london[1];
    expect(origin).toBeDefined();
    expect(dest).toBeDefined();
    if (!origin || !dest) return;

    const result = planAirRoute({
      aerodromes,
      windowHours: 3,
      kinematics: TRANSPORT,
      returnToBase: false,
      loiter: "none",
      origin,
      destination: dest,
      random: createSeededRandom(42),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(headingMatchesRunway(departureBearingDeg(result.path), origin)).toBe(true);
    expect(headingMatchesRunway(arrivalBearingDeg(result.path), dest)).toBe(true);
    expect(result.path.every((p) => Number.isFinite(p.altitude))).toBe(true);
  });
});
