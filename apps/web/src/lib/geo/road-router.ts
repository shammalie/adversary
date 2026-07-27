/**
 * Hierarchical road router (Phase 2a).
 *
 * Cars/trucks follow real OpenMapTiles `transportation` LineStrings.
 * Returns a plain polyline only — no events, timing, or speeds (Phase 3).
 *
 * Locked gate parameters:
 * - Quantize nodes to 5 decimal places; no snap tolerance
 * - Filter to arterial/drivable before building the graph
 * - Snap endpoints into the largest connected component
 * - Fetch by corridor, never bbox
 * - z10 long-haul needs no class filter (already arterial-only)
 */

import {
  lngLatToTile,
  type DecodedTileFeature,
  type LngLat,
  type TileCoord,
} from "@/lib/geo/vector-tile-client";

/** Gate-locked quantization (~1.1 m). */
export const ROAD_QUANTIZE_DECIMALS = 5;

/** Default long-haul zoom (tile ≈ 24.3 km at mid-latitudes). */
export const ROAD_SKELETON_ZOOM = 10;

/** Default local refinement zoom (tile ≈ 1.52 km). */
export const ROAD_LOCAL_ZOOM = 14;

/** Below this crow-flies distance, skip the z10 skeleton. */
const LOCAL_ONLY_THRESHOLD_M = 8_000;

/** How far from each endpoint to refine at local zoom. */
const LOCAL_REFINE_RADIUS_M = 3_000;

/** Default corridor half-width (metres) around the great-circle chord. */
const DEFAULT_CORRIDOR_HALF_WIDTH_M = 1_200;

const EARTH_RADIUS_M = 6_371_000;
const TRANSPORTATION_LAYER = "transportation";

/** Classes excluded from all road graphs. */
const EXCLUDED_CLASSES = new Set([
  "rail",
  "path",
  "track",
  "aerialway",
  "transit",
  "ferry",
]);

/** Access values that block motor vehicles. */
const BLOCKED_ACCESS = new Set(["no", "private", "military", "forestry", "agricultural"]);

/**
 * Arterial classes — preferred for trucks; strong connectivity at z14.
 * Matches the gate spike `ARTERIAL` set (minus construction suffixes handled separately).
 */
export const ARTERIAL_CLASSES = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "motorway_construction",
  "trunk_construction",
  "primary_construction",
  "secondary_construction",
  "tertiary_construction",
  "minor_construction",
]);

/** Drivable for cars — arterial plus service roads. */
export const DRIVABLE_CLASSES = new Set([...ARTERIAL_CLASSES, "service"]);

/** Nominal class speeds (m/s) for travel-time edge weights. */
const CLASS_SPEED_MPS: Record<string, number> = {
  motorway: 28,
  trunk: 22,
  primary: 16,
  secondary: 13,
  tertiary: 11,
  minor: 8,
  service: 5,
  motorway_construction: 14,
  trunk_construction: 11,
  primary_construction: 8,
  secondary_construction: 7,
  tertiary_construction: 6,
  minor_construction: 5,
};

const DEFAULT_SPEED_MPS = 8;

export type RoadRoutePoint = {
  latitude: number;
  longitude: number;
};

export type RoadVehicleKind = "car" | "truck";

/** Anything that can supply decoded layer features (client or fixture). */
export type RoadFeatureSource = {
  getLayerFeatures(
    z: number,
    x: number,
    y: number,
    layer: string,
    signal?: AbortSignal,
  ): Promise<DecodedTileFeature[]>;
};

export type RoadRouteSuccess = {
  ok: true;
  coordinates: RoadRoutePoint[];
  snappedOrigin: RoadRoutePoint;
  snappedDestination: RoadRoutePoint;
  tilesFetched: number;
};

export type RoadRouteFailureReason =
  | "aborted"
  | "no-graph"
  | "unroutable"
  | "empty-corridor";

export type RoadRouteFailure = {
  ok: false;
  reason: RoadRouteFailureReason;
  message: string;
  tilesFetched: number;
};

