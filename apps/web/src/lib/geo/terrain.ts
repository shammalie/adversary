import {
  decodeLayerFeatures,
  lngLatToTile,
  type DecodedTileFeature,
  type LngLat,
  type VectorTileClient,
} from "@/lib/geo/vector-tile-client";

/** OpenMapTiles water `class` values treated as navigable for boats. */
export const NAVIGABLE_WATER_CLASSES = ["ocean", "lake", "dock"] as const;
export type NavigableWaterClass = (typeof NAVIGABLE_WATER_CLASSES)[number];

export type WaterClass = NavigableWaterClass | "river" | string | null;

export type NearestRoad = {
  class: string;
  distanceM: number;
  point: LngLat;
};

export type TerrainClassification = {
  /** Water polygon class under the point, or null if on land / unknown. */
  waterClass: WaterClass;
  isWater: boolean;
  isNavigableWater: boolean;
  nearestRoad: NearestRoad | null;
};

/** Anything that can supply decoded layer features (client or test double). */
export type TerrainFeatureSource = {
  getLayerFeatures(
    z: number,
    x: number,
    y: number,
    layer: string,
    signal?: AbortSignal,
  ): Promise<DecodedTileFeature[]>;
};

export type ClassifyPointOptions = {
  signal?: AbortSignal;
  /** Zoom for water point-in-polygon (default 9). */
  waterZoom?: number;
  /** Zoom for nearest-road search (default 12). */
  roadZoom?: number;
  /** Ignore roads farther than this (meters). Default 2500. */
  maxRoadDistanceM?: number;
};

const DEFAULT_MAX_ATTEMPTS = 24;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in meters. */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const R = 6_371_000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Ray-casting point-in-ring (ring may be open or closed). */
export function pointInRing(point: LngLat, ring: LngLat[]): boolean {
  if (ring.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Polygon with optional holes: first ring is outer, subsequent rings are holes
 * (OpenMapTiles / GeoJSON winding convention as emitted by vector-tile).
 */
export function pointInPolygon(point: LngLat, rings: LngLat[][]): boolean {
  if (rings.length === 0) return false;
  if (!pointInRing(point, rings[0]!)) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(point, rings[i]!)) return false;
  }
  return true;
}

function closestPointOnSegment(p: LngLat, a: LngLat, b: LngLat): LngLat {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return a;
  // Local equirectangular metres for short segments
  const cosLat = Math.cos(toRad(py));
  const lx = (px - ax) * cosLat;
  const ly = py - ay;
  const sx = dx * cosLat;
  const sy = dy;
  const t = Math.max(0, Math.min(1, (lx * sx + ly * sy) / (sx * sx + sy * sy)));
  return [ax + dx * t, ay + dy * t];
}

const DRIVABLE_ROAD = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
]);

function nearestRoadInFeatures(
  point: LngLat,
  features: DecodedTileFeature[],
  maxDistanceM: number,
): NearestRoad | null {
  let best: NearestRoad | null = null;
  for (const feat of features) {
    if (feat.type !== 2) continue;
    const cls = String(feat.properties.class ?? "");
    if (!DRIVABLE_ROAD.has(cls)) continue;
    for (const line of feat.geometry) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1]!;
        const b = line[i]!;
        const closest = closestPointOnSegment(point, a, b);
        const distanceM = haversineMeters(point, closest);
        if (distanceM > maxDistanceM) continue;
        if (!best || distanceM < best.distanceM) {
          best = { class: cls, distanceM, point: closest };
        }
      }
    }
  }
  return best;
}

function waterClassAtPoint(point: LngLat, features: DecodedTileFeature[]): WaterClass {
  let best: WaterClass = null;
  // Prefer more specific / navigable classes when polygons overlap
  const rank = (c: string): number => {
    if (c === "ocean") return 4;
    if (c === "lake") return 3;
    if (c === "dock") return 2;
    if (c === "river") return 1;
    return 0;
  };
  for (const feat of features) {
    if (feat.type !== 3) continue;
    if (!pointInPolygon(point, feat.geometry)) continue;
    const cls = String(feat.properties.class ?? "water");
    if (!best || rank(cls) > rank(best)) best = cls;
  }
  return best;
}

