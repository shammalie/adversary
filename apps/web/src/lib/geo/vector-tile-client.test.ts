import { describe, expect, it } from "vitest";

import {
  DEFAULT_TILE_EXTENT,
  lngLatToTile,
  tileBounds,
  tileLocalToLngLat,
} from "@/lib/geo/vector-tile-client";

describe("tile coordinate projection", () => {
  it("maps London to the gate-spike z14 tile", () => {
    // Gate spike used LNG=-0.1278, LAT=51.5074 → 14/8185–8186 / 5447–5448 block
    const { z, x, y } = lngLatToTile(-0.1278, 51.5074, 14);
    expect(z).toBe(14);
    expect(x).toBeGreaterThanOrEqual(8185);
    expect(x).toBeLessThanOrEqual(8186);
    expect(y).toBeGreaterThanOrEqual(5447);
    expect(y).toBeLessThanOrEqual(5448);
  });

  it("round-trips the tile center through local projection", () => {
    const z = 14;
    const x = 8185;
    const y = 5447;
    const half = DEFAULT_TILE_EXTENT / 2;
    const [lng, lat] = tileLocalToLngLat(z, x, y, half, half);
    const bounds = tileBounds(z, x, y);

    expect(lng).toBeGreaterThan(bounds.west);
    expect(lng).toBeLessThan(bounds.east);
    expect(lat).toBeGreaterThan(bounds.south);
    expect(lat).toBeLessThan(bounds.north);

    // Center should be near the midpoint of the tile bounds
    expect(lng).toBeCloseTo((bounds.west + bounds.east) / 2, 5);
  });

  it("places extent corners on the geographic tile edges", () => {
    const z = 10;
    const x = 500;
    const y = 340;
    const bounds = tileBounds(z, x, y);
    const extent = DEFAULT_TILE_EXTENT;

    const [west, north] = tileLocalToLngLat(z, x, y, 0, 0, extent);
    const [east, south] = tileLocalToLngLat(z, x, y, extent, extent, extent);

    expect(west).toBeCloseTo(bounds.west, 10);
    expect(east).toBeCloseTo(bounds.east, 10);
    expect(north).toBeCloseTo(bounds.north, 10);
    expect(south).toBeCloseTo(bounds.south, 10);
  });

  it("allows buffer coordinates outside 0..extent (seam overlap)", () => {
    const z = 14;
    const x = 8185;
    const y = 5447;
    const bounds = tileBounds(z, x, y);
    // Negative pixel = west of the tile's western edge (buffer geometry)
    const [lng] = tileLocalToLngLat(z, x, y, -64, DEFAULT_TILE_EXTENT / 2);
    expect(lng).toBeLessThan(bounds.west);
  });
});
