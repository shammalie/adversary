import { describe, expect, it } from "vitest";

import { buildOrbit, metersToNm } from "@/lib/geo/air-router";
import {
  curveChordErrorM,
  douglasPeuckerSimplify,
  PATH_EVENT_BUDGET_MAX,
  PATH_EVENT_BUDGET_MIN,
  pathToEvents,
  perpendicularDistanceMeters,
  restoreArcDetail,
  simplifyToEventBudget,
} from "@/lib/geo/path-to-events";
import { resolveVehicleProfile } from "@/lib/geo/vehicle-profiles";
import { haversineDistanceNm } from "@/lib/position-telemetry";
import { CATEGORY_TOP_SPEED_KNOTS } from "@/lib/vehicle-speed";

function idFactory() {
  let index = 0;
  return () => `evt-${index++}`;
}

/** Dense collinear samples along a meridian, plus a sharp corner. */
function cornerPolyline() {
  const points: Array<{ latitude: number; longitude: number }> = [];
  // Northbound leg (collinear).
  for (let i = 0; i <= 40; i += 1) {
    points.push({ latitude: 51.0 + i * 0.01, longitude: 0 });
  }
  // Eastbound leg (collinear) — corner at (51.4, 0).
  for (let i = 1; i <= 40; i += 1) {
    points.push({ latitude: 51.4, longitude: i * 0.01 });
  }
  return points;
}

/** Long zigzag that exceeds the event budget before simplification. */
function zigzagPolyline(legs = 80) {
  const points: Array<{ latitude: number; longitude: number }> = [];
  let lat = 51.5;
  let lng = -0.5;
  points.push({ latitude: lat, longitude: lng });
  for (let i = 0; i < legs; i += 1) {
    lat += 0.08;
    points.push({ latitude: lat, longitude: lng });
    lng += i % 2 === 0 ? 0.12 : -0.12;
    points.push({ latitude: lat, longitude: lng });
  }
  return points;
}

function pathLengthNmOf(
  path: ReadonlyArray<{ latitude: number; longitude: number }>,
): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += haversineDistanceNm(path[i - 1]!, path[i]!);
  }
  return total;
}

/** End time sized for cruise midpoint with light slack, inside [min, max] cruise. */
function feasibleEndAt(
  path: ReadonlyArray<{ latitude: number; longitude: number }>,
  startAt: string,
  profile: ReturnType<typeof resolveVehicleProfile>,
  slack = 1.02,
): string {
  const totalNm = pathLengthNmOf(path);
  const mid = profileMid(profile);
  const floor = profile.cruiseKnots.minKnots;
  const ceiling = Math.min(profile.maxKnots, CATEGORY_TOP_SPEED_KNOTS[profile.category]);
  const hoursAtMid = (totalNm / mid) * slack;
  const minHours = totalNm / ceiling;
  const maxHours = totalNm / floor;
  const hours = Math.min(Math.max(hoursAtMid, minHours * 1.01), maxHours * 0.98);
  return new Date(Date.parse(startAt) + Math.max(hours, 1 / 3600) * 3_600_000).toISOString();
}

describe("douglas-peucker simplification", () => {
  it("measures perpendicular distance in metres", () => {
    const dist = perpendicularDistanceMeters(
      { latitude: 51.1, longitude: 0.05 },
      { latitude: 51.0, longitude: 0 },
      { latitude: 51.2, longitude: 0 },
    );
    // ~0.05° longitude at 51°N ≈ 3.5 km.
    expect(dist).toBeGreaterThan(3_000);
    expect(dist).toBeLessThan(5_000);
  });

  it("keeps corner vertices and drops collinear ones", () => {
    const path = cornerPolyline();
    const simplified = douglasPeuckerSimplify(path, 50);
    expect(simplified.length).toBeLessThan(path.length);
    expect(simplified.length).toBeGreaterThanOrEqual(3);

    const first = simplified[0]!;
    const last = simplified[simplified.length - 1]!;
    expect(first).toEqual(path[0]);
    expect(last).toEqual(path[path.length - 1]);

    // The right-angle corner at (51.4, 0) must survive.
    expect(
      simplified.some(
        (p) => Math.abs(p.latitude - 51.4) < 1e-9 && Math.abs(p.longitude) < 1e-9,
      ),
    ).toBe(true);
  });

  it("lands long routes inside the 60–150 point budget", () => {
    const path = zigzagPolyline(100);
    expect(path.length).toBeGreaterThan(PATH_EVENT_BUDGET_MAX);
    const simplified = simplifyToEventBudget(path);
    expect(simplified.length).toBeGreaterThanOrEqual(PATH_EVENT_BUDGET_MIN);
    expect(simplified.length).toBeLessThanOrEqual(PATH_EVENT_BUDGET_MAX);
  });
});

