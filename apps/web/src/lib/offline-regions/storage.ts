import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { OfflineRegionManifest, StoredOfflineRegion } from "@/lib/offline-regions/manifest";
import { isCompatibleStoredRegion } from "@/lib/offline-regions/manifest";

const DB_NAME = "adversary-offline-regions";
const DB_VERSION = 1;

interface OfflineRegionsDb extends DBSchema {
  regions: {
    key: string;
    value: StoredOfflineRegion;
    indexes: { "by-active": number };
  };
  blobs: {
    key: string;
    value: {
      key: string;
      regionId: string;
      kind: "pmtiles" | "style";
      data: ArrayBuffer;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineRegionsDb>> | null = null;

export async function resetOfflineRegionsDbForTests() {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore close errors during test reset
    }
  }
  dbPromise = null;
  // Clear stores without deleteDatabase (avoids blocked-delete hangs with open connections).
  const db = await openDB<OfflineRegionsDb>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("regions")) {
        const regions = database.createObjectStore("regions", { keyPath: "id" });
        regions.createIndex("by-active", "isActive");
      }
      if (!database.objectStoreNames.contains("blobs")) {
        database.createObjectStore("blobs", { keyPath: "key" });
      }
    },
  });
  await db.clear("regions");
  await db.clear("blobs");
  db.close();
}

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<OfflineRegionsDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const regions = db.createObjectStore("regions", { keyPath: "id" });
        regions.createIndex("by-active", "isActive");
        db.createObjectStore("blobs", { keyPath: "key" });
      },
    });
  }
  return dbPromise;
}

function blobKey(regionId: string, kind: "pmtiles" | "style") {
  return `${regionId}:${kind}`;
}

export async function listStoredRegions(): Promise<StoredOfflineRegion[]> {
  const db = await getDb();
  return db.getAll("regions");
}

export async function getStoredRegion(regionId: string): Promise<StoredOfflineRegion | undefined> {
  const db = await getDb();
  return db.get("regions", regionId);
}

export async function getActiveRegion(): Promise<StoredOfflineRegion | undefined> {
  const db = await getDb();
  const regions = await db.getAll("regions");
  return regions.find((region) => region.isActive);
}

export async function storeRegionPackage(input: {
  manifest: OfflineRegionManifest;
  pmtiles: ArrayBuffer;
  style: ArrayBuffer;
  packageSizeBytes: number;
  activate?: boolean;
}): Promise<StoredOfflineRegion> {
  const db = await getDb();
  const importedAt = new Date().toISOString();
  const tx = db.transaction(["regions", "blobs"], "readwrite");

  if (input.activate ?? true) {
    const existing = await tx.objectStore("regions").getAll();
    for (const region of existing) {
      if (region.isActive) {
        await tx.objectStore("regions").put({ ...region, isActive: false });
      }
    }
  }

  const stored: StoredOfflineRegion = {
    ...input.manifest,
    importedAt,
    packageSizeBytes: input.packageSizeBytes,
    isActive: input.activate ?? true,
  };

  await tx.objectStore("regions").put(stored);
  await tx.objectStore("blobs").put({
    key: blobKey(stored.id, "pmtiles"),
    regionId: stored.id,
    kind: "pmtiles",
    data: input.pmtiles,
  });
  await tx.objectStore("blobs").put({
    key: blobKey(stored.id, "style"),
    regionId: stored.id,
    kind: "style",
    data: input.style,
  });
  await tx.done;
  return stored;
}

export async function readRegionBlob(
  regionId: string,
  kind: "pmtiles" | "style",
): Promise<ArrayBuffer | undefined> {
  const db = await getDb();
  return (await db.get("blobs", blobKey(regionId, kind)))?.data;
}

export async function setActiveRegion(
  regionId: string | null,
): Promise<StoredOfflineRegion | null> {
  const db = await getDb();
  const regions = await db.getAll("regions");
  const tx = db.transaction("regions", "readwrite");

  for (const region of regions) {
    await tx.store.put({ ...region, isActive: regionId !== null && region.id === regionId });
  }
  await tx.done;

  if (!regionId) return null;
  return (await getStoredRegion(regionId)) ?? null;
}

export async function removeRegion(regionId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["regions", "blobs"], "readwrite");
  await tx.objectStore("regions").delete(regionId);
  for (const kind of ["pmtiles", "style"] as const) {
    await tx.objectStore("blobs").delete(blobKey(regionId, kind));
  }
  // Legacy rail blobs from schema v1 packages
  await tx.objectStore("blobs").delete(`${regionId}:railNetwork`);
  await tx.done;
}

/** Deletes stored regions whose schemaVersion is incompatible with the current package schema. */
export async function purgeIncompatibleRegions(): Promise<{
  removedIds: string[];
  clearedActive: boolean;
}> {
  const regions = await listStoredRegions();
  const incompatible = regions.filter((region) => !isCompatibleStoredRegion(region));
  if (incompatible.length === 0) {
    return { removedIds: [], clearedActive: false };
  }

  const clearedActive = incompatible.some((region) => region.isActive);
  for (const region of incompatible) {
    await removeRegion(region.id);
  }
  if (clearedActive) {
    await setActiveRegion(null);
  }
  return {
    removedIds: incompatible.map((region) => region.id),
    clearedActive,
  };
}
