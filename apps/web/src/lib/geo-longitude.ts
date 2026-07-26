/** Normalize longitude into the canonical storage range [-180, 180]. */
export function normalizeLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) return longitude;
  const wrapped = ((((longitude + 180) % 360) + 360) % 360) - 180;
  // Map 180 and -180 to the same edge; prefer 180 only when input was exactly 180.
  return wrapped === -180 ? 180 : wrapped;
}

/**
 * Shortest signed longitude delta from `from` to `to`, in (-180, 180].
 * Positive = eastward.
 */
export function shortestLongitudeDelta(from: number, to: number): number {
  return normalizeLongitude(to - from);
}

export type LngLatTuple = [longitude: number, latitude: number];

/**
 * Unwrap consecutive LineString longitudes so each step is a short arc
 * (|Δlng| ≤ 180). Resulting longitudes may leave [-180, 180] for MapLibre
 * world-copy rendering across the antimeridian.
 */
export function unwrapLineLongitudes(coordinates: LngLatTuple[]): LngLatTuple[] {
  if (coordinates.length === 0) return [];

  const result: LngLatTuple[] = [[coordinates[0]![0], coordinates[0]![1]]];
  for (let index = 1; index < coordinates.length; index += 1) {
    const [lng, lat] = coordinates[index]!;
    const prevLng = result[index - 1]![0];
    const unwrapped = prevLng + shortestLongitudeDelta(prevLng, lng);
    result.push([unwrapped, lat]);
  }
  return result;
}

export interface LngLatPoint {
  longitude: number;
  latitude: number;
}

/** Southwest / northeast corners suitable for MapLibre fitBounds. */
export type LngLatBoundsCorners = [[west: number, south: number], [east: number, north: number]];

/**
 * Smallest covering longitude span on the circle, plus lat min/max.
 * Points spanning the antimeridian (e.g. 170° and -170°) produce a tight
 * Pacific box instead of nearly the whole world.
 */
export function lngLatBoundsForPoints(points: LngLatPoint[]): LngLatBoundsCorners | null {
  if (points.length === 0) return null;

  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  const longitudes: number[] = [];

  for (const point of points) {
    if (!Number.isFinite(point.longitude) || !Number.isFinite(point.latitude)) continue;
    longitudes.push(normalizeLongitude(point.longitude));
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
  }

  if (longitudes.length === 0 || !Number.isFinite(south) || !Number.isFinite(north)) {
    return null;
  }

  if (longitudes.length === 1) {
    const lng = longitudes[0]!;
    return [
      [lng, south],
      [lng, north],
    ];
  }

  const sorted = [...longitudes].toSorted((a, b) => a - b);
  let largestGap = 0;
  let gapAfterIndex = 0;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const gap = sorted[index + 1]! - sorted[index]!;
    if (gap > largestGap) {
      largestGap = gap;
      gapAfterIndex = index;
    }
  }
  const wrapGap = sorted[0]! + 360 - sorted[sorted.length - 1]!;
  if (wrapGap > largestGap) {
    // Covering arc does not cross the dateline in stored coords.
    return [
      [sorted[0]!, south],
      [sorted[sorted.length - 1]!, north],
    ];
  }

  // Largest empty gap is interior; covering arc wraps across ±180.
  // West edge is the point just after the gap; east is unwrapped past 180.
  const west = sorted[gapAfterIndex + 1]!;
  const east = sorted[gapAfterIndex]! + 360;
  return [
    [west, south],
    [east, north],
  ];
}
