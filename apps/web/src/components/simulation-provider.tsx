import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useOpsWebSocket } from "@/hooks/use-ops-ws";
import {
  usePublishScenarioMutation,
  useScenarioQuery,
} from "@/hooks/use-scenarios";
import { useRunSnapshotQuery, useStartRunMutation, useStopRunMutation } from "@/hooks/use-runs";
import { coerceEditableScenario } from "@/lib/simulation-idb-storage";
import { queryKeys } from "@/lib/api/query-keys";
import type { ActiveRuntimeView } from "@/lib/api/types";
import type { SimulationScenario } from "@/types/target";

const ACTIVE_RUN_KEY = "adversary:active-run-id:v1";

interface SimulationContextValue {
  /** Server-backed active run view (null when no run selected). */
  runtime: ActiveRuntimeView | null;
  activeRunId: string | null;
  setActiveRunId: (runId: string | null) => void;
  /** Publish scenario (if needed) and start a server run with optional startAt. */
  start: (scenario: SimulationScenario, startAt?: string) => Promise<string>;
  stop: () => void;
  reset: () => void;
  /** Refetch snapshot (replaces local reconcile). */
  reconcile: () => void;
  isStarting: boolean;
  isStopping: boolean;
}

const SimulationContext = createContext<SimulationContextValue | null>(null);

function readStoredRunId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_RUN_KEY);
  } catch {
    return null;
  }
}

function writeStoredRunId(runId: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (!runId) window.localStorage.removeItem(ACTIVE_RUN_KEY);
    else window.localStorage.setItem(ACTIVE_RUN_KEY, runId);
  } catch {
    // ignore
  }
}

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [activeRunId, setActiveRunIdState] = useState<string | null>(() => readStoredRunId());
  const publish = usePublishScenarioMutation();
  const startRun = useStartRunMutation();
  const stopRun = useStopRunMutation();
  const snapshotQuery = useRunSnapshotQuery(activeRunId);
  const scenarioId = snapshotQuery.data?.run.scenarioId;
  const scenarioQuery = useScenarioQuery(scenarioId);

  useOpsWebSocket(activeRunId, Boolean(activeRunId));

  const setActiveRunId = useCallback((runId: string | null) => {
    setActiveRunIdState(runId);
    writeStoredRunId(runId);
  }, []);

  useEffect(() => {
    if (!snapshotQuery.data) return;
    if (snapshotQuery.data.status === "stopped" || snapshotQuery.data.status === "completed") {
      // Keep viewing finished runs until reset; do not clear id automatically.
    }
  }, [snapshotQuery.data]);

  const runtime = useMemo<ActiveRuntimeView | null>(() => {
    const snap = snapshotQuery.data;
    if (!snap || !activeRunId) return null;
    const payload = scenarioQuery.data?.payload;
    const scenario = coerceEditableScenario(payload ?? {}, snap.run.scenarioId);
    if (snap.run.scenarioName) scenario.name = snap.run.scenarioName;
    return {
      runId: activeRunId,
      scenario,
      status: snap.status,
      startedAt: snap.run.startedAt,
      stoppedAt: snap.run.stoppedAt,
      completedAt: snap.run.completedAt,
      processedEventIds: snap.processedEventIds ?? [],
      ingestedEvents: snap.ingestedEvents ?? [],
      targetStates: snap.targetStates ?? {},
      criticalAlertIds: snap.criticalAlertIds ?? [],
      lastReconciledAt: snap.asOf,
    };
  }, [activeRunId, scenarioQuery.data?.payload, snapshotQuery.data]);

  const value = useMemo<SimulationContextValue>(
    () => ({
      runtime,
      activeRunId,
      setActiveRunId,
      async start(scenario, startAt) {
        await publish.mutateAsync({ id: scenario.id, payload: scenario });
        const created = await startRun.mutateAsync({
          scenarioId: scenario.id,
          startAt,
        });
        const runId = created.runId || created.id;
        setActiveRunId(runId);
        await queryClient.invalidateQueries({ queryKey: queryKeys.runs.snapshot(runId) });
        return runId;
      },
      stop() {
        if (!activeRunId) return;
        stopRun.mutate(activeRunId);
      },
      reset() {
        setActiveRunId(null);
      },
      reconcile() {
        if (!activeRunId) return;
        void queryClient.invalidateQueries({ queryKey: queryKeys.runs.snapshot(activeRunId) });
      },
      isStarting: publish.isPending || startRun.isPending,
      isStopping: stopRun.isPending,
    }),
    [
      activeRunId,
      publish,
      queryClient,
      runtime,
      setActiveRunId,
      startRun,
      stopRun,
    ],
  );

  return <SimulationContext value={value}>{children}</SimulationContext>;
}

export function useSimulation() {
  const context = use(SimulationContext);
  if (!context) throw new Error("useSimulation must be used inside SimulationProvider.");
  return context;
}
