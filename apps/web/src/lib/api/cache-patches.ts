import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import type { BusMessage, RunSnapshot } from "@/lib/api/types";
import type { RuntimeTargetState as TargetState, SimulationEvent as Event } from "@/types/target";

function asEvent(payload: unknown): Event | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Partial<Event>;
  if (typeof candidate.id !== "string" || typeof candidate.targetId !== "string") return null;
  return payload as Event;
}

function asTargetState(payload: unknown): TargetState | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Partial<TargetState>;
  if (typeof candidate.targetId !== "string") return null;
  return payload as TargetState;
}

/** Apply an ops WebSocket message onto the run snapshot Query cache. */
export function patchSnapshotFromOpsMessage(
  queryClient: QueryClient,
  runId: string,
  message: BusMessage,
) {
  const key = queryKeys.runs.snapshot(runId);

  queryClient.setQueryData<RunSnapshot>(key, (current) => {
    if (!current) return current;
    switch (message.type) {
      case "event.ingested": {
        const event = asEvent(message.payload);
        if (!event) return current;
        if (current.ingestedEvents.some((existing) => existing.id === event.id)) return current;
        return {
          ...current,
          ingestedEvents: [...current.ingestedEvents, event],
          processedEventIds: current.processedEventIds.includes(event.id)
            ? current.processedEventIds
            : [...current.processedEventIds, event.id],
          asOf: new Date().toISOString(),
        };
      }
      case "alert.raised": {
        const eventId =
          message.payload &&
          typeof message.payload === "object" &&
          "eventId" in message.payload &&
          typeof (message.payload as { eventId: unknown }).eventId === "string"
            ? (message.payload as { eventId: string }).eventId
            : null;
        if (!eventId || current.criticalAlertIds.includes(eventId)) return current;
        return {
          ...current,
          criticalAlertIds: [...current.criticalAlertIds, eventId],
          asOf: new Date().toISOString(),
        };
      }
      case "target.updated": {
        const state = asTargetState(message.payload);
        if (!state) return current;
        return {
          ...current,
          targetStates: { ...current.targetStates, [state.targetId]: state },
          asOf: new Date().toISOString(),
        };
      }
      case "catchup.target.updated": {
        const payload = message.payload as { targetStates?: Record<string, TargetState> };
        if (!payload?.targetStates) return current;
        return {
          ...current,
          targetStates: { ...current.targetStates, ...payload.targetStates },
          asOf: new Date().toISOString(),
        };
      }
      case "run.completed": {
        const completedAt =
          message.payload &&
          typeof message.payload === "object" &&
          "completedAt" in message.payload &&
          typeof (message.payload as { completedAt: unknown }).completedAt === "string"
            ? (message.payload as { completedAt: string }).completedAt
            : new Date().toISOString();
        return {
          ...current,
          status: "completed",
          run: { ...current.run, status: "completed", completedAt },
          asOf: completedAt,
        };
      }
      case "run.stopped": {
        const stoppedAt =
          message.payload &&
          typeof message.payload === "object" &&
          "stoppedAt" in message.payload &&
          typeof (message.payload as { stoppedAt: unknown }).stoppedAt === "string"
            ? (message.payload as { stoppedAt: string }).stoppedAt
            : new Date().toISOString();
        return {
          ...current,
          status: "stopped",
          run: { ...current.run, status: "stopped", stoppedAt },
          asOf: stoppedAt,
        };
      }
      default:
        return current;
    }
  });

  if (message.type === "run.completed" || message.type === "run.stopped") {
    void queryClient.invalidateQueries({ queryKey: queryKeys.runs.list() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.runs.list(true) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.runs.detail(runId) });
  }

  if (
    message.type === "target.updated" ||
    message.type === "catchup.target.updated" ||
    message.type === "run.completed" ||
    message.type === "run.stopped"
  ) {
    void queryClient.invalidateQueries({
      queryKey: [...queryKeys.runs.all, "viewport", runId],
    });
  }
}

/** Apply a map WebSocket message onto matching viewport query caches. */
export function patchViewportFromMapMessage(
  queryClient: QueryClient,
  runId: string,
  message: BusMessage,
) {
  if (
    message.type !== "target.updated" &&
    message.type !== "catchup.target.updated" &&
    message.type !== "run.completed" &&
    message.type !== "run.stopped"
  ) {
    return;
  }

  queryClient.setQueriesData(
    { queryKey: [...queryKeys.runs.all, "viewport", runId] },
    (current: unknown) => {
      if (!current || typeof current !== "object") return current;
      const snap = current as {
        targetStates: Record<string, TargetState>;
        status: string;
        run: { status: string; completedAt?: string; stoppedAt?: string };
        asOf: string;
      };

      if (message.type === "target.updated") {
        const state = asTargetState(message.payload);
        if (!state) return current;
        if (!(state.targetId in snap.targetStates)) {
          // Eviction: ignore updates for targets not in the current viewport slice.
          return current;
        }
        return {
          ...snap,
          targetStates: { ...snap.targetStates, [state.targetId]: state },
          asOf: new Date().toISOString(),
        };
      }

      if (message.type === "catchup.target.updated") {
        const payload = message.payload as {
          targetStates?: Record<string, TargetState>;
        };
        if (!payload?.targetStates) return current;
        const next = { ...snap.targetStates };
        for (const [id, state] of Object.entries(payload.targetStates)) {
          if (id in next) next[id] = state;
        }
        return { ...snap, targetStates: next, asOf: new Date().toISOString() };
      }

      if (message.type === "run.completed") {
        return {
          ...snap,
          status: "completed",
          run: { ...snap.run, status: "completed" },
          asOf: new Date().toISOString(),
        };
      }

      if (message.type === "run.stopped") {
        return {
          ...snap,
          status: "stopped",
          run: { ...snap.run, status: "stopped" },
          asOf: new Date().toISOString(),
        };
      }

      return current;
    },
  );
}
