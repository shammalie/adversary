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

export const DEFAULT_EVENT_POSITION: PositionPayload = {
  latitude: 51.5074,
  longitude: -0.1278,
  altitude: 0,
};

export const DEFAULT_INCLUDE_POSITION = true;
export const DEFAULT_INCLUDE_MESSAGE = true;

const FOLLOW_ON_OFFSET_MS = 5 * 60_000;

export function createEventDraft(targetId = ""): EventDraft {
  return {
    targetId,
    at: new Date(Date.now() + FOLLOW_ON_OFFSET_MS).toISOString(),
    includePosition: DEFAULT_INCLUDE_POSITION,
    includeMessage: DEFAULT_INCLUDE_MESSAGE,
    message: "",
    position: { ...DEFAULT_EVENT_POSITION },
  };
}

/** Latest position for a target from existing events (authoring order, then by time). */
export function lastPositionForTarget(
  events: SimulationEvent[],
  targetId: string,
): PositionPayload | null {
  let latest: { at: string; position: PositionPayload } | null = null;
  for (const event of events) {
    if (event.targetId !== targetId || !event.position) continue;
    if (!latest || event.at >= latest.at) {
      latest = { at: event.at, position: event.position };
    }
  }
  return latest ? { ...latest.position } : null;
}

/** Draft after a successful Add for the same target: keep switches + map pin, clear message, step time. */
export function createFollowOnDraft(draft: EventDraft): EventDraft {
  const baseAt = Number.isNaN(Date.parse(draft.at)) ? Date.now() : Date.parse(draft.at);
  return {
    targetId: draft.targetId,
    at: new Date(baseAt + FOLLOW_ON_OFFSET_MS).toISOString(),
    includePosition: draft.includePosition,
    includeMessage: draft.includeMessage,
    message: "",
    position: { ...draft.position },
  };
}

/** Draft when switching event target: payload switches reset to defaults; map uses that target's last pin. */
export function createDraftForTargetChange(
  targetId: string,
  events: SimulationEvent[],
  currentAt: string,
): EventDraft {
  return {
    targetId,
    at: currentAt,
    includePosition: DEFAULT_INCLUDE_POSITION,
    includeMessage: DEFAULT_INCLUDE_MESSAGE,
    message: "",
    position: lastPositionForTarget(events, targetId) ?? { ...DEFAULT_EVENT_POSITION },
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
    position: event.position ? { ...event.position } : { ...DEFAULT_EVENT_POSITION },
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
