import {
  getScenario,
  listScenarios,
  type StoredScenarioRecord,
} from "@/lib/simulation-idb-storage";
import { getScenarioApi, putScenarioDraftApi } from "@/lib/api/scenarios";
import { ApiError } from "@/lib/api/client";

const MIGRATE_FLAG_KEY = "adversary:idb-server-migrate:v1";

export type IdbConflict = {
  id: string;
  name: string;
  idbUpdatedAt: string;
  serverUpdatedAt: string;
  idbPayload: unknown;
  serverPayload: unknown;
};

export type ConflictChoice = "keep-server" | "keep-local";

export type MigrateProgress = {
  total: number;
  done: number;
  conflicts: IdbConflict[];
};

function canUseStorage() {
  return typeof window !== "undefined" && "localStorage" in window;
}

export function isIdbMigrationComplete(): boolean {
  if (!canUseStorage()) return true;
  try {
    return window.localStorage.getItem(MIGRATE_FLAG_KEY) === "done";
  } catch {
    return false;
  }
}

export function markIdbMigrationComplete() {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(MIGRATE_FLAG_KEY, "done");
  } catch {
    // ignore quota / privacy mode
  }
}

async function serverDraftExists(id: string): Promise<{ exists: boolean; detail?: Awaited<ReturnType<typeof getScenarioApi>> }> {
  try {
    const detail = await getScenarioApi(id);
    return { exists: true, detail };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { exists: false };
    }
    throw error;
  }
}

/**
 * One-shot IDB → server draft migration.
 * When both sides have the same id, yields a conflict for the caller to prompt the user.
 * Never auto-merges. After completion, callers must stop writing IDB.
 */
export async function migrateIdbDraftsToServer(options: {
  onConflict: (conflict: IdbConflict) => Promise<ConflictChoice>;
  onProgress?: (progress: MigrateProgress) => void;
}): Promise<{ migrated: number; skipped: number; conflictsResolved: number }> {
  if (isIdbMigrationComplete()) {
    return { migrated: 0, skipped: 0, conflictsResolved: 0 };
  }

  const records = await listScenarios();
  let migrated = 0;
  let skipped = 0;
  let conflictsResolved = 0;
  const conflicts: IdbConflict[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    options.onProgress?.({ total: records.length, done: index, conflicts });

    const remote = await serverDraftExists(record.id);
    if (!remote.exists) {
      await putScenarioDraftApi(record.id, record.payload);
      migrated += 1;
      continue;
    }

    const serverUpdated = remote.detail?.updatedAt ?? "";
    const idbUpdated = record.updatedAt;
    // Same id on both sides → always prompt (locked: never auto-merge).
    const conflict: IdbConflict = {
      id: record.id,
      name: record.name,
      idbUpdatedAt: idbUpdated,
      serverUpdatedAt: serverUpdated,
      idbPayload: record.payload,
      serverPayload: remote.detail?.payload,
    };
    conflicts.push(conflict);
    const choice = await options.onConflict(conflict);
    conflictsResolved += 1;
    if (choice === "keep-local") {
      await putScenarioDraftApi(record.id, record.payload);
      migrated += 1;
    } else {
      skipped += 1;
    }
  }

  options.onProgress?.({
    total: records.length,
    done: records.length,
    conflicts,
  });
  markIdbMigrationComplete();
  return { migrated, skipped, conflictsResolved };
}

export async function peekIdbRecord(id: string): Promise<StoredScenarioRecord | null> {
  return getScenario(id);
}
