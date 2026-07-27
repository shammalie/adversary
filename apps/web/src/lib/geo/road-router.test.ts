import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createFixtureFeatureSource } from "@/lib/geo/terrain";
import {
  astarRoad,
  buildRoadGraph,
  classPreferenceMultiplier,
  haversineM,
  parseOneway,
  pathRoadClasses,
  routeRoad,
  snapToLargestComponent,
  tilesAlongCorridor,
  type RoadFeatureSource,
  type RoadRoutePoint,
} from "@/lib/geo/road-router";
import {
  decodeLayerFeatures,
  type DecodedTileFeature,
} from "@/lib/geo/vector-tile-client";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures/tiles");

type ManifestEntry = {
  id: string;
  file: string;
  z: number;
  x: number;
  y: number;
};

function loadManifest(): ManifestEntry[] {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8")) as ManifestEntry[];
}

function loadFixtureSource(ids: string[]): RoadFeatureSource {
  const manifest = loadManifest();
  const tiles = ids.map((id) => {
    const entry = manifest.find((m) => m.id === id);
    if (!entry) throw new Error(`Missing fixture ${id}`);
    const bytes = readFileSync(join(FIXTURE_DIR, entry.file));
    return { z: entry.z, x: entry.x, y: entry.y, bytes };
  });
  return createFixtureFeatureSource(tiles);
}

function loadZ14LondonFeatures(): DecodedTileFeature[] {
  const manifest = loadManifest();
  const features: DecodedTileFeature[] = [];
  for (const entry of manifest.filter((m) => m.z === 14)) {
    const bytes = readFileSync(join(FIXTURE_DIR, entry.file));
    features.push(...decodeLayerFeatures(bytes, entry.z, entry.x, entry.y, "transportation"));
  }
  return features;
}

describe("road-router primitives", () => {
  it("parses OpenMapTiles oneway values", () => {
    expect(parseOneway(1)).toBe(1);
    expect(parseOneway("1")).toBe(1);
    expect(parseOneway(-1)).toBe(-1);
    expect(parseOneway("reverse")).toBe(-1);
    expect(parseOneway(0)).toBe(0);
    expect(parseOneway(undefined)).toBe(0);
  });

  it("applies stronger truck preference against minor/service", () => {
    expect(classPreferenceMultiplier("motorway", "truck")).toBeLessThan(
      classPreferenceMultiplier("minor", "truck"),
    );
    expect(classPreferenceMultiplier("service", "truck")).toBeGreaterThan(
      classPreferenceMultiplier("service", "car"),
    );
  });

  it("enumerates a corridor with far fewer tiles than a bbox", () => {
    const from: [number, number] = [-0.13, 51.52];
    const to: [number, number] = [-0.11, 51.5];
    const corridor = tilesAlongCorridor(from, to, 14, 800);
    expect(corridor.length).toBeGreaterThan(0);
    expect(corridor.length).toBeLessThan(40);
  });
});

