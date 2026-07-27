import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createFixtureFeatureSource, haversineMeters } from "@/lib/geo/terrain";
import {
  isNavigableWaterPoint,
  routeSea,
  segmentStaysOnWater,
  smoothWaterPath,
  unpackSeaSeeds,
  type SeaSeeds,
} from "@/lib/geo/sea-router";
import {
  decodeLayerFeatures,
  tileLocalToLngLat,
  type DecodedTileFeature,
  type LngLat,
} from "@/lib/geo/vector-tile-client";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures/tiles");
const SEEDS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../public/geo-seeds.json",
);

type ManifestEntry = {
  id: string;
  file: string;
  z: number;
  x: number;
  y: number;
  layers: string[];
};

function loadManifest(): ManifestEntry[] {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8")) as ManifestEntry[];
}

function loadFixtureSource(ids: string[]) {
  const manifest = loadManifest();
  const tiles = ids.map((id) => {
    const entry = manifest.find((m) => m.id === id);
    if (!entry) throw new Error(`Missing fixture ${id} — run pnpm geo:seeds`);
    const bytes = readFileSync(join(FIXTURE_DIR, entry.file));
    return { z: entry.z, x: entry.x, y: entry.y, bytes, id: entry.id };
  });
  return { source: createFixtureFeatureSource(tiles), tiles };
}

function waterFeaturesFor(
  tiles: ReadonlyArray<{ z: number; x: number; y: number; bytes: Buffer }>,
): DecodedTileFeature[] {
  const out: DecodedTileFeature[] = [];
  for (const t of tiles) {
    out.push(...decodeLayerFeatures(t.bytes, t.z, t.x, t.y, "water"));
  }
  return out;
}

function doverSeedsNearFerry(): SeaSeeds {
  const raw = JSON.parse(readFileSync(SEEDS_PATH, "utf8")) as Parameters<
    typeof unpackSeaSeeds
  >[0];
  const all = unpackSeaSeeds(raw);
  // Dover harbour cluster from the seed bundle
  const ports = all.ports.filter(
    (p) => p.lng > 1.2 && p.lng < 1.4 && p.lat > 51.05 && p.lat < 51.15,
  );
  const seaLanes = all.seaLanes.filter(
    (p) => p.lng > 1.2 && p.lng < 1.45 && p.lat > 51.05 && p.lat < 51.15,
  );
  return { ports, seaLanes };
}

describe("unpackSeaSeeds", () => {
  it("unpacks columnar geo-seeds ports and sea lanes", () => {
    const seeds = unpackSeaSeeds({
      ports: {
        lng: [1.3, 1.4],
        lat: [51.1, 51.2],
        name: ["A", "B"],
        kind: ["ferry_terminal", "ferry_endpoint"],
      },
      seaLanes: { lng: [1.35], lat: [51.12] },
    });
    expect(seeds.ports).toHaveLength(2);
    expect(seeds.ports[0]).toEqual({
      lng: 1.3,
      lat: 51.1,
      name: "A",
      kind: "ferry_terminal",
    });
    expect(seeds.seaLanes).toEqual([{ lng: 1.35, lat: 51.12 }]);
  });
});

describe("smoothWaterPath", () => {
  it("never introduces a land-crossing shortcut", () => {
    // U-shaped water corridor around a land peninsula at x=1
    const isWater = (p: LngLat): boolean => {
      const [x, y] = p;
      if (x >= 0.9 && x <= 1.1 && y >= 0.4 && y <= 1.6) return false; // land
      return x >= 0 && x <= 2 && y >= 0 && y <= 2;
    };
    const staircase: LngLat[] = [
      [0.2, 0.2],
      [0.2, 0.6],
      [0.2, 1.0],
      [0.2, 1.4],
      [0.2, 1.8],
      [0.6, 1.8],
      [1.0, 1.8],
      [1.4, 1.8],
      [1.8, 1.8],
      [1.8, 1.4],
      [1.8, 1.0],
      [1.8, 0.6],
      [1.8, 0.2],
    ];
    const smoothed = smoothWaterPath(staircase, isWater);
    expect(smoothed.length).toBeGreaterThanOrEqual(2);
    expect(smoothed.length).toBeLessThan(staircase.length);
    for (const p of smoothed) {
      expect(isWater(p)).toBe(true);
    }
    for (let i = 1; i < smoothed.length; i++) {
      expect(segmentStaysOnWater(smoothed[i - 1]!, smoothed[i]!, isWater)).toBe(true);
    }
    // Direct chord across the peninsula must be rejected by the predicate
    expect(segmentStaysOnWater([0.2, 1.0], [1.8, 1.0], isWater)).toBe(false);
  });
});

