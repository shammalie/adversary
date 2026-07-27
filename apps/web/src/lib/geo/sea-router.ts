/**
 * Sea router — boats stay in navigable water.
 *
 * Preference order:
 * 1. Real `transportation class=ferry` LineStrings
 * 2. A* over a navigable grid from `water class=ocean|lake|dock` (z6–8 by default)
 * 3. Inland `waterway class=river|canal` graph when open-water routing is not applicable
 *
 * Returns a plain polyline. Events / timing / speeds are Phase 3's job.
 * Typed failure (never throws) when no navigable route exists.
 */

import {
  haversineMeters,
  pointInPolygon,
  type TerrainFeatureSource,
} from "@/lib/geo/terrain";
import {
  lngLatToTile,
  tileBounds,
  type DecodedTileFeature,
  type LngLat,
  type TileCoord,
  type VectorTileClient,
} from "@/lib/geo/vector-tile-client";

/** OpenMapTiles water classes treated as open navigable water for the grid. */
const GRID_WATER_CLASSES = new Set(["ocean", "lake", "dock"]);

const DEFAULT_GRID_ZOOM = 7;
const DEFAULT_CELLS_PER_TILE = 32;
const DEFAULT_FERRY_SNAP_M = 8_000;
const DEFAULT_PORT_SNAP_M = 25_000;
const DEFAULT_WATERWAY_SNAP_M = 2_500;
const SMOOTH_SEGMENT_SAMPLES = 12;

export type SeaRouteVia = "ferry" | "water-grid" | "waterway";

export type SeaRouteSuccess = {
  ok: true;
  coordinates: LngLat[];
  via: SeaRouteVia;
};

export type SeaRouteFailureReason =
  | "cancelled"
  | "no-navigable-route"
  | "endpoints-not-on-water";

export type SeaRouteFailure = {
  ok: false;
  reason: SeaRouteFailureReason;
  message: string;
};

export type SeaRouteResult = SeaRouteSuccess | SeaRouteFailure;

export type SeaSeedPort = {
  lng: number;
  lat: number;
  name?: string;
  kind?: string;
};

export type SeaSeedLane = {
  lng: number;
  lat: number;
};

export type SeaSeeds = {
  ports: readonly SeaSeedPort[];
  seaLanes: readonly SeaSeedLane[];
};

/** Columnar `ports` / `seaLanes` as emitted by `scripts/build-geo-seeds.mjs`. */
export type ColumnarSeaSeeds = {
  ports?: {
    lng: number[];
    lat: number[];
    name?: string[];
    kind?: string[];
  };
  seaLanes?: {
    lng: number[];
    lat: number[];
  };
};

export type SeaRouterOptions = {
  source: TerrainFeatureSource | VectorTileClient;
  signal?: AbortSignal;
  /** Harbour / ferry / sea-lane snaps from `geo-seeds.json`. */
  seeds?: SeaSeeds;
  /**
   * Zoom used to fetch water polygons for the navigable grid.
   * Production default is 7 (z6–8 band); tests override to match fixtures.
   */
  gridZoom?: number;
  /** Subdivision of each tile into an N×N cell grid. Default 32. */
  cellsPerTile?: number;
  /** Max distance to snap start/end onto a ferry line (metres). */
  ferrySnapM?: number;
  /** Max distance to snap start onto a port / sea-lane (metres). */
  portSnapM?: number;
  /** Max distance to snap onto a river/canal waterway (metres). */
  waterwaySnapM?: number;
};

export function unpackSeaSeeds(bundle: ColumnarSeaSeeds): SeaSeeds {
  const ports: SeaSeedPort[] = [];
  const p = bundle.ports;
  if (p) {
    const n = Math.min(p.lng.length, p.lat.length);
    for (let i = 0; i < n; i++) {
      ports.push({
        lng: p.lng[i]!,
        lat: p.lat[i]!,
        name: p.name?.[i],
        kind: p.kind?.[i],
      });
    }
  }
  const seaLanes: SeaSeedLane[] = [];
  const s = bundle.seaLanes;
  if (s) {
    const n = Math.min(s.lng.length, s.lat.length);
    for (let i = 0; i < n; i++) {
      seaLanes.push({ lng: s.lng[i]!, lat: s.lat[i]! });
    }
  }
  return { ports, seaLanes };
}

function checkAborted(signal?: AbortSignal): SeaRouteFailure | null {
  if (signal?.aborted) {
    return { ok: false, reason: "cancelled", message: "Sea route cancelled" };
  }
  return null;
}