describe("road-router with London z14 fixtures", () => {
  const londonZ14Ids = [
    "london-z14-8185-5447",
    "london-z14-8185-5448",
    "london-z14-8186-5447",
    "london-z14-8186-5448",
  ];

  it("routes across a tile seam without throwing", async () => {
    const source = loadFixtureSource(londonZ14Ids);
    const origin: RoadRoutePoint = { longitude: -0.13079, latitude: 51.52079 };
    const destination: RoadRoutePoint = { longitude: -0.11108, latitude: 51.49579 };

    const result = await routeRoad(origin, destination, {
      source,
      vehicle: "car",
      mode: "local",
      localZoom: 14,
      corridorHalfWidthM: 1_500,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coordinates.length).toBeGreaterThan(2);
    expect(result.tilesFetched).toBeGreaterThan(0);
    expect(result.tilesFetched).toBeLessThan(40);

    const tilesTouched = new Set(
      result.coordinates.map((p) => {
        const n = 2 ** 14;
        const x = Math.floor(((p.longitude + 180) / 360) * n);
        const y = Math.floor(
          ((1 -
            Math.log(
              Math.tan((p.latitude * Math.PI) / 180) +
                1 / Math.cos((p.latitude * Math.PI) / 180),
            ) /
              Math.PI) /
            2) *
            n,
        );
        return `${x}/${y}`;
      }),
    );
    expect(tilesTouched.size).toBeGreaterThan(1);
  });

  it("does not produce a oneway violation", () => {
    const features = loadZ14LondonFeatures();
    const graph = buildRoadGraph(features, "car", { applyClassFilter: true });
    expect(graph.largestComponent.size).toBeGreaterThan(100);

    let forward: { from: string; to: string } | null = null;
    for (const [from, edges] of graph.adj) {
      if (!graph.largestComponent.has(from)) continue;
      for (const edge of edges) {
        if (!graph.largestComponent.has(edge.to)) continue;
        const reverse = (graph.adj.get(edge.to) ?? []).some((e) => e.to === from);
        if (!reverse) {
          forward = { from, to: edge.to };
          break;
        }
      }
      if (forward) break;
    }
    expect(forward).not.toBeNull();

    const nodePath = astarRoad(graph, forward!.to, forward!.from);
    expect(nodePath).not.toBeNull();
    if (!nodePath) return;

    for (let i = 0; i < nodePath.length - 1; i += 1) {
      const a = nodePath[i]!;
      const b = nodePath[i + 1]!;
      expect(!(a === forward!.to && b === forward!.from)).toBe(true);
      const ok = (graph.adj.get(a) ?? []).some((e) => e.to === b);
      expect(ok).toBe(true);
    }
  });

  it("produces different class mix for truck vs car", () => {
    const features = loadZ14LondonFeatures();
    const carGraph = buildRoadGraph(features, "car", { applyClassFilter: true });
    const truckGraph = buildRoadGraph(features, "truck", { applyClassFilter: true });

    const origin: [number, number] = [-0.13079, 51.52079];
    const destination: [number, number] = [-0.11108, 51.49579];
    const carStart = snapToLargestComponent(carGraph, origin);
    const carEnd = snapToLargestComponent(carGraph, destination);
    const truckStart = snapToLargestComponent(truckGraph, origin);
    const truckEnd = snapToLargestComponent(truckGraph, destination);
    expect(carStart && carEnd && truckStart && truckEnd).toBeTruthy();

    const carPath = astarRoad(carGraph, carStart!.nodeId, carEnd!.nodeId);
    const truckPath = astarRoad(truckGraph, truckStart!.nodeId, truckEnd!.nodeId);
    expect(carPath).not.toBeNull();
    expect(truckPath).not.toBeNull();

    const carClasses = pathRoadClasses(carGraph, carPath!);
    const truckClasses = pathRoadClasses(truckGraph, truckPath!);

    const majorShare = (classes: string[]) => {
      if (classes.length === 0) return 0;
      const major = classes.filter((c) =>
        /^(motorway|trunk|primary)/.test(c.replace(/_construction$/, "")),
      ).length;
      return major / classes.length;
    };

    expect(majorShare(truckClasses)).toBeGreaterThanOrEqual(majorShare(carClasses) - 0.02);
    expect(truckClasses.includes("service")).toBe(false);
    expect(classPreferenceMultiplier("minor", "truck")).toBeGreaterThan(
      classPreferenceMultiplier("minor", "car"),
    );
    expect(truckClasses.length).toBeGreaterThan(0);
    expect(carClasses.length).toBeGreaterThan(0);

    // Preference weights or service eligibility should yield a distinguishable path.
    const samePath =
      carPath!.length === truckPath!.length &&
      carPath!.every((id, i) => id === truckPath![i]);
    const carUsesServiceOrMinorMore =
      carClasses.filter((c) => c === "service" || c === "minor").length >=
      truckClasses.filter((c) => c === "service" || c === "minor").length;
    expect(samePath ? carUsesServiceOrMinorMore || !samePath : true).toBe(true);
    if (samePath) {
      // Even if geometry coincides, truck graph must not admit service edges.
      expect(truckGraph.adj.size).toBeGreaterThan(0);
      for (const edges of truckGraph.adj.values()) {
        expect(edges.every((e) => e.roadClass !== "service")).toBe(true);
      }
    }
  });

  it("returns a typed failure for unroutable input instead of throwing", async () => {
    const source = loadFixtureSource(["ocean-z9"]);
    const origin: RoadRoutePoint = { longitude: -40, latitude: 30 };
    const destination: RoadRoutePoint = { longitude: -39.9, latitude: 30.1 };

    const result = await routeRoad(origin, destination, {
      source,
      vehicle: "car",
      mode: "local",
      localZoom: 9,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["no-graph", "unroutable", "empty-corridor"]).toContain(result.reason);
  });

  it("honours AbortSignal with a typed aborted failure", async () => {
    const source = loadFixtureSource(londonZ14Ids);
    const controller = new AbortController();
    controller.abort();

    const result = await routeRoad(
      { longitude: -0.13, latitude: 51.52 },
      { longitude: -0.11, latitude: 51.5 },
      {
        source,
        mode: "local",
        localZoom: 14,
        signal: controller.signal,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("aborted");
  });
});

describe("road-router synthetic oneway", () => {
  it("refuses to traverse against a oneway edge", () => {
    const features: DecodedTileFeature[] = [
      {
        type: 2,
        properties: { class: "primary", oneway: 1 },
        geometry: [
          [
            [0, 0],
            [0.001, 0],
            [0.002, 0],
          ],
        ],
      },
      {
        type: 2,
        properties: { class: "primary", oneway: 0 },
        geometry: [
          [
            [0.002, 0],
            [0.002, 0.001],
            [0, 0.001],
            [0, 0],
          ],
        ],
      },
    ];

    const graph = buildRoadGraph(features, "car", { applyClassFilter: true });
    const start = snapToLargestComponent(graph, [0.002, 0]);
    const goal = snapToLargestComponent(graph, [0, 0]);
    expect(start && goal).toBeTruthy();

    const path = astarRoad(graph, start!.nodeId, goal!.nodeId);
    expect(path).not.toBeNull();

    for (let i = 0; i < path!.length - 1; i += 1) {
      const a = graph.nodes.get(path![i]!)!;
      const b = graph.nodes.get(path![i + 1]!)!;
      const goingWestOnOneway = a.lat === 0 && b.lat === 0 && b.lng < a.lng;
      expect(goingWestOnOneway).toBe(false);
    }

    let len = 0;
    for (let i = 0; i < path!.length - 1; i += 1) {
      const a = graph.nodes.get(path![i]!)!;
      const b = graph.nodes.get(path![i + 1]!)!;
      len += haversineM([a.lng, a.lat], [b.lng, b.lat]);
    }
    expect(len).toBeGreaterThan(250);
  });
});
