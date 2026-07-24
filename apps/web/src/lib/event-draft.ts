import { hasEventPayload } from "@/lib/position-telemetry";
import { simulationEventSchema } from "@/lib/simulation-schema";
import { sortEvents } from "@/lib/simulation-engine";
import type { PositionPayload, SimulationEvent } from "@/types/target";

export interface EventDraft {
  id?: string;
  targetId: string;
  at: string;
  includePosition: boolean;
  includeMessage: boolean;
  message: string;
  position: PositionPayload;
}

const DEFAULT_POSITION: PositionPayload = {
  latitude: 51.5074,
  longitude: -0.1278,
  altitude: 0,
};

export function createEventDraft(targetId = ""): EventDraft {
  return {
    targetId,
    at: new Date(Date.now() + 5 * 60_000).toISOString(),
    includePosition: true,
    includeMessage: false,
    message: "",
    position: { ...DEFAULT_POSITION },
  };
}

export function draftFromEvent(event: SimulationEvent): EventDraft {
  return {
    id: event.id,
    targetId: event.targetId,
    at: event.at,
    includePosition: Boolean(event.position),
    includeMessage: Boolean(event.message),
    message: event.message ?? "",
    position: event.position ? { ...event.position } : { ...DEFAULT_POSITION },
  };
}

export function eventFromDraft(draft: EventDraft): SimulationEvent | null {
  if (!draft.targetId || !draft.at) return null;
  if (!draft.includePosition && !(draft.includeMessage && draft.message.trim())) return null;

  const candidate: SimulationEvent = {
    id: draft.id ?? crypto.randomUUID(),
    targetId: draft.targetId,
    at: draft.at,
    position: draft.includePosition ? draft.position : undefined,
    message: draft.includeMessage ? draft.message.trim() : undefined,
  };

  if (!hasEventPayload(candidate)) return null;
  const result = simulationEventSchema.safeParse(candidate);
  return result.success ? (result.data as SimulationEvent) : null;
}

export function replaceEvent(
  events: SimulationEvent[],
  updated: SimulationEvent,
): SimulationEvent[] | null {
  if (!events.some((event) => event.id === updated.id)) return null;
  const result = simulationEventSchema.safeParse(updated);
  if (!result.success) return null;
  return sortEvents(
    events.map((event) => (event.id === updated.id ? (result.data as SimulationEvent) : event)),
  );
}
