import { env } from "@adversary/env/web";

export type TileUrlTemplate = string;

type TileJson = {
  tiles?: unknown;
};

type CacheEntry = {
  tileJsonUrl: string;
  template: TileUrlTemplate;
};

let cached: CacheEntry | null = null;

function isGzipFramed(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Some tile servers return gzip-compressed bodies without Content-Encoding.
 * Detect the gzip magic bytes and inflate via DecompressionStream.
 */
export async function maybeGunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(buffer);
  if (!isGzipFramed(bytes)) return buffer;
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Gzip-framed tile body requires DecompressionStream");
  }
  const stream = new Response(buffer).body?.pipeThrough(new DecompressionStream("gzip"));
  if (!stream) throw new Error("Failed to open gzip stream for tile body");
  return new Response(stream).arrayBuffer();
}

function pickTileTemplate(tileJson: TileJson): TileUrlTemplate {
  const tiles = tileJson.tiles;
  if (!Array.isArray(tiles) || typeof tiles[0] !== "string" || tiles[0].length === 0) {
    throw new Error("TileJSON response missing tiles[0] URL template");
  }
  return tiles[0];
}

/** Fetch TileJSON once per URL and cache the `{z}/{x}/{y}` template. */
export async function resolveTileUrlTemplate(
  tileJsonUrl: string = env.VITE_GEO_TILEJSON_URL,
  signal?: AbortSignal,
): Promise<TileUrlTemplate> {
  if (cached?.tileJsonUrl === tileJsonUrl) return cached.template;

  const response = await fetch(tileJsonUrl, { signal });
  if (!response.ok) {
    throw new Error(`TileJSON fetch failed (${response.status}): ${tileJsonUrl}`);
  }

  const raw = await response.arrayBuffer();
  const body = await maybeGunzip(raw);
  const tileJson = JSON.parse(new TextDecoder().decode(body)) as TileJson;
  const template = pickTileTemplate(tileJson);
  cached = { tileJsonUrl, template };
  return template;
}

/** Clear the in-memory TileJSON template cache (tests / URL changes). */
export function clearTileSourceCache(): void {
  cached = null;
}

export function buildTileUrl(template: TileUrlTemplate, z: number, x: number, y: number): string {
  return template
    .replaceAll("{z}", String(z))
    .replaceAll("{x}", String(x))
    .replaceAll("{y}", String(y));
}

export async function fetchTileBytes(
  template: TileUrlTemplate,
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const url = buildTileUrl(template, z, x, y);
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Tile fetch failed (${response.status}): ${url}`);
  }
  return maybeGunzip(await response.arrayBuffer());
}
