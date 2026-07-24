import JSZip from "jszip";
import { describe, expect, it, beforeEach } from "vitest";

import { OfflinePackageError, importOfflineRegionZip } from "@/lib/offline-regions/import";
import { OFFLINE_PACKAGE_SCHEMA_VERSION } from "@/lib/offline-regions/manifest";
import {
  getActiveRegion,
  getStoredRegion,
  listStoredRegions,
  purgeIncompatibleRegions,
  resetOfflineRegionsDbForTests,
} from "@/lib/offline-regions/storage";

async function buildSamplePackage(overrides?: { manifest?: Record<string, unknown> }) {
  const zip = new JSZip();
  const manifest = overrides?.manifest ?? {
    schemaVersion: OFFLINE_PACKAGE_SCHEMA_VERSION,
    id: "region-test",
    name: "Test Region",
    bounds: [-0.2, 51.4, 0, 51.6],
    files: {
      pmtiles: "tiles/region.pmtiles",
      style: "style.json",
    },
  };

  zip.file("manifest.json", JSON.stringify(manifest));
  zip.file("style.json", JSON.stringify({ version: 8, sources: {}, layers: [] }));
  zip.file("tiles/region.pmtiles", new Uint8Array([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73]));

  return zip.generateAsync({ type: "arraybuffer" });
}

describe("offline region packages", () => {
  beforeEach(async () => {
    await resetOfflineRegionsDbForTests();
  });

  it("imports and activates a valid package", async () => {
    const blob = await buildSamplePackage();
    const stored = await importOfflineRegionZip(blob);
    expect(stored.id).toBe("region-test");
    expect(stored.isActive).toBe(true);
    expect(stored.schemaVersion).toBe(OFFLINE_PACKAGE_SCHEMA_VERSION);
    expect(await getActiveRegion()).toMatchObject({ id: "region-test" });
    expect(await listStoredRegions()).toHaveLength(1);
  });

  it("rejects packages without manifest", async () => {
    const zip = new JSZip();
    zip.file("style.json", "{}");
    const blob = await zip.generateAsync({ type: "arraybuffer" });
    await expect(importOfflineRegionZip(blob)).rejects.toBeInstanceOf(OfflinePackageError);
  });

  it("rejects invalid manifest versions", async () => {
    const blob = await buildSamplePackage({
      manifest: {
        schemaVersion: 99,
        id: "bad",
        name: "Bad",
        bounds: [0, 0, 1, 1],
        files: {
          pmtiles: "tiles/region.pmtiles",
          style: "style.json",
        },
      },
    });
    await expect(importOfflineRegionZip(blob)).rejects.toBeInstanceOf(OfflinePackageError);
  });

  it("rejects manifests that still declare railNetwork", async () => {
    const blob = await buildSamplePackage({
      manifest: {
        schemaVersion: OFFLINE_PACKAGE_SCHEMA_VERSION,
        id: "legacy-rail",
        name: "Legacy Rail",
        bounds: [0, 0, 1, 1],
        files: {
          pmtiles: "tiles/region.pmtiles",
          style: "style.json",
          railNetwork: "rail/network.geojson",
        },
      },
    });
    await expect(importOfflineRegionZip(blob)).rejects.toThrow(/railNetwork/i);
  });

  it("rejects schema v1 packages", async () => {
    const blob = await buildSamplePackage({
      manifest: {
        schemaVersion: 1,
        id: "v1",
        name: "V1",
        bounds: [0, 0, 1, 1],
        files: {
          pmtiles: "tiles/region.pmtiles",
          style: "style.json",
          railNetwork: "rail/network.geojson",
        },
      },
    });
    await expect(importOfflineRegionZip(blob)).rejects.toBeInstanceOf(OfflinePackageError);
  });

  it("rejects missing package members", async () => {
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        schemaVersion: OFFLINE_PACKAGE_SCHEMA_VERSION,
        id: "incomplete",
        name: "Incomplete",
        bounds: [0, 0, 1, 1],
        files: {
          pmtiles: "tiles/missing.pmtiles",
          style: "style.json",
        },
      }),
    );
    zip.file("style.json", JSON.stringify({ version: 8, sources: {}, layers: [] }));
    const blob = await zip.generateAsync({ type: "arraybuffer" });
    await expect(importOfflineRegionZip(blob)).rejects.toBeInstanceOf(OfflinePackageError);
  });

  it("persists blobs retrievable by region id", async () => {
    const blob = await buildSamplePackage();
    const stored = await importOfflineRegionZip(blob);
    const region = await getStoredRegion(stored.id);
    expect(region?.packageSizeBytes).toBeGreaterThan(0);
  });

  it("purges incompatible stored regions and clears active selection", async () => {
    const blob = await buildSamplePackage({
      manifest: {
        schemaVersion: OFFLINE_PACKAGE_SCHEMA_VERSION,
        id: "old-region",
        name: "Old",
        bounds: [0, 0, 1, 1],
        files: { pmtiles: "tiles/region.pmtiles", style: "style.json" },
      },
    });
    await importOfflineRegionZip(blob);
    const db = await (
      await import("idb")
    ).openDB("adversary-offline-regions", 1);
    const region = await db.get("regions", "old-region");
    await db.put("regions", { ...region, schemaVersion: 1 });
    db.close();

    expect(await getActiveRegion()).toMatchObject({ id: "old-region", schemaVersion: 1 });
    const result = await purgeIncompatibleRegions();
    expect(result.removedIds).toEqual(["old-region"]);
    expect(result.clearedActive).toBe(true);
    expect(await listStoredRegions()).toHaveLength(0);
    expect(await getActiveRegion()).toBeUndefined();
  });
});