function fail(
  reason: Exclude<SeaRouteFailureReason, "cancelled">,
  message: string,
): SeaRouteFailure {
  return { ok: false, reason, message };
}

function tilesCoveringBbox(
  west: number,
  south: number,
  east: number,
  north: number,
  z: number,
): TileCoord[] {
  const sw = lngLatToTile(west, south, z);
  const ne = lngLatToTile(east, north, z);
  const x0 = Math.min(sw.x, ne.x);
  const x1 = Math.max(sw.x, ne.x);
  const y0 = Math.min(sw.y, ne.y);
  const y1 = Math.max(sw.y, ne.y);
  const max = 2 ** z;
  const out: TileCoord[] = [];
  for (let x = Math.max(0, x0); x <= Math.min(max - 1, x1); x++) {
    for (let y = Math.max(0, y0); y <= Math.min(max - 1, y1); y++) {
      out.push({ z, x, y });
    }
  }
  return out;
}

function expandBbox(
  a: LngLat,
  b: LngLat,
  padDeg: number,
): [number, number, number, number] {
  const west = Math.min(a[0], b[0]) - padDeg;
  const east = Math.max(a[0], b[0]) + padDeg;
  const south = Math.min(a[1], b[1]) - padDeg;
  const north = Math.max(a[1], b[1]) + padDeg;
  return [
    Math.max(-180, west),
    Math.max(-85, south),
    Math.min(180, east),
    Math.min(85, north),
  ];
}

function closestPointOnSegment(p: LngLat, a: LngLat, b: LngLat): LngLat {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return a;
  const cosLat = Math.cos((py * Math.PI) / 180);
  const lx = (px - ax) * cosLat;
  const ly = py - ay;
  const sx = dx * cosLat;
  const sy = dy;
  const denom = sx * sx + sy * sy;
  if (denom === 0) return a;
  const t = Math.max(0, Math.min(1, (lx * sx + ly * sy) / denom));
  return [ax + dx * t, ay + dy * t];
}

function nearestOnLine(
  point: LngLat,
  line: LngLat[],
): { point: LngLat; distanceM: number; segIndex: number } | null {
  if (line.length === 0) return null;
  let bestPoint = line[0]!;
  let bestDist = haversineMeters(point, bestPoint);
  let bestSeg = 0;
  for (let i = 1; i < line.length; i++) {
    const closest = closestPointOnSegment(point, line[i - 1]!, line[i]!);
    const d = haversineMeters(point, closest);
    if (d < bestDist) {
      bestDist = d;
      bestPoint = closest;
      bestSeg = i - 1;
    }
  }
  return { point: bestPoint, distanceM: bestDist, segIndex: bestSeg };
}

function walkLineBetween(
  line: LngLat[],
  fromSeg: number,
  fromPt: LngLat,
  toSeg: number,
  toPt: LngLat,
): LngLat[] {
  if (fromSeg === toSeg) return [fromPt, toPt];
  const forward = fromSeg < toSeg;
  const coords: LngLat[] = [fromPt];
  if (forward) {
    for (let i = fromSeg + 1; i <= toSeg; i++) coords.push(line[i]!);
  } else {
    for (let i = fromSeg; i > toSeg; i--) coords.push(line[i]!);
  }
  coords.push(toPt);
  return coords;
}

function waterClassAtPoint(
  point: LngLat,
  features: DecodedTileFeature[],
): string | null {
  let best: string | null = null;
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

/** True when a WGS84 point sits in ocean/lake/dock water polygons. */
export function isNavigableWaterPoint(
  point: LngLat,
  waterFeatures: DecodedTileFeature[],
): boolean {
  const cls = waterClassAtPoint(point, waterFeatures);
  return cls !== null && GRID_WATER_CLASSES.has(cls);
}

/**
 * Sample a segment and require every sample to pass `isWater`.
 * Used to keep smoothed shortcuts off land.
 */
export function segmentStaysOnWater(
  a: LngLat,
  b: LngLat,
  isWater: (p: LngLat) => boolean,
  samples: number = SMOOTH_SEGMENT_SAMPLES,
): boolean {
  if (!isWater(a) || !isWater(b)) return false;
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const p: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (!isWater(p)) return false;
  }
  return true;
}

/**
 * Greedy line-of-sight smoothing. Never introduces a land-crossing shortcut.
 */
