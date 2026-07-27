import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

import {
  clearTileSourceCache,
  fetchTileBytes,
  resolveTileUrlTemplate,
  type TileUrlTemplate,
} from "@/lib/geo/tile-source";

/** OpenMapTiles / MVT default extent (verified by the gate spike). */
export const DEFAULT_TILE_EXTENT = 4096;

export type LngLat = [longitude: number, latitude: number];

export type TileCoord = {
  z: number;
  x: number;
  y: number;
};

export type TileBounds = {
  west: number;
  east: number;
  north: number;
  south: number;
};

export type DecodedTileFeature = {
  id?: number;
  type: 0 | 1 | 2 | 3;
  properties: Record<string, number | string | boolean>;
  /** Rings of projected lng/lat coordinates (tile local → WGS84). */
  geometry: LngLat[][];
};

type CacheKey = string;

function cacheKey(z: number, x: number, y: number, layer: string): CacheKey {
  return `${z}/${x}/${y}/${layer}`;
}

class LruCache<V> {
  private readonly map = new Map<CacheKey, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: CacheKey): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Refresh insertion order (most-recently used at the end).
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: CacheKey, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/** Web Mercator tile index for a lng/lat at integer zoom. */
export function lngLatToTile(lng: number, lat: number, z: number): TileCoord {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { z, x, y };
}

/** Geographic bounds of a web-mercator tile (no buffer). */
export function tileBounds(z: number, x: number, y: number): TileBounds {
  const n = 2 ** z;
  return {
    west: (x / n) * 360 - 180,
    east: ((x + 1) / n) * 360 - 180,
    north: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
    south: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI,
  };
}

/**
 * Project a tile-local pixel (extent units) to WGS84 lng/lat.
 * Ported from the gate spike — tiles use extent 4096 and carry a seam buffer.
 */
export function tileLocalToLngLat(
  z: number,
  x: number,
  y: number,
  px: number,
  py: number,
  extent: number = DEFAULT_TILE_EXTENT,
): LngLat {
  const n = 2 ** z;
  const lng = ((x + px / extent) / n) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n))) * 180) / Math.PI;
  return [lng, lat];
}

export function decodeLayerFeatures(
  bytes: ArrayBuffer | Uint8Array,
  z: number,
  x: number,
  y: number,
  layerName: string,
): DecodedTileFeature[] {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const tile = new VectorTile(new PbfReader(buf));
  const layer = tile.layers[layerName];
  if (!layer) return [];

  const extent = layer.extent || DEFAULT_TILE_EXTENT;
  const features: DecodedTileFeature[] = [];
  for (let i = 0; i < layer.length; i += 1) {
    const feature = layer.feature(i);
    const geometry = feature.loadGeometry().map((ring) =>
      ring.map((point) => tileLocalToLngLat(z, x, y, point.x, point.y, extent)),
    );
    features.push({
      id: feature.id,
      type: feature.type,
      properties: { ...feature.properties },
      geometry,
    });
  }
  return features;
}

export type VectorTileClientOptions = {
  /** Max decoded layer entries retained in memory. */
  maxEntries?: number;
  /** Override TileJSON URL (defaults to `VITE_GEO_TILEJSON_URL`). */
  tileJsonUrl?: string;
};

/**
 * Fetch, decode, and LRU-cache vector tile layers.
 * Accepts AbortSignal so phase 4a can cancel in-flight generation.
 */
export class VectorTileClient {
  private readonly cache: LruCache<DecodedTileFeature[]>;
  private readonly tileJsonUrl?: string;
  private templatePromise: Promise<TileUrlTemplate> | null = null;

  constructor(options: VectorTileClientOptions = {}) {
    this.cache = new LruCache(options.maxEntries ?? 64);
    this.tileJsonUrl = options.tileJsonUrl;
  }

  private resolveTemplate(signal?: AbortSignal): Promise<TileUrlTemplate> {
    if (!this.templatePromise) {
      this.templatePromise = resolveTileUrlTemplate(this.tileJsonUrl, signal).catch((error) => {
        this.templatePromise = null;
        throw error;
      });
    }
    return this.templatePromise;
  }

  async getLayerFeatures(
    z: number,
    x: number,
    y: number,
    layer: string,
    signal?: AbortSignal,
  ): Promise<DecodedTileFeature[]> {
    const key = cacheKey(z, x, y, layer);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const template = await this.resolveTemplate(signal);
    const bytes = await fetchTileBytes(template, z, x, y, signal);
    const features = decodeLayerFeatures(bytes, z, x, y, layer);
    this.cache.set(key, features);
    return features;
  }

  clearCache(): void {
    this.cache.clear();
    this.templatePromise = null;
    clearTileSourceCache();
  }
}