export type RoadRouteResult = RoadRouteSuccess | RoadRouteFailure;

export type RoadRouteOptions = {
  source: RoadFeatureSource;
  vehicle?: RoadVehicleKind;
  signal?: AbortSignal;
  skeletonZoom?: number;
  localZoom?: number;
  corridorHalfWidthM?: number;
  /**
   * `hierarchical` (default): z10 skeleton + z14 endpoint refinement.
   * `local`: local zoom only.
   * `skeleton`: skeleton zoom only (tests / long-haul debugging).
   */
  mode?: "hierarchical" | "local" | "skeleton";
};

type GraphNode = {
  id: string;
  lng: number;
  lat: number;
};

type GraphEdge = {
  to: string;
  lengthM: number;
  cost: number;
  roadClass: string;
};

type RoadGraph = {
  nodes: Map<string, GraphNode>;
  adj: Map<string, GraphEdge[]>;
  /** Undirected membership for connected-component analysis. */
  undirectedAdj: Map<string, string[]>;
  largestComponent: Set<string>;
};

type InternalRoute = {
  nodeIds: string[];
  snappedOrigin: RoadRoutePoint;
  snappedDestination: RoadRoutePoint;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

export function haversineM(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function quantizeKey(lng: number, lat: number, decimals = ROAD_QUANTIZE_DECIMALS): string {
  return `${lng.toFixed(decimals)},${lat.toFixed(decimals)}`;
}

function pointFromKey(id: string): RoadRoutePoint {
  const [lng, lat] = id.split(",").map(Number) as [number, number];
  return { longitude: lng, latitude: lat };
}

function normalizeClass(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function isAllowedClass(roadClass: string, vehicle: RoadVehicleKind, applyFilter: boolean): boolean {
  if (!roadClass || EXCLUDED_CLASSES.has(roadClass)) return false;
  if (!applyFilter) {
    // z10: OpenMapTiles is already arterial-only; still drop non-road leftovers.
    return !EXCLUDED_CLASSES.has(roadClass);
  }
  if (vehicle === "truck") return ARTERIAL_CLASSES.has(roadClass);
  return DRIVABLE_CLASSES.has(roadClass);
}

function isAccessAllowed(access: unknown): boolean {
  if (access === undefined || access === null || access === "") return true;
  return !BLOCKED_ACCESS.has(String(access));
}

/** Parse OpenMapTiles oneway: 1 = forward, -1 = reverse, else bidirectional. */
export function parseOneway(value: unknown): -1 | 0 | 1 {
  if (value === true || value === 1 || value === "1" || value === "yes" || value === "true") {
    return 1;
  }
  if (value === -1 || value === "-1" || value === "reverse") {
    return -1;
  }
  return 0;
}

/**
 * Class preference multiplier applied to travel-time cost.
 * Trucks heavily prefer motorway/trunk/primary; cars tolerate minor/service.
 */
export function classPreferenceMultiplier(roadClass: string, vehicle: RoadVehicleKind): number {
  const base = roadClass.replace(/_construction$/, "");
  if (vehicle === "truck") {
    if (base === "motorway" || base === "trunk") return 0.7;
    if (base === "primary") return 0.85;
    if (base === "secondary") return 1.1;
    if (base === "tertiary") return 1.4;
    if (base === "minor") return 2.2;
    if (base === "service") return 4;
    return 1.5;
  }
  // car
  if (base === "motorway" || base === "trunk") return 0.95;
  if (base === "primary" || base === "secondary") return 1;
  if (base === "tertiary" || base === "minor") return 1.05;
  if (base === "service") return 1.25;
  return 1;
}

function edgeCost(lengthM: number, roadClass: string, vehicle: RoadVehicleKind): number {
  const speed = CLASS_SPEED_MPS[roadClass] ?? DEFAULT_SPEED_MPS;
  const timeS = lengthM / speed;
  return timeS * classPreferenceMultiplier(roadClass, vehicle);
}

/**
 * Tiles covering a corridor of half-width `halfWidthM` around the chord from
 * `from` to `to` at zoom `z`. Never expands to a full bbox.
 */
export function tilesAlongCorridor(
  from: LngLat,
  to: LngLat,
  z: number,
  halfWidthM: number,
): TileCoord[] {
  const dist = haversineM(from, to);
  const n = 2 ** z;
  const tileWidthM = (Math.cos((from[1] * Math.PI) / 180) * 2 * Math.PI * EARTH_RADIUS_M) / n;
  const stepM = Math.max(tileWidthM * 0.45, 200);
  const steps = Math.max(1, Math.ceil(dist / stepM));

  const cosLat = Math.cos((from[1] * Math.PI) / 180);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx * cosLat, dy) || 1;
  const dLat = halfWidthM / 111_320;
  const dLng = halfWidthM / (111_320 * Math.max(0.2, cosLat));
  // Unit perpendicular in lng/lat degrees (equirectangular).
  const ux = -dy / len;
  const uy = (dx * cosLat) / len;
  const offLng = ux * dLng;
  const offLat = uy * dLat;

  const seen = new Set<string>();
  const out: TileCoord[] = [];
  const add = (lng: number, lat: number) => {
    const t = lngLatToTile(lng, lat, z);
    // Clamp to valid mercator range
    if (t.x < 0 || t.y < 0 || t.x >= n || t.y >= n) return;
    const key = `${t.z}/${t.x}/${t.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const lng = from[0] + dx * t;
    const lat = from[1] + dy * t;
    add(lng, lat);
    add(lng + offLng, lat + offLat);
    add(lng - offLng, lat - offLat);
  }
  return out;
}

/**
 * Largest strongly connected component (Kosaraju) over the directed graph.
 * Snapping into an undirected component is not enough: oneway streets leave
 * many nodes unreachable for A*, so endpoints must land in the same SCC.
 */
function findLargestStronglyConnectedComponent(adj: Map<string, GraphEdge[]>): Set<string> {
  const nodes = [...adj.keys()];
  const visited = new Set<string>();
  const order: string[] = [];

  const dfs1 = (start: string) => {
    const stack: Array<{ id: string; i: number }> = [{ id: start, i: 0 }];
    visited.add(start);
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const edges = adj.get(frame.id) ?? [];
      if (frame.i < edges.length) {
        const next = edges[frame.i++]!.to;
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ id: next, i: 0 });
        }
      } else {
        order.push(frame.id);
        stack.pop();
      }
    }
  };

  for (const id of nodes) {
    if (!visited.has(id)) dfs1(id);
  }

  const transpose = new Map<string, string[]>();
  for (const id of nodes) transpose.set(id, []);
  for (const [from, edges] of adj) {
    for (const edge of edges) {
      transpose.get(edge.to)?.push(from);
    }
  }

  visited.clear();
  let best: string[] = [];
  const dfs2 = (start: string): string[] => {
    const members: string[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      members.push(cur);
      for (const next of transpose.get(cur) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    return members;
  };

  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i]!;
    if (visited.has(id)) continue;
    const members = dfs2(id);
    if (members.length > best.length) best = members;
  }
  return new Set(best);
}

/**
 * Snap an arbitrary lng/lat into the largest strongly connected component
 * (nearest node by haversine). Weak-component snapping drops vehicles onto
 * oneway stubs that A* cannot escape.
 */
export function snapToLargestComponent(
  graph: RoadGraph,
  point: LngLat,
): { nodeId: string; point: RoadRoutePoint } | null {
  let bestId: string | null = null;
  let bestD = Infinity;
  for (const id of graph.largestComponent) {
    const n = graph.nodes.get(id)!;
    const d = haversineM(point, [n.lng, n.lat]);
    if (d < bestD) {
      bestD = d;
      bestId = id;
    }
  }
  if (!bestId) return null;
  const n = graph.nodes.get(bestId)!;
  return { nodeId: bestId, point: { longitude: n.lng, latitude: n.lat } };
}

/** Build a directed road graph from decoded transportation features. */
export function buildRoadGraph(
  features: readonly DecodedTileFeature[],
  vehicle: RoadVehicleKind,
  options: { applyClassFilter?: boolean } = {},
): RoadGraph {
  const applyClassFilter = options.applyClassFilter !== false;
  const nodes = new Map<string, GraphNode>();
  const adj = new Map<string, GraphEdge[]>();
  const undirectedAdj = new Map<string, string[]>();
  const directedSeen = new Set<string>();
  const undirectedSeen = new Set<string>();

  const ensureNode = (lng: number, lat: number): string => {
    const id = quantizeKey(lng, lat);
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        lng: Number(lng.toFixed(ROAD_QUANTIZE_DECIMALS)),
        lat: Number(lat.toFixed(ROAD_QUANTIZE_DECIMALS)),
      });
      adj.set(id, []);
      undirectedAdj.set(id, []);
    }
    return id;
  };

  const addDirected = (from: string, to: string, lengthM: number, roadClass: string) => {
    const key = `${from}>${to}`;
    if (directedSeen.has(key)) return;
    directedSeen.add(key);
    adj.get(from)!.push({
      to,
      lengthM,
      cost: edgeCost(lengthM, roadClass, vehicle),
      roadClass,
    });
  };

  const addUndirectedLink = (a: string, b: string) => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = `${lo}|${hi}`;
    if (undirectedSeen.has(key)) return;
    undirectedSeen.add(key);
    undirectedAdj.get(a)!.push(b);
    undirectedAdj.get(b)!.push(a);
  };

  for (const feature of features) {
    if (feature.type !== 2) continue;
    const roadClass = normalizeClass(feature.properties.class);
    if (!isAllowedClass(roadClass, vehicle, applyClassFilter)) continue;
    if (!isAccessAllowed(feature.properties.access)) continue;
    const oneway = parseOneway(feature.properties.oneway);

    for (const line of feature.geometry) {
      if (line.length < 2) continue;
      let prevId: string | null = null;
      let prevLngLat: LngLat | null = null;
      for (const [lng, lat] of line) {
        const id = ensureNode(lng, lat);
        if (prevId !== null && prevLngLat !== null && prevId !== id) {
          const lengthM = haversineM(prevLngLat, [lng, lat]);
          if (lengthM > 0) {
            if (oneway === 0 || oneway === 1) {
              addDirected(prevId, id, lengthM, roadClass);
            }
            if (oneway === 0 || oneway === -1) {
              addDirected(id, prevId, lengthM, roadClass);
            }
            addUndirectedLink(prevId, id);
          }
        }
        prevId = id;
        prevLngLat = [lng, lat];
      }
    }
  }

  const largestComponent = findLargestStronglyConnectedComponent(adj);
  return { nodes, adj, undirectedAdj, largestComponent };
}

class MinHeap {
  private readonly data: Array<{ key: number; id: string }> = [];

  get size(): number {
    return this.data.length;
  }

  push(key: number, id: string): void {
    this.data.push({ key, id });
    let i = this.data.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p]!.key <= this.data[i]!.key) break;
      const tmp = this.data[p]!;
      this.data[p] = this.data[i]!;
      this.data[i] = tmp;
      i = p;
    }
  }

  pop(): { key: number; id: string } | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0]!;
    const last = this.data.pop()!;
    if (this.data.length === 0) return top;
    this.data[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;
      if (l < this.data.length && this.data[l]!.key < this.data[smallest]!.key) smallest = l;
      if (r < this.data.length && this.data[r]!.key < this.data[smallest]!.key) smallest = r;
      if (smallest === i) break;
      const tmp = this.data[i]!;
      this.data[i] = this.data[smallest]!;
      this.data[smallest] = tmp;
      i = smallest;
    }
    return top;
  }
}

/** A* over the directed graph. Costs are travel-time weighted. */
export function astarRoad(
  graph: RoadGraph,
  startId: string,
  goalId: string,
  signal?: AbortSignal,
): string[] | null {
  if (startId === goalId) return [startId];
  const goal = graph.nodes.get(goalId);
  if (!goal || !graph.nodes.has(startId)) return null;

  const gScore = new Map<string, number>([[startId, 0]]);
  const cameFrom = new Map<string, string>();
  const closed = new Set<string>();
  const open = new MinHeap();
  const heuristic = (id: string) => {
    const n = graph.nodes.get(id)!;
    // Optimistic: assume motorway speed
    return haversineM([n.lng, n.lat], [goal.lng, goal.lat]) / CLASS_SPEED_MPS.motorway!;
  };
  open.push(heuristic(startId), startId);
  let expansions = 0;

  while (open.size > 0) {
    if ((expansions++ & 63) === 0) throwIfAborted(signal);
    const curEntry = open.pop();
    if (!curEntry) break;
    const cur = curEntry.id;
    if (closed.has(cur)) continue;
    if (cur === goalId) {
      const path = [cur];
      let c: string | undefined = cur;
      while (cameFrom.has(c)) {
        c = cameFrom.get(c)!;
        path.push(c);
      }
      path.reverse();
      return path;
    }
    closed.add(cur);
    const gCur = gScore.get(cur) ?? Infinity;
    for (const edge of graph.adj.get(cur) ?? []) {
      if (closed.has(edge.to)) continue;
      const tentative = gCur + edge.cost;
      if (tentative < (gScore.get(edge.to) ?? Infinity)) {
        cameFrom.set(edge.to, cur);
        gScore.set(edge.to, tentative);
        open.push(tentative + heuristic(edge.to), edge.to);
      }
    }
  }
  return null;
}

async function fetchCorridorFeatures(
  source: RoadFeatureSource,
  tiles: readonly TileCoord[],
  signal: AbortSignal | undefined,
  counter: { tilesFetched: number },
): Promise<DecodedTileFeature[]> {
  const features: DecodedTileFeature[] = [];
  for (const tile of tiles) {
    throwIfAborted(signal);
    const layer = await source.getLayerFeatures(
      tile.z,
      tile.x,
      tile.y,
      TRANSPORTATION_LAYER,
      signal,
    );
    counter.tilesFetched += 1;
    features.push(...layer);
  }
  return features;
}

function routeOnGraph(
  graph: RoadGraph,
  origin: LngLat,
  destination: LngLat,
  signal?: AbortSignal,
): InternalRoute | null {
  if (graph.largestComponent.size === 0) return null;
  const start = snapToLargestComponent(graph, origin);
  const end = snapToLargestComponent(graph, destination);
  if (!start || !end) return null;
  // Snap may land outside the directed reachability of a directed subgraph;
  // require both endpoints to be in the undirected largest component (already true).
  const nodeIds = astarRoad(graph, start.nodeId, end.nodeId, signal);
  if (!nodeIds || nodeIds.length === 0) return null;
  return {
    nodeIds,
    snappedOrigin: start.point,
    snappedDestination: end.point,
  };
}

function nodesToCoordinates(graph: RoadGraph, nodeIds: readonly string[]): RoadRoutePoint[] {
  return nodeIds.map((id) => {
    const n = graph.nodes.get(id)!;
    return { longitude: n.lng, latitude: n.lat };
  });
}

function toLngLat(p: RoadRoutePoint): LngLat {
  return [p.longitude, p.latitude];
}

function cumulativeDistances(coords: readonly RoadRoutePoint[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i += 1) {
    out.push(
      out[i - 1]! +
        haversineM(toLngLat(coords[i - 1]!), toLngLat(coords[i]!)),
    );
  }
  return out;
}

function indexAtDistance(cum: readonly number[], targetM: number): number {
  for (let i = 0; i < cum.length; i += 1) {
    if (cum[i]! >= targetM) return i;
  }
  return Math.max(0, cum.length - 1);
}

function indexBeforeEnd(cum: readonly number[], fromEndM: number): number {
  const total = cum[cum.length - 1] ?? 0;
  const target = Math.max(0, total - fromEndM);
  let idx = 0;
  for (let i = 0; i < cum.length; i += 1) {
    if (cum[i]! <= target) idx = i;
  }
  return idx;
}

function stitchPolylines(
  parts: Array<RoadRoutePoint[]>,
): RoadRoutePoint[] {
  const out: RoadRoutePoint[] = [];
  for (const part of parts) {
    for (const p of part) {
      const last = out[out.length - 1];
      if (
        last &&
        last.latitude === p.latitude &&
        last.longitude === p.longitude
      ) {
        continue;
      }
      out.push(p);
    }
  }
  return out;
}

async function routeSingleZoom(
  origin: RoadRoutePoint,
  destination: RoadRoutePoint,
  zoom: number,
  vehicle: RoadVehicleKind,
  applyClassFilter: boolean,
  halfWidthM: number,
  source: RoadFeatureSource,
  signal: AbortSignal | undefined,
  counter: { tilesFetched: number },
): Promise<
  | { ok: true; graph: RoadGraph; route: InternalRoute; coordinates: RoadRoutePoint[] }
  | RoadRouteFailure
> {
  const tiles = tilesAlongCorridor(
    toLngLat(origin),
    toLngLat(destination),
    zoom,
    halfWidthM,
  );
  if (tiles.length === 0) {
    return {
      ok: false,
      reason: "empty-corridor",
      message: `No tiles along corridor at z${zoom}`,
      tilesFetched: counter.tilesFetched,
    };
  }

  const features = await fetchCorridorFeatures(source, tiles, signal, counter);
  const graph = buildRoadGraph(features, vehicle, { applyClassFilter });
  if (graph.largestComponent.size === 0) {
    return {
      ok: false,
      reason: "no-graph",
      message: `No drivable road graph at z${zoom}`,
      tilesFetched: counter.tilesFetched,
    };
  }

  const route = routeOnGraph(graph, toLngLat(origin), toLngLat(destination), signal);
  if (!route) {
    return {
      ok: false,
      reason: "unroutable",
      message: `No path between snapped endpoints at z${zoom}`,
      tilesFetched: counter.tilesFetched,
    };
  }

  return {
    ok: true,
    graph,
    route,
    coordinates: nodesToCoordinates(graph, route.nodeIds),
  };
}

/**
 * Route a car or truck between two points along real roadways.
 * Never throws for unroutable geography — returns a typed failure.
 * AbortSignal aborts yield `{ ok: false, reason: "aborted" }`.
 */
export async function routeRoad(
  origin: RoadRoutePoint,
  destination: RoadRoutePoint,
  options: RoadRouteOptions,
): Promise<RoadRouteResult> {
  const vehicle = options.vehicle ?? "car";
  const skeletonZoom = options.skeletonZoom ?? ROAD_SKELETON_ZOOM;
  const localZoom = options.localZoom ?? ROAD_LOCAL_ZOOM;
  const halfWidthM = options.corridorHalfWidthM ?? DEFAULT_CORRIDOR_HALF_WIDTH_M;
  const mode = options.mode ?? "hierarchical";
  const counter = { tilesFetched: 0 };

  try {
    throwIfAborted(options.signal);

    const crowFlies = haversineM(toLngLat(origin), toLngLat(destination));
    const useLocalOnly =
      mode === "local" || (mode === "hierarchical" && crowFlies < LOCAL_ONLY_THRESHOLD_M);

    if (mode === "skeleton" || (!useLocalOnly && mode === "hierarchical")) {
      // Long-haul: z10 skeleton (no class filter — OpenMapTiles already arterial).
      const skeleton = await routeSingleZoom(
        origin,
        destination,
        skeletonZoom,
        vehicle,
        false,
        halfWidthM * 2, // slightly wider at coarse zoom
        options.source,
        options.signal,
        counter,
      );

      if (mode === "skeleton") {
        if (!skeleton.ok) return skeleton;
        return {
          ok: true,
          coordinates: skeleton.coordinates,
          snappedOrigin: skeleton.route.snappedOrigin,
          snappedDestination: skeleton.route.snappedDestination,
          tilesFetched: counter.tilesFetched,
        };
      }

      if (!skeleton.ok) {
        // z10 is the weaker layer — degrade to local corridor rather than hard-fail.
        const local = await routeSingleZoom(
          origin,
          destination,
          localZoom,
          vehicle,
          true,
          halfWidthM,
          options.source,
          options.signal,
          counter,
        );
        if (!local.ok) return local;
        return {
          ok: true,
          coordinates: local.coordinates,
          snappedOrigin: local.route.snappedOrigin,
          snappedDestination: local.route.snappedDestination,
          tilesFetched: counter.tilesFetched,
        };
      }

      // Refine approaches at local zoom near both endpoints.
      const coords = skeleton.coordinates;
      const cum = cumulativeDistances(coords);
      const startIdx = indexAtDistance(cum, LOCAL_REFINE_RADIUS_M);
      const endIdx = indexBeforeEnd(cum, LOCAL_REFINE_RADIUS_M);

      let head: RoadRoutePoint[] = [];
      let tail: RoadRoutePoint[] = [];
      let snappedOrigin = skeleton.route.snappedOrigin;
      let snappedDestination = skeleton.route.snappedDestination;

      if (startIdx > 0) {
        const via = coords[startIdx]!;
        const localStart = await routeSingleZoom(
          origin,
          via,
          localZoom,
          vehicle,
          true,
          halfWidthM,
          options.source,
          options.signal,
          counter,
        );
        if (localStart.ok) {
          head = localStart.coordinates;
          snappedOrigin = localStart.route.snappedOrigin;
        }
      }

      if (endIdx < coords.length - 1 && endIdx >= startIdx) {
        const via = coords[endIdx]!;
        const localEnd = await routeSingleZoom(
          via,
          destination,
          localZoom,
          vehicle,
          true,
          halfWidthM,
          options.source,
          options.signal,
          counter,
        );
        if (localEnd.ok) {
          tail = localEnd.coordinates;
          snappedDestination = localEnd.route.snappedDestination;
        }
      }

      const midStart = head.length > 0 ? startIdx : 0;
      const midEnd = tail.length > 0 ? endIdx : coords.length - 1;
      const mid = coords.slice(midStart, midEnd + 1);
      const coordinates = stitchPolylines([head, mid, tail]);

      if (coordinates.length < 2) {
        return {
          ok: false,
          reason: "unroutable",
          message: "Hierarchical stitch produced an empty polyline",
          tilesFetched: counter.tilesFetched,
        };
      }

      return {
        ok: true,
        coordinates,
        snappedOrigin,
        snappedDestination,
        tilesFetched: counter.tilesFetched,
      };
    }

    // Local-only path
    const local = await routeSingleZoom(
      origin,
      destination,
      localZoom,
      vehicle,
      true,
      halfWidthM,
      options.source,
      options.signal,
      counter,
    );
    if (!local.ok) return local;
    return {
      ok: true,
      coordinates: local.coordinates,
      snappedOrigin: local.route.snappedOrigin,
      snappedDestination: local.route.snappedDestination,
      tilesFetched: counter.tilesFetched,
    };
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) {
      return {
        ok: false,
        reason: "aborted",
        message: "Road routing aborted",
        tilesFetched: counter.tilesFetched,
      };
    }
    throw error;
  }
}

/** Collect road classes traversed by a directed path (for tests / diagnostics). */
export function pathRoadClasses(
  graph: RoadGraph,
  nodeIds: readonly string[],
): string[] {
  const classes: string[] = [];
  for (let i = 0; i < nodeIds.length - 1; i += 1) {
    const from = nodeIds[i]!;
    const to = nodeIds[i + 1]!;
    const edge = (graph.adj.get(from) ?? []).find((e) => e.to === to);
    if (edge) classes.push(edge.roadClass);
  }
  return classes;
}

export type { RoadGraph, GraphEdge };