export function smoothWaterPath(
  path: LngLat[],
  isWater: (p: LngLat) => boolean,
): LngLat[] {
  if (path.length <= 2) return path.slice();
  const out: LngLat[] = [path[0]!];
  let i = 0;
  while (i < path.length - 1) {
    let best = i + 1;
    for (let j = path.length - 1; j > i + 1; j--) {
      if (segmentStaysOnWater(path[i]!, path[j]!, isWater)) {
        best = j;
        break;
      }
    }
    out.push(path[best]!);
    i = best;
  }
  return out;
}

function snapToSeeds(point: LngLat, seeds: SeaSeeds | undefined, maxM: number): LngLat {
  if (!seeds) return point;
  let best = point;
  let bestD = maxM;
  for (const port of seeds.ports) {
    const candidate: LngLat = [port.lng, port.lat];
    const d = haversineMeters(point, candidate);
    if (d < bestD) {
      bestD = d;
      best = candidate;
    }
  }
  for (const lane of seeds.seaLanes) {
    const candidate: LngLat = [lane.lng, lane.lat];
    const d = haversineMeters(point, candidate);
    if (d < bestD) {
      bestD = d;
      best = candidate;
    }
  }
  return best;
}

async function loadLayerTiles(
  source: TerrainFeatureSource | VectorTileClient,
  tiles: TileCoord[],
  layer: string,
  signal?: AbortSignal,
): Promise<Map<string, DecodedTileFeature[]>> {
  const map = new Map<string, DecodedTileFeature[]>();
  for (const t of tiles) {
    const aborted = checkAborted(signal);
    if (aborted) throw new DOMException(aborted.message, "AbortError");
    const key = `${t.z}/${t.x}/${t.y}`;
    const feats = await source.getLayerFeatures(t.z, t.x, t.y, layer, signal);
    map.set(key, feats);
  }
  return map;
}

function allFeatures(tileMap: Map<string, DecodedTileFeature[]>): DecodedTileFeature[] {
  const out: DecodedTileFeature[] = [];
  for (const feats of tileMap.values()) out.push(...feats);
  return out;
}

async function tryFerryRoute(
  origin: LngLat,
  destination: LngLat,
  source: TerrainFeatureSource | VectorTileClient,
  zoom: number,
  snapM: number,
  signal?: AbortSignal,
): Promise<LngLat[] | null> {
  const pad = Math.max(0.05, (snapM / 111_320) * 1.5);
  const [west, south, east, north] = expandBbox(origin, destination, pad);
  const tiles = tilesCoveringBbox(west, south, east, north, zoom);
  const tileMap = await loadLayerTiles(source, tiles, "transportation", signal);
  const ferries = allFeatures(tileMap).filter(
    (f) => f.type === 2 && String(f.properties.class ?? "") === "ferry",
  );
  if (ferries.length === 0) return null;

  let best: { coords: LngLat[]; score: number } | null = null;
  for (const ferry of ferries) {
    for (const line of ferry.geometry) {
      if (line.length < 2) continue;
      const nearO = nearestOnLine(origin, line);
      const nearD = nearestOnLine(destination, line);
      if (!nearO || !nearD) continue;
      if (nearO.distanceM > snapM || nearD.distanceM > snapM) continue;
      const along = walkLineBetween(
        line,
        nearO.segIndex,
        nearO.point,
        nearD.segIndex,
        nearD.point,
      );
      const coords: LngLat[] = [origin, ...along, destination];
      const score = nearO.distanceM + nearD.distanceM;
      if (!best || score < best.score) best = { coords, score };
    }
  }
  return best?.coords ?? null;
}

