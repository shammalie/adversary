import JSZip from "jszip";

import {
  parseManifestJson,
  type OfflineRegionManifest,
  type StoredOfflineRegion,
} from "@/lib/offline-regions/manifest";
import { storeRegionPackage } from "@/lib/offline-regions/storage";

export class OfflinePackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfflinePackageError";
  }
}

async function readZipEntry(zip: JSZip, path: string): Promise<ArrayBuffer> {
  const entry = zip.file(path);
  if (!entry) {
    throw new OfflinePackageError(`Missing required package file: ${path}`);
  }
  return entry.async("arraybuffer");
}

export async function importOfflineRegionZip(
  file: Blob | ArrayBuffer,
  options?: { activate?: boolean },
): Promise<StoredOfflineRegion> {
  const zip = await JSZip.loadAsync(file);
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) {
    throw new OfflinePackageError("Package must include manifest.json.");
  }

  let manifest: OfflineRegionManifest;
  try {
    manifest = parseManifestJson(JSON.parse(await manifestEntry.async("string")));
  } catch (error) {
    throw new OfflinePackageError(
      error instanceof Error ? error.message : "Invalid manifest.json.",
    );
  }

  const stylePath = manifest.files.style;
  const pmtilesPath = manifest.files.pmtiles;

  const [style, pmtiles] = await Promise.all([
    readZipEntry(zip, stylePath),
    readZipEntry(zip, pmtilesPath),
  ]);

  if (pmtiles.byteLength === 0) {
    throw new OfflinePackageError("PMTiles archive is empty.");
  }

  try {
    JSON.parse(new TextDecoder().decode(style));
  } catch {
    throw new OfflinePackageError("Style file must be valid JSON.");
  }

  return storeRegionPackage({
    manifest,
    style,
    pmtiles,
    packageSizeBytes: file instanceof ArrayBuffer ? file.byteLength : file.size,
    activate: options?.activate,
  });
}
