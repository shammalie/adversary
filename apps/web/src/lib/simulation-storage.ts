import { parseScenario } from "@/lib/simulation-schema";
import {
  coerceEditableScenario,
  deleteScenario as deleteScenarioFromIdb,
  getScenario,
  listScenarios,
  saveScenarioDraft,
  upsertValidScenario,
  type StoredScenarioRecord,
} from "@/lib/simulation-idb-storage";
import {
  isLegacyScenario,
  migrateRetiredVehicleCategories,
  migrateScenarioV1ToV2,
} from "@/lib/scenario-migration";
import { validateScenario } from "@/lib/simulation-schema";
import type { SimulationRuntime, SimulationScenario } from "@/types/target";

const ACTIVE_RUNTIME_KEY = "adversary:active-runtime:v2";
const LEGACY_RUNTIME_KEY = "adversary:active-runtime:v1";

function canUseStorage() {
  return typeof window !== "undefined" && "localStorage" in window;
}

function safeRead(key: string): unknown {
  if (!canUseStorage()) return null;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: unknown) {
  if (!canUseStorage()) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key: string) {
  if (!canUseStorage()) return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function rewriteRetiredCategories(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object") return candidate;
  const scenario = candidate as { targets?: Array<{ profile?: { vehicleCategory?: unknown } }> };
  if (!Array.isArray(scenario.targets)) return candidate;
  return {
    ...scenario,
    targets: scenario.targets.map((target) => {
      if (!target?.profile || target.profile.vehicleCategory !== "rail") return target;
      return {
        ...target,
        profile: { ...target.profile, vehicleCategory: "other" },
      };
    }),
  };
}

function normalizeScenario(candidate: unknown): SimulationScenario | null {
  if (isLegacyScenario(candidate)) return migrateScenarioV1ToV2(candidate);
  const rewritten = rewriteRetiredCategories(candidate);
  const result = validateScenario(rewritten);
  if (!result.success) return null;
  return migrateRetiredVehicleCategories(result.data as SimulationScenario);
}

export {
  coerceEditableScenario,
  deleteScenarioFromIdb as deleteScenario,
  getScenario,
  listScenarios,
  saveScenarioDraft,
  upsertValidScenario,
  type StoredScenarioRecord,
};

export function exportScenario(scenario: SimulationScenario) {
  return JSON.stringify(parseScenario(scenario), null, 2);
}

export function downloadScenario(scenario: SimulationScenario) {
  const blob = new Blob([exportScenario(scenario)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${scenario.name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-") || "scenario"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function loadRuntime(): SimulationRuntime | null {
  safeRemove(LEGACY_RUNTIME_KEY);
  const stored = safeRead(ACTIVE_RUNTIME_KEY);
  if (!stored || typeof stored !== "object") return null;
  const runtime = stored as Partial<SimulationRuntime>;
  if (runtime.schemaVersion !== 2 || !runtime.scenario || !runtime.startedAt) return null;
  const scenario = normalizeScenario(runtime.scenario);
  if (!scenario) return null;

  const targetStates = runtime.targetStates ?? {};
  const normalizedStates = Object.fromEntries(
    scenario.targets.map((definition) => {
      const current = targetStates[definition.id];
      if (!current) {
        return [
          definition.id,
          {
            targetId: definition.id,
            callsign: definition.callsign,
            color: definition.color,
            profile: definition.revealOnFirstEvent ? {} : { ...definition.profile },
            revealed: !definition.revealOnFirstEvent,
            appeared: !definition.appearOnFirstEvent,
            trail: [],
          },
        ];
      }
      const appeared =
        typeof current.appeared === "boolean"
          ? current.appeared
          : !definition.appearOnFirstEvent || Boolean(current.lastEventAt);
      return [definition.id, { ...current, appeared }];
    }),
  );

  return { ...runtime, scenario, targetStates: normalizedStates } as SimulationRuntime;
}

export function saveRuntime(runtime: SimulationRuntime | null) {
  if (!runtime) {
    return safeRemove(ACTIVE_RUNTIME_KEY);
  }
  return safeWrite(ACTIVE_RUNTIME_KEY, runtime);
}