async function tryWaterwayRoute(
  origin: LngLat,
  destination: LngLat,
  source: TerrainFeatureSource | VectorTileClient,
  zoom: number,
  snapM: number,
  signal?: AbortSignal,
): Promise<LngLat[] | null> {
  const pad = Math.max(0.05, (snapM / 111_320) * 2);
  const [west, south, east, north] = expandBbox(origin, destination, pad);
  const tiles = tilesCoveringBbox(west, south, east, north, zoom);
  const tileMap = await loadLayerTiles(source, tiles, "waterway", signal);
  const ways = allFeatures(tileMap).filter((f) => {
    if (f.type !== 2) return false;
    const cls = String(f.properties.class ?? "");
    return cls === "river" || cls === "canal";
  });
  if (ways.length === 0) return null;

  // Build an undirected segment graph keyed by quantized endpoints, then A* on it.
  const Q = 4; // ~11 m
  const qKey = (p: LngLat): string =>
    `${p[0].toFixed(Q)},${p[1].toFixed(Q)}`;

  type Node = { id: string; point: LngLat };
  const nodes = new Map<string, Node>();
  const edges = new Map<string, { to: string; cost: number; via: LngLat[] }[]>();

  const ensure = (p: LngLat): string => {
    const id = qKey(p);
    if (!nodes.has(id)) nodes.set(id, { id, point: p });
    return id;
  };
  const link = (a: LngLat, b: LngLat) => {
    const ai = ensure(a);
    const bi = ensure(b);
    if (ai === bi) return;
    const cost = haversineMeters(a, b);
    const aList = edges.get(ai) ?? [];
    aList.push({ to: bi, cost, via: [a, b] });
    edges.set(ai, aList);
    const bList = edges.get(bi) ?? [];
    bList.push({ to: ai, cost, via: [b, a] });
    edges.set(bi, bList);
  };

  for (const way of ways) {
    for (const line of way.geometry) {
      for (let i = 1; i < line.length; i++) link(line[i - 1]!, line[i]!);
    }
  }
  if (nodes.size === 0) return null;

  const nearestNode = (p: LngLat): { id: string; distanceM: number } | null => {
    let best: { id: string; distanceM: number } | null = null;
    for (const n of nodes.values()) {
      const d = haversineMeters(p, n.point);
      if (d > snapM) continue;
      if (!best || d < best.distanceM) best = { id: n.id, distanceM: d };
    }
    return best;
  };

  const start = nearestNode(origin);
  const end = nearestNode(destination);
  if (!start || !end) return null;

  type Open = { id: string; g: number; f: number };
  const open: Open[] = [{ id: start.id, g: 0, f: haversineMeters(nodes.get(start.id)!.point, nodes.get(end.id)!.point) }];
  const came = new Map<string, { prev: string; via: LngLat[] }>();
  const gScore = new Map<string, number>([[start.id, 0]]);
  const closed = new Set<string>();

  while (open.length > 0) {
    const aborted = checkAborted(signal);
    if (aborted) throw new DOMException(aborted.message, "AbortError");
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    if (closed.has(current.id)) continue;
    if (current.id === end.id) {
      const pathPts: LngLat[] = [nodes.get(end.id)!.point];
      let cur = end.id;
      while (came.has(cur)) {
        const step = came.get(cur)!;
        for (let i = step.via.length - 2; i >= 0; i--) pathPts.push(step.via[i]!);
        cur = step.prev;
      }
      pathPts.reverse();
      return [origin, ...pathPts, destination];
    }
    closed.add(current.id);
    for (const edge of edges.get(current.id) ?? []) {
      if (closed.has(edge.to)) continue;
      const tentative = current.g + edge.cost;
      if (tentative >= (gScore.get(edge.to) ?? Infinity)) continue;
      came.set(edge.to, { prev: current.id, via: edge.via });
      gScore.set(edge.to, tentative);
      const h = haversineMeters(nodes.get(edge.to)!.point, nodes.get(end.id)!.point);
      open.push({ id: edge.to, g: tentative, f: tentative + h });
    }
  }
  return null;
}

type Grid = {
  cellDeg: number;
  navigable: Set<string>;
  /** Water features for continuous water-mask checks (smoothing). */
  waterFeatures: DecodedTileFeature[];
  zoom: number;
};

function cellKey(ix: number, iy: number): string {
  return `${ix},${iy}`;
}

function toCell(lng: number, lat: number, cellDeg: number): [number, number] {
  return [Math.floor(lng / cellDeg), Math.floor(lat / cellDeg)];
}

function cellCenter(ix: number, iy: number, cellDeg: number): LngLat {
  return [(ix + 0.5) * cellDeg, (iy + 0.5) * cellDeg];
}

