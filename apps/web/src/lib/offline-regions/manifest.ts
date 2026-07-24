import { z } from "zod";

export const OFFLINE_PACKAGE_SCHEMA_VERSION = 2 as const;

export const offlineRegionManifestSchema = z.object({
  schemaVersion: z.literal(OFFLINE_PACKAGE_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  files: z
    .object({
      pmtiles: z.string().min(1),
      style: z.string().min(1),
    })
    .strict(),
});

export type OfflineRegionManifest = z.infer<typeof offlineRegionManifestSchema>;

export interface StoredOfflineRegion extends OfflineRegionManifest {
  importedAt: string;
  packageSizeBytes: number;
  isActive: boolean;
}

export const REQUIRED_PACKAGE_FILES = ["manifest.json", "style.json"] as const;

export function parseManifestJson(raw: unknown): OfflineRegionManifest {
  if (
    raw &&
    typeof raw === "object" &&
    "files" in raw &&
    raw.files &&
    typeof raw.files === "object" &&
    "railNetwork" in (raw.files as object)
  ) {
    throw new Error(
      "Manifest must not declare railNetwork; rail packages are no longer supported. Re-export without rail data using schema version 2.",
    );
  }
  return offlineRegionManifestSchema.parse(raw);
}

export function isCompatibleStoredRegion(region: { schemaVersion?: number }): boolean {
  return region.schemaVersion === OFFLINE_PACKAGE_SCHEMA_VERSION;
}

export function isWithinBounds(
  latitude: number,
  longitude: number,
  bounds: OfflineRegionManifest["bounds"],
) {
  const [west, south, east, north] = bounds;
  return longitude >= west && longitude <= east && latitude >= south && latitude <= north;
}
