import { useEffect, useEffectEvent, useRef } from "react";

import { usePutDraftMutation } from "@/hooks/use-scenarios";
import type { SimulationScenario } from "@/types/target";

const DEFAULT_DEBOUNCE_MS = 600;

/**
 * Debounced PUT .../draft for builder autosave.
 * Optimistic UX: caller keeps local scenario state; this mirrors to the server.
 */
export function useDraftAutosave(
  scenario: SimulationScenario | null,
  options?: { enabled?: boolean; debounceMs?: number },
) {
  const enabled = options?.enabled ?? true;
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const putDraft = usePutDraftMutation();
  const timerRef = useRef<number | undefined>(undefined);
  const lastSerializedRef = useRef<string>("");

  const flush = useEffectEvent((next: SimulationScenario) => {
    const serialized = JSON.stringify(next);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;
    putDraft.mutate({ id: next.id, payload: next });
  });

  useEffect(() => {
    if (!enabled || !scenario) return;

    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      flush(scenario);
    }, debounceMs);

    return () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [debounceMs, enabled, scenario]);

  return {
    isSaving: putDraft.isPending,
    isError: putDraft.isError,
    error: putDraft.error,
    saveNow: (next: SimulationScenario) => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      flush(next);
    },
    lastSavedAt: putDraft.data?.updatedAt,
  };
}