async function buildNavigableGrid(
  origin: LngLat,
  destination: LngLat,
  source: TerrainFeatureSource | VectorTileClient,
  gridZoom: number,
  cellsPerTile: number,
  signal?: AbortSignal,
): Promise<Grid> {
  const cellDeg = 360 / 2 ** gridZoom / cellsPerTile;
  const pad = Math.max(cellDeg * 4, 0.15);
  const [west, south, east, north] = expandBbox(origin, destination, pad);
  const tiles = tilesCoveringBbox(west, south, east, north, gridZoom);
  const tileMap = await loadLayerTiles(source, tiles, "water", signal);
  const waterFeatures = allFeatures(tileMap);
  const navigable = new Set<string>();

  for (const t of tiles) {
    const aborted = checkAborted(signal);
    if (aborted) throw new DOMException(aborted.message, "AbortError");
    const bounds = tileBounds(t.z, t.x, t.y);
    const feats = tileMap.get(`${t.z}/${t.x}/${t.y}`) ?? [];
    if (feats.length === 0) continue;
    // Iterate cells that overlap this tile
    const ix0 = Math.floor(bounds.west / cellDeg);
    const ix1 = Math.floor((bounds.east - 1e-12) / cellDeg);
    const iy0 = Math.floor(bounds.south / cellDeg);
    const iy1 = Math.floor((bounds.north - 1e-12) / cellDeg);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const center = cellCenter(ix, iy, cellDeg);
        if (center[0] < bounds.west || center[0] > bounds.east) continue;
        if (center[1] < bounds.south || center[1] > bounds.north) continue;
        if (isNavigableWaterPoint(center, feats)) {
          navigable.add(cellKey(ix, iy));
        }
      }
    }
  }

  return { cellDeg, navigable, waterFeatures, zoom: gridZoom };
}

function snapToNavigableCell(
  point: LngLat,
  grid: Grid,
  maxCells = 12,
): { cell: [number, number]; point: LngLat } | null {
  const [cx, cy] = toCell(point[0], point[1], grid.cellDeg);
  if (grid.navigable.has(cellKey(cx, cy))) {
    return { cell: [cx, cy], point };
  }
  let bestCell: [number, number] | null = null;
  let bestPoint: LngLat | null = null;
  let bestD = Infinity;
  for (let r = 1; r <= maxCells; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const ix = cx + dx;
        const iy = cy + dy;
        if (!grid.navigable.has(cellKey(ix, iy))) continue;
        const p = cellCenter(ix, iy, grid.cellDeg);
        const d = haversineMeters(point, p);
        if (d < bestD) {
          bestD = d;
          bestCell = [ix, iy];
          bestPoint = p;
        }
      }
    }
    if (bestCell && bestPoint) {
      return { cell: bestCell, point: bestPoint };
    }
  }
  return null;
}