describe("pathToEvents", () => {
  it("emits authored speed and altitude with 6-decimal coordinates", () => {
    const path = [
      { latitude: 51.5, longitude: -0.12, altitude: 0 },
      { latitude: 51.55, longitude: -0.1, altitude: 0 },
      { latitude: 51.6, longitude: -0.08, altitude: 0 },
    ];
    const profile = resolveVehicleProfile("car", "Sedan");
    const startAt = "2026-07-27T12:00:00.000Z";
    const events = pathToEvents({
      targetId: "t1",
      path,
      startAt,
      endAt: feasibleEndAt(path, startAt, profile),
      vehicleCategory: "car",
      vehicleSubtype: "Sedan",
      idFactory: idFactory(),
    });

    expect(events.length).toBeGreaterThanOrEqual(2);
    for (const event of events) {
      expect(event.position?.speed).toEqual(expect.any(Number));
      expect(event.position?.altitude).toEqual(expect.any(Number));
      const lat = event.position!.latitude;
      const lng = event.position!.longitude;
      expect(Number(lat.toFixed(6))).toBe(lat);
      expect(Number(lng.toFixed(6))).toBe(lng);
    }
  });

  it("never emits a speed above the category ceiling", () => {
    const path = zigzagPolyline(40);
    const profile = resolveVehicleProfile("truck", "Cargo truck");
    const startAt = "2026-07-27T12:00:00.000Z";
    const events = pathToEvents({
      targetId: "t1",
      path,
      startAt,
      endAt: feasibleEndAt(path, startAt, profile),
      vehicleCategory: "truck",
      vehicleSubtype: "Cargo truck",
      idFactory: idFactory(),
    });
    const ceiling = CATEGORY_TOP_SPEED_KNOTS.truck;
    for (const event of events) {
      expect(event.position!.speed!).toBeLessThanOrEqual(ceiling);
      expect(event.position!.speed!).toBeLessThanOrEqual(profile.maxKnots);
    }
  });

  it("keeps aircraft speeds within the profile cruise band when retimed", () => {
    const path = [
      { latitude: 51.47, longitude: -0.46, altitude: 0 },
      { latitude: 51.5, longitude: 2.0, altitude: 0 },
      { latitude: 51.55, longitude: 4.5, altitude: 0 },
      { latitude: 51.6, longitude: 7.0, altitude: 0 },
    ];
    const transport = resolveVehicleProfile("aircraft", "Transport");
    const startAt = "2026-07-27T12:00:00.000Z";
    const events = pathToEvents({
      targetId: "t1",
      path,
      startAt,
      endAt: feasibleEndAt(path, startAt, transport),
      vehicleCategory: "aircraft",
      vehicleSubtype: "Transport",
      idFactory: idFactory(),
    });

    const turnFloor = transport.cruiseKnots.minKnots * 0.35;
    for (const event of events) {
      expect(event.position!.speed!).toBeGreaterThanOrEqual(turnFloor - 0.5);
      expect(event.position!.speed!).toBeLessThanOrEqual(transport.maxKnots);
    }
    const cruiseSamples = events.filter(
      (e) => (e.position!.speed ?? 0) >= transport.cruiseKnots.minKnots * 0.9,
    );
    expect(cruiseSamples.length).toBeGreaterThan(0);
  });

  it("uses subtype cruise rather than the wide aircraft category band", () => {
    // ~200 nm eastbound great-circle-ish polyline for a transport hop.
    const path = [
      { latitude: 51.47, longitude: -0.46, altitude: 0 },
      { latitude: 51.5, longitude: 2.0, altitude: 0 },
      { latitude: 51.55, longitude: 4.5, altitude: 0 },
      { latitude: 51.6, longitude: 7.0, altitude: 0 },
    ];
    const transport = resolveVehicleProfile("aircraft", "Transport");
    const startAt = "2026-07-27T12:00:00.000Z";

    const events = pathToEvents({
      targetId: "t1",
      path,
      startAt,
      endAt: feasibleEndAt(path, startAt, transport),
      vehicleCategory: "aircraft",
      vehicleSubtype: "Transport",
      idFactory: idFactory(),
    });

    const speeds = events.map((e) => e.position!.speed!);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(transport.maxKnots);
    // Must not look like a 1,300 kt category sample.
    expect(Math.max(...speeds)).toBeLessThan(700);
  });

  it("builds climb and descent altitude following profile rates", () => {
    const profile = resolveVehicleProfile("aircraft", "Transport");
    // Long enough for a full climb to typical FL and descent.
    const path: Array<{ latitude: number; longitude: number; altitude?: number }> = [];
    for (let i = 0; i <= 60; i += 1) {
      path.push({
        latitude: 50 + i * 0.15,
        longitude: 0,
        altitude: i === 0 || i === 60 ? 0 : undefined,
      });
    }

    const startAt = "2026-07-27T12:00:00.000Z";

    const events = pathToEvents({
      targetId: "t1",
      path,
      startAt,
      endAt: feasibleEndAt(path, startAt, profile),
      vehicleCategory: "aircraft",
      vehicleSubtype: "Transport",
      idFactory: idFactory(),
    });

    const altitudes = events.map((e) => e.position!.altitude!);
    const peak = Math.max(...altitudes);
    expect(peak).toBeGreaterThan(profile.typicalFlightLevelFt * 0.85);
    expect(altitudes[0]).toBeLessThan(1_000);
    expect(altitudes[altitudes.length - 1]).toBeLessThan(1_000);

    const peakIndex = altitudes.indexOf(peak);
    expect(peakIndex).toBeGreaterThan(0);
    expect(peakIndex).toBeLessThan(altitudes.length - 1);
    // Monotonic-ish climb then descent (allow small DP noise).
    expect(altitudes[Math.floor(peakIndex / 2)]!).toBeGreaterThan(altitudes[0]!);
    expect(altitudes[Math.floor((peakIndex + altitudes.length) / 2)]!).toBeLessThan(peak + 1);
    // No forced zero mid-path once climbed.
    const midBand = altitudes.slice(
      Math.floor(altitudes.length * 0.35),
      Math.floor(altitudes.length * 0.65),
    );
    expect(Math.min(...midBand)).toBeGreaterThan(5_000);
  });

  it("climbs from 0 toward a high end altitude without forced landing", () => {
    const profile = resolveVehicleProfile("aircraft", "Transport");
    const endAlt = profile.typicalFlightLevelFt;
    const path = [
      { latitude: 50, longitude: 0, altitude: 0 },
      { latitude: 52, longitude: 4, altitude: endAlt },
      { latitude: 54, longitude: 8, altitude: endAlt },
    ];
    const startAt = "2026-07-27T12:00:00.000Z";

    const events = pathToEvents({
      targetId: "t1",
      path,
      startAt,
      endAt: feasibleEndAt(path, startAt, profile),
      vehicleCategory: "aircraft",
      vehicleSubtype: "Transport",
      idFactory: idFactory(),
    });

    const altitudes = events.map((e) => e.position!.altitude!);
    expect(altitudes[0]).toBe(0);
    expect(altitudes[altitudes.length - 1]).toBe(endAlt);
    const peak = Math.max(...altitudes);
    expect(peak).toBeGreaterThanOrEqual(endAlt * 0.9);
    // Approaches end: late samples near end altitude, not forced to 0.
    expect(altitudes[altitudes.length - 2]!).toBeGreaterThan(endAlt * 0.5);
  });

  it("keeps a flat non-zero cruise when start and end match cruise altitude", () => {
    const profile = resolveVehicleProfile("aircraft", "Transport");
    const cruise = profile.typicalFlightLevelFt;
    const path = [
      { latitude: 50, longitude: 0, altitude: cruise },
      { latitude: 51, longitude: 2, altitude: cruise },
      { latitude: 52, longitude: 4, altitude: cruise },
    ];
    const startAt = "2026-07-27T12:00:00.000Z";

    const events = pathToEvents({
      targetId: "t1",
      path,
      startAt,
      endAt: feasibleEndAt(path, startAt, profile),
      vehicleCategory: "aircraft",
      vehicleSubtype: "Transport",
      idFactory: idFactory(),
    });

    const altitudes = events.map((e) => e.position!.altitude!);
    expect(altitudes[0]).toBe(cruise);
    expect(altitudes[altitudes.length - 1]).toBe(cruise);
    for (const alt of altitudes) {
      expect(alt).toBeGreaterThan(cruise * 0.95);
      expect(alt).toBeLessThan(cruise * 1.05);
    }
  });

  it("rejects a window too short for the routed distance", () => {
    const path = [
      { latitude: 51.5, longitude: -0.1 },
      { latitude: 52.5, longitude: 1.5 },
      { latitude: 53.5, longitude: 3.0 },
    ];
    expect(() =>
      pathToEvents({
        targetId: "t1",
        path,
        startAt: "2026-07-27T12:00:00.000Z",
        endAt: "2026-07-27T12:05:00.000Z",
        vehicleCategory: "car",
        vehicleSubtype: "Sedan",
        idFactory: idFactory(),
      }),
    ).toThrow(/maximum of/);
  });

  it("rejects a window too long for the profile cruise floor", () => {
    // Short hop stretched over 24 h would author ~1–2 kt — below aircraft min.
    const path = [
      { latitude: 51.47, longitude: -0.46, altitude: 0 },
      { latitude: 51.5, longitude: -0.2, altitude: 0 },
    ];
    expect(() =>
      pathToEvents({
        targetId: "t1",
        path,
        startAt: "2026-07-27T12:00:00.000Z",
        endAt: "2026-07-28T12:00:00.000Z",
        vehicleCategory: "aircraft",
        vehicleSubtype: "Transport",
        idFactory: idFactory(),
      }),
    ).toThrow(/minimum of/);
  });

  it("preserves distance ≈ speed × time on consecutive events", () => {
    const path = cornerPolyline();
    const profile = resolveVehicleProfile("car", "Sedan");
    const startAt = "2026-07-27T12:00:00.000Z";
    const events = pathToEvents({
      targetId: "t1",
      path,
      startAt,
      endAt: feasibleEndAt(path, startAt, profile),
      vehicleCategory: "car",
      vehicleSubtype: "Sedan",
      idFactory: idFactory(),
    });

    for (let i = 1; i < events.length; i += 1) {
      const prev = events[i - 1]!;
      const curr = events[i]!;
      const hours = (Date.parse(curr.at) - Date.parse(prev.at)) / 3_600_000;
      if (hours < 1e-9) continue;
      const distanceNm = haversineDistanceNm(prev.position!, curr.position!);
      const implied = distanceNm / hours;
      expect(Math.abs(implied - curr.position!.speed!)).toBeLessThan(0.6);
    }
  });

  it("honors an explicit eventCount", () => {
    // Dense collinear samples — DP drops vertices but path length is preserved,
    // so the cruise-floor window stays valid after simplification.
    const path: Array<{ latitude: number; longitude: number }> = [];
    for (let i = 0; i <= 120; i += 1) {
      path.push({ latitude: 51.0 + i * 0.04, longitude: 0 });
    }
    const profile = resolveVehicleProfile("car", "Sedan");
    const startAt = "2026-07-27T12:00:00.000Z";
    const events = pathToEvents({
      targetId: "t1",
      path,
      startAt,
      endAt: feasibleEndAt(path, startAt, profile),
      vehicleCategory: "car",
      vehicleSubtype: "Sedan",
      eventCount: 40,
      idFactory: idFactory(),
    });
    expect(events).toHaveLength(40);
  });

  it("keeps loiter orbits curved even under a tight eventCount", () => {
    const centre = { latitude: 51.5, longitude: 0.5 };
    const radiusM = 3_000;
    const orbit = buildOrbit({
      centre,
      radiusM,
      turnRadiusM: 2_500,
      altitudeFt: 15_000,
      samples: 48,
    });
    // Cruise stubs so budget trim has room to flatten the hold without restore.
    const path = [
      { latitude: 51.5, longitude: -1.5, altitude: 15_000 },
      { latitude: 51.5, longitude: -0.5, altitude: 15_000 },
      ...orbit.map((p) => ({ ...p, altitude: 15_000 })),
      { latitude: 51.5, longitude: 1.5, altitude: 15_000 },
      { latitude: 51.5, longitude: 2.5, altitude: 15_000 },
    ];
    const profile = resolveVehicleProfile("aircraft", "UAV");
    const startAt = "2026-07-27T12:00:00.000Z";
    const events = pathToEvents({
      targetId: "t1",
      path,
      startAt,
      endAt: feasibleEndAt(path, startAt, profile),
      vehicleCategory: "aircraft",
      vehicleSubtype: "UAV",
      eventCount: 36,
      idFactory: idFactory(),
    });

    const radiusNm = metersToNm(radiusM);
    const onOrbit = events.filter((event) => {
      const d = haversineDistanceNm(centre, event.position!);
      return Math.abs(d - radiusNm) < radiusNm * 0.15;
    });
    // A diamond has ~4 corners; a readable curve needs a clear ring of samples.
    expect(onOrbit.length).toBeGreaterThanOrEqual(12);
    expect(events.length).toBeGreaterThanOrEqual(36);
  });
});

describe("restoreArcDetail", () => {
  it("reinserts arc vertices that budget simplification dropped", () => {
    const centre = { latitude: 51.5, longitude: 0.5 };
    const radiusM = 3_000;
    const walked = buildOrbit({
      centre,
      radiusM,
      turnRadiusM: 2_500,
      altitudeFt: 10_000,
      samples: 48,
    });
    // Diamond: every 12th sample (~90°).
    const diamond = [0, 12, 24, 36, 48].map((i) => walked[i]!);
    const restored = restoreArcDetail(walked, diamond, curveChordErrorM(2_500));
    expect(restored.length).toBeGreaterThan(diamond.length);
    expect(restored.length).toBeGreaterThanOrEqual(12);
  });
});

function profileMid(profile: ReturnType<typeof resolveVehicleProfile>) {
  return (profile.cruiseKnots.minKnots + profile.cruiseKnots.maxKnots) / 2;
}
