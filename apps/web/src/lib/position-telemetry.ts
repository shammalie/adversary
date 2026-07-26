import { normalizeLongitude, shortestLongitudeDelta } from "@/lib/geo-longitude";
import { clampSpeedToCategory } from "@/lib/vehicle-speed";
import type { PositionPayload, PositionSnapshot, VehicleCategory } from "@/types/target";

const EARTH_RADIUS_NM = 3440.065;

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

export function haversineDistanceNm(
  from: Pick<PositionPayload, "latitude" | "longitude">,
  to: Pick<PositionPayload, "latitude" | "longitude">,
) {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLng = toRadians(shortestLongitudeDelta(from.longitude, to.longitude));
  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function initialBearingDegrees(
  from: Pick<PositionPayload, "latitude" | "longitude">,
  to: Pick<PositionPayload, "latitude" | "longitude">,
) {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLng = toRadians(shortestLongitudeDelta(from.longitude, to.longitude));
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function destinationPoint(
  origin: Pick<PositionPayload, "latitude" | "longitude">,
  distanceNm: number,
  bearingDegrees: number,
): Pick<PositionPayload, "latitude" | "longitude"> {
  const angularDistance = distanceNm / EARTH_RADIUS_NM;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(origin.latitude);
  const lng1 = toRadians(origin.longitude);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { latitude: toDegrees(lat2), longitude: normalizeLongitude(toDegrees(lng2)) };
}

export function derivePositionSnapshot(
  current: PositionPayload,
  at: string,
  previous?: PositionSnapshot,
  vehicleCategory?: VehicleCategory,
): PositionSnapshot {
  const altitude = current.altitude ?? previous?.altitude ?? 0;
  const authoredSpeed =
    typeof current.speed === "number" && Number.isFinite(current.speed)
      ? Number(current.speed.toFixed(1))
      : undefined;

  if (!previous) {
    return {
      latitude: current.latitude,
      longitude: current.longitude,
      altitude,
      speed: authoredSpeed ?? 0,
      heading: 0,
      course: 0,
      at,
    };
  }

  const elapsedHours = Math.max((Date.parse(at) - Date.parse(previous.at)) / 3_600_000, 0);
  const distanceNm = haversineDistanceNm(previous, current);
  const bearing = initialBearingDegrees(previous, current);
  // Prefer authored speed from generated routes; only derive when omitted,
  // and never exceed the vehicle category top speed.
  const derivedSpeed = elapsedHours > 0 ? distanceNm / elapsedHours : 0;
  const speed = clampSpeedToCategory(authoredSpeed ?? derivedSpeed, vehicleCategory);

  return {
    latitude: current.latitude,
    longitude: current.longitude,
    altitude,
    speed: Number(speed.toFixed(1)),
    heading: Number(bearing.toFixed(1)),
    course: Number(bearing.toFixed(1)),
    at,
  };
}

export function interpolatePositionSnapshot(
  from: PositionSnapshot,
  to: PositionPayload,
  fromTimeMs: number,
  toTimeMs: number,
  currentTimeMs: number,
  vehicleCategory?: VehicleCategory,
): PositionSnapshot {
  if (currentTimeMs <= fromTimeMs) return from;
  if (currentTimeMs >= toTimeMs) {
    return derivePositionSnapshot(to, new Date(toTimeMs).toISOString(), from, vehicleCategory);
  }

  const progress = (currentTimeMs - fromTimeMs) / (toTimeMs - fromTimeMs);
  const distanceNm = haversineDistanceNm(from, to);
  const bearing = initialBearingDegrees(from, to);
  const point = destinationPoint(from, distanceNm * progress, bearing);
  const elapsedHours = (currentTimeMs - fromTimeMs) / 3_600_000;

  // Prefer authored endpoint speed (set by route generation). Fall back to
  // distance/time, then clamp to the vehicle top speed.
  const authoredSpeed =
    typeof to.speed === "number" && Number.isFinite(to.speed) ? to.speed : undefined;
  const geometricSpeed = elapsedHours > 0 ? (distanceNm * progress) / elapsedHours : 0;
  const speed = clampSpeedToCategory(authoredSpeed ?? geometricSpeed, vehicleCategory);

  return {
    latitude: point.latitude,
    longitude: point.longitude,
    altitude: to.altitude ?? from.altitude,
    speed: Number(speed.toFixed(1)),
    heading: Number(bearing.toFixed(1)),
    course: Number(bearing.toFixed(1)),
    at: new Date(currentTimeMs).toISOString(),
  };
}

export function hasEventPayload(event: { position?: PositionPayload; message?: string }) {
  return Boolean(event.position || event.message?.trim());
}
