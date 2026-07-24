import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";

import { createRuntime, reconcileRuntime, stopRuntime } from "@/lib/simulation-engine";
import { loadRuntime, saveRuntime } from "@/lib/simulation-storage";
import type { SimulationRuntime, SimulationScenario } from "@/types/target";

interface SimulationContextValue {
  runtime: SimulationRuntime | null;
  start: (scenario: SimulationScenario) => void;
  stop: () => void;
  reset: () => void;
  reconcile: () => void;
}

const SimulationContext = createContext<SimulationContextValue | null>(null);

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const [runtime, setRuntime] = useState<SimulationRuntime | null>(() => {
    const stored = loadRuntime();
    return stored ? reconcileRuntime(stored) : null;
  });

  const updateRuntime = useCallback(
    (updater: (current: SimulationRuntime) => SimulationRuntime) => {
      setRuntime((current) => {
        if (!current) return current;
        const next = updater(current);
        saveRuntime(next);
        return next;
      });
    },
    [],
  );

  const reconcile = useCallback(() => {
    updateRuntime((current) => reconcileRuntime(current));
  }, [updateRuntime]);

  useEffect(() => {
    if (runtime?.status !== "running") return;
    reconcile();
    const interval = window.setInterval(reconcile, 1_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [reconcile, runtime?.status]);

  const value = useMemo<SimulationContextValue>(
    () => ({
      runtime,
      start(scenario) {
        const next = reconcileRuntime(createRuntime(scenario));
        saveRuntime(next);
        setRuntime(next);
      },
      stop() {
        updateRuntime((current) => stopRuntime(current));
      },
      reset() {
        saveRuntime(null);
        setRuntime(null);
      },
      reconcile,
    }),
    [reconcile, runtime, updateRuntime],
  );

  return <SimulationContext value={value}>{children}</SimulationContext>;
}

export function useSimulation() {
  const context = use(SimulationContext);
  if (!context) throw new Error("useSimulation must be used inside SimulationProvider.");
  return context;
}