const NEIGHBOURS8: ReadonlyArray<[number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

function astarWaterGrid(
  start: [number, number],
  goal: [number, number],
  grid: Grid,
  signal?: AbortSignal,
): LngLat[] | null {
  const startKey = cellKey(start[0], start[1]);
  const goalKey = cellKey(goal[0], goal[1]);
  if (!grid.navigable.has(startKey) || !grid.navigable.has(goalKey)) return null;

  const heuristic = (ix: number, iy: number): number => {
    const dx = ix - goal[0];
    const dy = iy - goal[1];
    return Math.hypot(dx, dy);
  };

  type Open = { key: string; ix: number; iy: number; g: number; f: number };
  const open: Open[] = [
    { key: startKey, ix: start[0], iy: start[1], g: 0, f: heuristic(start[0], start[1]) },
  ];
  const came = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const closed = new Set<string>();
  let expansions = 0;

  while (open.length > 0) {
    if (expansions++ % 64 === 0) {
      const aborted = checkAborted(signal);
      if (aborted) throw new DOMException(aborted.message, "AbortError");
    }
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    if (closed.has(current.key)) continue;
    if (current.key === goalKey) {
      const keys = [goalKey];
      let cur = goalKey;
      while (came.has(cur)) {
        cur = came.get(cur)!;
        keys.push(cur);
      }
      keys.reverse();
      return keys.map((k) => {
        const [sx, sy] = k.split(",").map(Number) as [number, number];
        return cellCenter(sx, sy, grid.cellDeg);
      });
    }
    closed.add(current.key);
    for (const [dx, dy] of NEIGHBOURS8) {
      const nix = current.ix + dx;
      const niy = current.iy + dy;
      const nkey = cellKey(nix, niy);
      if (!grid.navigable.has(nkey) || closed.has(nkey)) continue;
      const step = Math.hypot(dx, dy);
      const tentative = current.g + step;
      if (tentative >= (gScore.get(nkey) ?? Infinity)) continue;
      came.set(nkey, current.key);
      gScore.set(nkey, tentative);
      open.push({
        key: nkey,
        ix: nix,
        iy: niy,
        g: tentative,
        f: tentative + heuristic(nix, niy),
      });
    }
  }
  return null;
}

function makeWaterPredicate(grid: Grid): (p: LngLat) => boolean {
  return (p: LngLat) => isNavigableWaterPoint(p, grid.waterFeatures);
}

/**
 * Route a vessel from origin to destination through navigable water only.
 * Prefer ferry lines when both ends snap onto the same ferry; otherwise
 * water-grid A*; finally river/canal waterways for inland cases.
 */
export async function routeSea(
  origin: LngLat,
  destination: LngLat,
  options: SeaRouterOptions,
): Promise<SeaRouteResult> {
  const aborted0 = checkAborted(options.signal);
  if (aborted0) return aborted0;

  const gridZoom = options.gridZoom ?? DEFAULT_GRID_ZOOM;
  const cellsPerTile = options.cellsPerTile ?? DEFAULT_CELLS_PER_TILE;
  const ferrySnapM = options.ferrySnapM ?? DEFAULT_FERRY_SNAP_M;
  const portSnapM = options.portSnapM ?? DEFAULT_PORT_SNAP_M;
  const waterwaySnapM = options.waterwaySnapM ?? DEFAULT_WATERWAY_SNAP_M;
  const { source, signal, seeds } = options;

  const start = snapToSeeds(origin, seeds, portSnapM);
  const end = snapToSeeds(destination, seeds, portSnapM);

  try {
    // 1. Prefer real ferry crossings.
    const ferry = await tryFerryRoute(start, end, source, gridZoom, ferrySnapM, signal);
    if (ferry && ferry.length >= 2) {
      return { ok: true, coordinates: ferry, via: "ferry" };
    }

    // 2. Open-water / lake grid A*.
    const grid = await buildNavigableGrid(
      start,
      end,
      source,
      gridZoom,
      cellsPerTile,
      signal,
    );
    const snapStart = snapToNavigableCell(start, grid);
    const snapEnd = snapToNavigableCell(end, grid);
    if (snapStart && snapEnd) {
      const raw = astarWaterGrid(snapStart.cell, snapEnd.cell, grid, signal);
      if (raw && raw.length >= 1) {
        const isWater = makeWaterPredicate(grid);
        // Ensure endpoints and path stay on water after smoothing.
        const seeded: LngLat[] = [snapStart.point, ...raw, snapEnd.point];
        // Deduplicate consecutive equals
        const dedup: LngLat[] = [];
        for (const p of seeded) {
          const last = dedup[dedup.length - 1];
          if (!last || last[0] !== p[0] || last[1] !== p[1]) dedup.push(p);
        }
        const smoothed = smoothWaterPath(dedup, isWater);
        for (const p of smoothed) {
          if (!isWater(p)) {
            // Fall through to waterway rather than returning a land vertex.
            return tryInlandOrFail(start, end, source, gridZoom, waterwaySnapM, signal);
          }
        }
        // Re-validate every consecutive segment (smoothing contract).
        for (let i = 1; i < smoothed.length; i++) {
          if (!segmentStaysOnWater(smoothed[i - 1]!, smoothed[i]!, isWater)) {
            // Keep the unsmoothed grid path (cell centres are navigable by construction).
            return { ok: true, coordinates: dedup, via: "water-grid" };
          }
        }
        return { ok: true, coordinates: smoothed, via: "water-grid" };
      }
    }

    // 3. Inland river / canal.
    return tryInlandOrFail(start, end, source, gridZoom, waterwaySnapM, signal);
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      return { ok: false, reason: "cancelled", message: "Sea route cancelled" };
    }
    throw error;
  }
}

async function tryInlandOrFail(
  start: LngLat,
  end: LngLat,
  source: TerrainFeatureSource | VectorTileClient,
  zoom: number,
  waterwaySnapM: number,
  signal?: AbortSignal,
): Promise<SeaRouteResult> {
  const waterway = await tryWaterwayRoute(
    start,
    end,
    source,
    zoom,
    waterwaySnapM,
    signal,
  );
  if (waterway && waterway.length >= 2) {
    return { ok: true, coordinates: waterway, via: "waterway" };
  }
  return fail(
    "no-navigable-route",
    "No navigable sea, lake, ferry, or waterway route between endpoints",
  );
}

/** Map a sea-router result into the worker protocol response fields. */
export function seaRouteToWorkerCoordinates(
  result: SeaRouteResult,
): { ok: true; coordinates: { longitude: number; latitude: number }[] } | SeaRouteFailure {
  if (!result.ok) return result;
  return {
    ok: true,
    coordinates: result.coordinates.map(([longitude, latitude]) => ({
      longitude,
      latitude,
    })),
  };
}
