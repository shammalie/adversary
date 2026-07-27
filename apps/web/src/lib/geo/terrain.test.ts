import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createSeededRandom } from "@/lib/random";
import {
  classifyPoint,
  createFixtureFeatureSource,
  pointInPolygon,
  pointInRing,
  sampleValidPoint,
} from "@/lib/geo/terrain";
import { lngLatToTile, tileLocalToLngLat } from "@/lib/geo/vector-tile-client";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures/tiles");

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
    return { z: entry.z, x: entry.x, y: entry.y, bytes };
  });
  return { source: createFixtureFeatureSource(tiles), manifest: tiles };
}

describe("point-in-polygon helpers", () => {
  it("detects points inside a simple ring", () => {
    const ring: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ];
    expect(pointInRing([1, 1], ring)).toBe(true);
    expect(pointInRing([3, 1], ring)).toBe(false);
  });

  it("treats holes as exterior", () => {
    const outer: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    const hole: [number, number][] = [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ];
    expect(pointInPolygon([0.5, 0.5], [outer, hole])).toBe(true);
    expect(pointInPolygon([2, 2], [outer, hole])).toBe(false);
  });
});

describe("classifyPoint with fixture tiles", () => {
  it("classifies a known ocean point as navigable water", async () => {
    const { source, manifest } = loadFixtureSource(["ocean-z9"]);
    const tile = manifest[0]!;
    // Tile center is open Atlantic
    const [lng, lat] = tileLocalToLngLat(tile.z, tile.x, tile.y, 2048, 2048);
    const result = await classifyPoint(source, [lng, lat], {
      waterZoom: tile.z,
      roadZoom: tile.z,
    });
    expect(result.isWater).toBe(true);
    expect(result.isNavigableWater).toBe(true);
    expect(result.waterClass).toBe("ocean");
    expect(result.nearestRoad).toBeNull();
  });

  it("classifies a known inland London point as land with a nearby road", async () => {
    const { source, manifest } = loadFixtureSource(["london-z10"]);
    const tile = manifest[0]!;
    // North of the Thames (British Museum area) — tile center sits on the river.
    const point: [number, number] = [-0.1278, 51.519];
    const result = await classifyPoint(source, point, {
      waterZoom: tile.z,
      roadZoom: tile.z,
      maxRoadDistanceM: 5000,
    });
    expect(result.isWater).toBe(false);
    expect(result.isNavigableWater).toBe(false);
    expect(result.nearestRoad).not.toBeNull();
    expect(result.nearestRoad!.distanceM).toBeLessThan(5000);
  });

  it("classifies a Dover coastline tile with both water and roads present", async () => {
    const { source, manifest } = loadFixtureSource(["dover-z10"]);
    const tile = manifest[0]!;
    // Probe several points in the tile: at least one water, one land+road
    const probes: [number, number][] = [
      [1024, 1024],
      [2048, 2048],
      [3072, 3072],
      [512, 3500],
      [3500, 512],
    ];
    const results = [];
    for (const [px, py] of probes) {
      const point = tileLocalToLngLat(tile.z, tile.x, tile.y, px, py);
      results.push(
        await classifyPoint(source, point, {
          waterZoom: tile.z,
          roadZoom: tile.z,
          maxRoadDistanceM: 8000,
        }),
      );
    }
    expect(results.some((r) => r.isNavigableWater)).toBe(true);
    expect(results.some((r) => r.nearestRoad !== null)).toBe(true);
  });
});

describe("sampleValidPoint bounds retries", () => {
  it("returns null instead of looping forever when nothing matches", async () => {
    // Empty source → boats never find navigable water
    const source = createFixtureFeatureSource([]);
    const random = createSeededRandom(1);
    const result = await sampleValidPoint(source, {
      category: "boat",
      bbox: [-1, 50, 1, 52],
      random,
      maxAttempts: 5,
    });
    expect(result).toBeNull();
  });

  it("accepts aircraft on the first attempt", async () => {
    const source = createFixtureFeatureSource([]);
    const random = createSeededRandom(42);
    const result = await sampleValidPoint(source, {
      category: "aircraft",
      bbox: [-1, 50, 1, 52],
      random,
      maxAttempts: 3,
    });
    expect(result).not.toBeNull();
    expect(result!.point[0]).toBeGreaterThanOrEqual(-1);
    expect(result!.point[0]).toBeLessThanOrEqual(1);
  });

  it("finds a car-valid inland point inside the London fixture bbox", async () => {
    const { source, manifest } = loadFixtureSource(["london-z10"]);
    const tile = manifest[0]!;
    // Bbox of this single tile
    const n = 2 ** tile.z;
    const west = (tile.x / n) * 360 - 180;
    const east = ((tile.x + 1) / n) * 360 - 180;
    const north =
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * tile.y) / n))) * 180) / Math.PI;
    const south =
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + 1)) / n))) * 180) / Math.PI;

    const random = createSeededRandom(7);
    const result = await sampleValidPoint(source, {
      category: "car",
      bbox: [west, south, east, north],
      random,
      maxAttempts: 24,
      classifyOptions: { waterZoom: tile.z, roadZoom: tile.z, maxRoadDistanceM: 5000 },
    });
    expect(result).not.toBeNull();
    expect(result!.terrain.nearestRoad).not.toBeNull();
    expect(result!.terrain.isNavigableWater).toBe(false);

    // Sanity: fixture tile coords match lngLatToTile
    const back = lngLatToTile(result!.point[0], result!.point[1], tile.z);
    expect(back.x).toBe(tile.x);
    expect(back.y).toBe(tile.y);
  });
});