/**
 * Classify a WGS84 point against OpenMapTiles water polygons and nearby roads.
 * Water is probed at z8–10 (default z9); roads at a higher zoom for density.
 */
export async function classifyPoint(
  source: TerrainFeatureSource | VectorTileClient,
  lngLat: LngLat,
  options: ClassifyPointOptions = {},
): Promise<TerrainClassification> {
  const waterZoom = options.waterZoom ?? 9;
  const roadZoom = options.roadZoom ?? 12;
  const maxRoadDistanceM = options.maxRoadDistanceM ?? 2500;
  const { signal } = options;

  const waterTile = lngLatToTile(lngLat[0], lngLat[1], waterZoom);
  const roadTile = lngLatToTile(lngLat[0], lngLat[1], roadZoom);

  const [waterFeatures, roadFeatures] = await Promise.all([
    source.getLayerFeatures(waterTile.z, waterTile.x, waterTile.y, "water", signal),
    source.getLayerFeatures(roadTile.z, roadTile.x, roadTile.y, "transportation", signal),
  ]);

  const waterClass = waterClassAtPoint(lngLat, waterFeatures);
  const isWater = waterClass !== null;
  const isNavigableWater =
    waterClass !== null &&
    (NAVIGABLE_WATER_CLASSES as readonly string[]).includes(waterClass);

  return {
    waterClass,
    isWater,
    isNavigableWater,
    nearestRoad: nearestRoadInFeatures(lngLat, roadFeatures, maxRoadDistanceM),
  };
}

export type PlacementCategory = "aircraft" | "boat" | "car" | "truck" | "other";

export type SampleValidPointOptions = {
  category: PlacementCategory;
  /** Inclusive WGS84 bbox [west, south, east, north]. Defaults to world (±85 lat). */
  bbox?: [west: number, south: number, east: number, north: number];
  random: () => number;
  /** Hard cap on classify attempts. Default 24. Never unbounded. */
  maxAttempts?: number;
  signal?: AbortSignal;
  classifyOptions?: ClassifyPointOptions;
};

function randomInBbox(
  bbox: [number, number, number, number],
  random: () => number,
): LngLat {
  const [west, south, east, north] = bbox;
  const lng = west + random() * (east - west);
  const lat = south + random() * (north - south);
  return [lng, lat];
}

function acceptsCategory(
  category: PlacementCategory,
  terrain: TerrainClassification,
): boolean {
  switch (category) {
    case "boat":
      return terrain.isNavigableWater;
    case "car":
    case "truck":
      return !terrain.isNavigableWater && terrain.nearestRoad !== null;
    case "aircraft":
      // Aerodrome selection comes from the seed bundle; terrain always accepts.
      return true;
    case "other":
      return terrain.isNavigableWater || terrain.nearestRoad !== null;
    default:
      return false;
  }
}

/**
 * Rejection-sample a point that is valid for `category`, with a **bounded**
 * attempt budget. Returns null when no valid sample is found (caller relocates).
 */
export async function sampleValidPoint(
  source: TerrainFeatureSource | VectorTileClient,
  options: SampleValidPointOptions,
): Promise<{ point: LngLat; terrain: TerrainClassification } | null> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const bbox = options.bbox ?? ([-180, -85, 180, 85] as const);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    options.signal?.throwIfAborted?.();
    const point = randomInBbox(
      bbox as [number, number, number, number],
      options.random,
    );
    const terrain = await classifyPoint(source, point, {
      ...options.classifyOptions,
      signal: options.signal,
    });
    if (acceptsCategory(options.category, terrain)) {
      return { point, terrain };
    }
  }
  return null;
}

/** Build a fixture-backed feature source from committed `.pbf` tile bytes. */
export function createFixtureFeatureSource(
  tiles: ReadonlyArray<{
    z: number;
    x: number;
    y: number;
    bytes: ArrayBuffer | Uint8Array;
  }>,
): TerrainFeatureSource {
  const map = new Map<string, ArrayBuffer | Uint8Array>();
  for (const t of tiles) {
    map.set(`${t.z}/${t.x}/${t.y}`, t.bytes);
  }
  return {
    async getLayerFeatures(z, x, y, layer) {
      const bytes = map.get(`${z}/${x}/${y}`);
      if (!bytes) return [];
      return decodeLayerFeatures(bytes, z, x, y, layer);
    },
  };
}
