import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import { parseScenario } from "@/lib/simulation-schema";
import { applyFastForwardTimes } from "@/lib/scenario-timing";
import type { SimulationScenario } from "@/types/target";

const DB_NAME = "adversary-simulations";
const DB_VERSION = 1;
const LEGACY_SCENARIOS_KEY = "adversary:scenarios:v2";

export type StoredScenarioRecord = {
  id: string;
  payload: unknown;
  name: string;
  updatedAt: string;
  importedAt: string;
};

interface SimulationsDb extends DBSchema {
  scenarios: {
    key: string;
    value: StoredScenarioRecord;
    indexes: { "by-updated": string };
  };
}

let dbPromise: Promise<IDBPDatabase<SimulationsDb>> | null = null;
let migrationPromise: Promise<void> | null = null;

export async function resetSimulationsDbForTests() {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore close errors during test reset
    }
  }
  dbPromise = null;
  migrationPromise = null;

  const db = await openDB<SimulationsDb>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("scenarios")) {
        const store = database.createObjectStore("scenarios", { keyPath: "id" });
        store.createIndex("by-updated", "updatedAt");
      }
    },
  });
  await db.clear("scenarios");
  db.close();
}

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<SimulationsDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore("scenarios", { keyPath: "id" });
        store.createIndex("by-updated", "updatedAt");
      },
    });
  }
  return dbPromise;
}

function readLegacyScenarios(): unknown[] {
  if (typeof window === "undefined" || !("localStorage" in window)) return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_SCENARIOS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clearLegacyScenarios() {
  if (typeof window === "undefined" || !("localStorage" in window)) return;
  try {
    window.localStorage.removeItem(LEGACY_SCENARIOS_KEY);
  } catch {
    // ignore quota / privacy errors
  }
}

function extractName(payload: unknown): string {
  if (payload && typeof payload === "object" && "name" in payload) {
    const name = (payload as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return "Untitled import";
}

function extractId(payload: unknown): string {
  if (payload && typeof payload === "object" && "id" in payload) {
    const id = (payload as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return crypto.randomUUID();
}

function extractUpdatedAt(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "updatedAt" in payload) {
    const updatedAt = (payload as { updatedAt?: unknown }).updatedAt;
    if (typeof updatedAt === "string" && updatedAt.trim()) return updatedAt;
  }
  return fallback;
}

function toRecord(payload: unknown, existing?: StoredScenarioRecord): StoredScenarioRecord {
  const now = new Date().toISOString();
  const id = existing?.id ?? extractId(payload);
  const importedAt = existing?.importedAt ?? now;
  return {
    id,
    payload,
    name: extractName(payload),
    updatedAt: extractUpdatedAt(payload, now),
    importedAt,
  };
}

async function migrateLegacyScenariosIfNeeded() {
  const db = await getDb();
  const count = await db.count("scenarios");
  if (count > 0) return;

  const legacy = readLegacyScenarios();
  if (legacy.length === 0) return;

  const tx = db.transaction("scenarios", "readwrite");
  for (const candidate of legacy) {
    await tx.store.put(toRecord(candidate));
  }
  await tx.done;
  clearLegacyScenarios();
}

async function ensureMigrated() {
  if (!migrationPromise) {
    migrationPromise = migrateLegacyScenariosIfNeeded();
  }
  await migrationPromise;
}

export async function listScenarios(): Promise<StoredScenarioRecord[]> {
  await ensureMigrated();
  const db = await getDb();
  const records = await db.getAllFromIndex("scenarios", "by-updated");
  return records.toReversed();
}

export async function getScenario(id: string): Promise<StoredScenarioRecord | null> {
  await ensureMigrated();
  const db = await getDb();
  return (await db.get("scenarios", id)) ?? null;
}

export async function saveScenarioDraft(payload: unknown): Promise<StoredScenarioRecord> {
  await ensureMigrated();
  const parsed =
    typeof payload === "string"
      ? (JSON.parse(payload) as unknown)
      : payload && typeof payload === "object"
        ? structuredClone(payload)
        : payload;

  const db = await getDb();
  const id = extractId(parsed);
  const existing = await db.get("scenarios", id);
  const record = toRecord(parsed, existing);
  record.updatedAt = new Date().toISOString();
  await db.put("scenarios", record);
  return record;
}

export async function upsertValidScenario(scenario: SimulationScenario): Promise<StoredScenarioRecord> {
  const parsed = parseScenario(scenario);
  return saveScenarioDraft(parsed);
}

export async function deleteScenario(id: string): Promise<void> {
  await ensureMigrated();
  const db = await getDb();
  await db.delete("scenarios", id);
}

export function coerceEditableScenario(payload: unknown, recordId: string): SimulationScenario {
  const now = new Date().toISOString();
  const blank: SimulationScenario = {
    schemaVersion: 2,
    id: recordId,
    name: "Untitled operation",
    description: "",
    createdAt: now,
    updatedAt: now,
    priorityTerms: [],
    targets: [],
    events: [],
  };

  if (!payload || typeof payload !== "object") return blank;

  const candidate = payload as Partial<SimulationScenario>;
  return applyFastForwardTimes({
    schemaVersion: 2,
    id: recordId,
    name: typeof candidate.name === "string" ? candidate.name : blank.name,
    description: typeof candidate.description === "string" ? candidate.description : blank.description,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : blank.createdAt,
    updatedAt: now,
    delaySeconds:
      typeof candidate.delaySeconds === "number" &&
      Number.isFinite(candidate.delaySeconds) &&
      candidate.delaySeconds >= 0
        ? candidate.delaySeconds
        : undefined,
    fastForwardMultiplier:
      typeof candidate.fastForwardMultiplier === "number" &&
      Number.isFinite(candidate.fastForwardMultiplier) &&
      candidate.fastForwardMultiplier > 1 &&
      candidate.fastForwardMultiplier <= 10
        ? candidate.fastForwardMultiplier
        : undefined,
    priorityTerms: Array.isArray(candidate.priorityTerms)
      ? candidate.priorityTerms.filter((term): term is string => typeof term === "string")
      : [],
    targets: Array.isArray(candidate.targets)
      ? candidate.targets.map((raw) => {
          if (!raw || typeof raw !== "object") return raw;
          const target = { ...(raw as unknown as Record<string, unknown>) };
          const maxCruise = target.maxCruiseKnots;
          if (
            typeof maxCruise === "number" &&
            Number.isFinite(maxCruise) &&
            maxCruise >= 0
          ) {
            target.maxCruiseKnots = maxCruise;
          } else {
            delete target.maxCruiseKnots;
          }
          return target as unknown as SimulationScenario["targets"][number];
        })
      : [],
    events: Array.isArray(candidate.events) ? candidate.events : [],
  });
}