describe("routeSea with fixture tiles", () => {
  it("keeps every path vertex on navigable water (Dover coastal)", async () => {
    const { source, tiles } = loadFixtureSource(["dover-z10"]);
    const water = waterFeaturesFor(tiles);
    // Two points inside the ocean polygon of the Dover tile
    const origin = tileLocalToLngLat(tiles[0]!.z, tiles[0]!.x, tiles[0]!.y, 2800, 2800);
    const destination = tileLocalToLngLat(tiles[0]!.z, tiles[0]!.x, tiles[0]!.y, 3600, 3200);
    expect(isNavigableWaterPoint(origin, water)).toBe(true);
    expect(isNavigableWaterPoint(destination, water)).toBe(true);

    const result = await routeSea(origin, destination, {
      source,
      gridZoom: 10,
      cellsPerTile: 48,
      ferrySnapM: 500, // force grid for this pair unless they sit on the ferry
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coordinates.length).toBeGreaterThanOrEqual(2);
    for (const p of result.coordinates) {
      expect(isNavigableWaterPoint(p, water)).toBe(true);
    }
  });

  it("succeeds on a Dover strait-side crossing", async () => {
    const { source, tiles } = loadFixtureSource(["dover-z10"]);
    const origin = tileLocalToLngLat(tiles[0]!.z, tiles[0]!.x, tiles[0]!.y, 3000, 3000);
    const destination = tileLocalToLngLat(tiles[0]!.z, tiles[0]!.x, tiles[0]!.y, 3800, 3400);
    const result = await routeSea(origin, destination, {
      source,
      gridZoom: 10,
      cellsPerTile: 48,
      ferrySnapM: 200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.via === "water-grid" || result.via === "ferry").toBe(true);
    const span = haversineMeters(result.coordinates[0]!, result.coordinates.at(-1)!);
    expect(span).toBeGreaterThan(500);
  });

  it("prefers a ferry route when both ends snap onto a ferry line", async () => {
    const { source, tiles } = loadFixtureSource(["dover-z10"]);
    // Known ferry endpoints from the Dover fixture (see fixture inspect)
    const ferryStart: LngLat = [1.3324356079101562, 51.123727922863246];
    const ferryEnd: LngLat = [1.406, 51.103]; // clipped near tile east edge
    const seeds = doverSeedsNearFerry();

    const result = await routeSea(ferryStart, ferryEnd, {
      source,
      gridZoom: 10,
      seeds,
      ferrySnapM: 12_000,
      portSnapM: 8_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.via).toBe("ferry");
    expect(result.coordinates.length).toBeGreaterThanOrEqual(2);
    // Path should stay close to the known ferry corridor (not cut inland north)
    for (const [, lat] of result.coordinates) {
      expect(lat).toBeLessThan(51.2);
      expect(lat).toBeGreaterThan(51.05);
    }
    void tiles;
  });

  it("does not route an enclosed London lake out to open ocean", async () => {
    const { source: londonSource, tiles: londonTiles } = loadFixtureSource(["london-z10"]);
    const { source: oceanSource, tiles: oceanTiles } = loadFixtureSource(["ocean-z9"]);
    // Merge fixture sources so both tiles are queryable, but geometries stay disconnected
    const merged = createFixtureFeatureSource([
      ...londonTiles.map((t) => ({ z: t.z, x: t.x, y: t.y, bytes: t.bytes })),
      ...oceanTiles.map((t) => ({ z: t.z, x: t.x, y: t.y, bytes: t.bytes })),
    ]);
    void londonSource;
    void oceanSource;

    // Find a lake point inside the London tile
    const water = waterFeaturesFor(londonTiles);
    const lakes = water.filter((f) => f.properties.class === "lake" && f.type === 3);
    expect(lakes.length).toBeGreaterThan(0);
    // Use a vertex slightly inset from the first lake ring
    const ring = lakes[0]!.geometry[0]!;
    const lakePt: LngLat = ring[0]!;
    // Mid-Atlantic ocean point from the ocean fixture centre
    const oceanPt = tileLocalToLngLat(
      oceanTiles[0]!.z,
      oceanTiles[0]!.x,
      oceanTiles[0]!.y,
      2048,
      2048,
    );

    const result = await routeSea(lakePt, oceanPt, {
      source: merged,
      // Query each endpoint's native zoom by using london zoom — ocean tile won't
      // load at z10, so the grid cannot bridge lake → Atlantic.
      gridZoom: 10,
      cellsPerTile: 32,
      ferrySnapM: 500,
      waterwaySnapM: 500,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no-navigable-route");
  });

  it("returns a typed failure when no water geometry exists", async () => {
    const source = createFixtureFeatureSource([]);
    const result = await routeSea([0, 0], [1, 1], {
      source,
      gridZoom: 10,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no-navigable-route");
  });

  it("honours AbortSignal during routing", async () => {
    const { source } = loadFixtureSource(["dover-z10"]);
    const controller = new AbortController();
    controller.abort();
    const result = await routeSea([1.3, 51.1], [1.35, 51.12], {
      source,
      gridZoom: 10,
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("cancelled");
  });
});
