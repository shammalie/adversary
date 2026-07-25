import type { Edge, Node } from "@xyflow/react";
import { Position } from "@xyflow/react";

import { isPriorityMessage } from "@/lib/priority-terms";
import { sortEvents } from "@/lib/simulation-engine";
import type { SimulationEvent, TargetDefinition } from "@/types/target";

export type EventPlaybackState = "past" | "current" | "future";
export type EventGraphKind = "position" | "message" | "both" | "empty";
export type EventGraphLayout = "horizontal" | "vertical";

export type EventGraphNodeData = {
  eventId: string;
  at: string;
  targetColor: string;
  callsign: string;
  kind: EventGraphKind;
  layout: EventGraphLayout;
  hasPosition: boolean;
  hasMessage: boolean;
  positionSummary?: string;
  messageSummary?: string;
  playback: EventPlaybackState;
  priority: boolean;
};

export type TimedEventEdgeData = {
  targetColor: string;
  deltaLabel: string;
  layout: EventGraphLayout;
  /** Edge into the current playhead node — uses primary stroke. */
  active: boolean;
  /** Both endpoints are in the past — muted stroke. */
  past: boolean;
};

export type EventGraphNode = Node<EventGraphNodeData, "event">;
export type TimedEventEdge = Edge<TimedEventEdgeData, "timed">;

/** Fixed size so handle centers share an axis and edges stay straight. */
export const EVENT_GRAPH_NODE_WIDTH = 200;
export const EVENT_GRAPH_NODE_HEIGHT = 120;
export const EVENT_GRAPH_HORIZONTAL_GAP = 280;
export const EVENT_GRAPH_VERTICAL_GAP = 168;

/** @deprecated Use EVENT_GRAPH_HORIZONTAL_GAP */
export const EVENT_GRAPH_NODE_GAP = EVENT_GRAPH_HORIZONTAL_GAP;
/** @deprecated Nodes share a shared axis origin instead of a fixed Y. */
export const EVENT_GRAPH_NODE_Y = 0;

export function formatEventDeltaMs(deltaMs: number): string {
  const ms = Math.max(0, Math.round(deltaMs));
  if (ms < 1000) return `Δ${ms}ms`;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `Δ${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  if (totalMin < 60) {
    return remSec > 0 ? `Δ${totalMin}m ${remSec}s` : `Δ${totalMin}m`;
  }
  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  return remMin > 0 ? `Δ${hours}h ${remMin}m` : `Δ${hours}h`;
}

function truncate(text: string, max = 48): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function eventGraphKind(event: SimulationEvent): EventGraphKind {
  const hasPosition = Boolean(event.position);
  const hasMessage = Boolean(event.message?.trim());
  if (hasPosition && hasMessage) return "both";
  if (hasPosition) return "position";
  if (hasMessage) return "message";
  return "empty";
}

/**
 * Playhead styling is driven by the current event id (last due event), not continuous
 * preview clock ticks — so the graph can stay stable between event boundaries.
 */
function playbackStateForEvent(
  eventIndex: number,
  currentIndex: number,
): EventPlaybackState {
  if (currentIndex < 0) return "future";
  if (eventIndex === currentIndex) return "current";
  return eventIndex < currentIndex ? "past" : "future";
}

function nodePosition(index: number, layout: EventGraphLayout) {
  if (layout === "vertical") {
    return { x: 0, y: index * EVENT_GRAPH_VERTICAL_GAP };
  }
  return { x: index * EVENT_GRAPH_HORIZONTAL_GAP, y: 0 };
}

export interface BuildEventGraphInput {
  target: TargetDefinition;
  events: SimulationEvent[];
  currentEventId?: string | null;
  priorityTerms?: string[];
  layout?: EventGraphLayout;
}

export function buildEventGraph({
  target,
  events,
  currentEventId,
  priorityTerms = [],
  layout = "horizontal",
}: BuildEventGraphInput): { nodes: EventGraphNode[]; edges: TimedEventEdge[] } {
  const sorted = sortEvents(events.filter((event) => event.targetId === target.id));
  const currentIndex = currentEventId
    ? sorted.findIndex((event) => event.id === currentEventId)
    : -1;
  const sourcePosition = layout === "vertical" ? Position.Bottom : Position.Right;
  const targetPosition = layout === "vertical" ? Position.Top : Position.Left;

  const nodes: EventGraphNode[] = sorted.map((event, index) => {
    const kind = eventGraphKind(event);
    const hasPosition = kind === "position" || kind === "both";
    const hasMessage = kind === "message" || kind === "both";
    const playback = playbackStateForEvent(index, currentIndex);
    return {
      id: event.id,
      type: "event",
      position: nodePosition(index, layout),
      sourcePosition,
      targetPosition,
      style: {
        width: EVENT_GRAPH_NODE_WIDTH,
        height: EVENT_GRAPH_NODE_HEIGHT,
      },
      data: {
        eventId: event.id,
        at: event.at,
        targetColor: target.color,
        callsign: target.callsign,
        kind,
        layout,
        hasPosition,
        hasMessage,
        positionSummary: event.position
          ? `${event.position.latitude.toFixed(4)}, ${event.position.longitude.toFixed(4)}`
          : undefined,
        messageSummary: event.message ? truncate(event.message) : undefined,
        playback,
        priority: Boolean(event.message && isPriorityMessage(event.message, priorityTerms)),
      },
      draggable: false,
      selectable: true,
    };
  });

  const edges: TimedEventEdge[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const source = sorted[index];
    const targetEvent = sorted[index + 1];
    const sourcePlayback = playbackStateForEvent(index, currentIndex);
    const targetPlayback = playbackStateForEvent(index + 1, currentIndex);
    const deltaMs = Date.parse(targetEvent.at) - Date.parse(source.at);
    edges.push({
      id: `${source.id}->${targetEvent.id}`,
      type: "timed",
      source: source.id,
      target: targetEvent.id,
      data: {
        targetColor: target.color,
        deltaLabel: formatEventDeltaMs(deltaMs),
        layout,
        active: targetPlayback === "current",
        past: sourcePlayback === "past" && targetPlayback === "past",
      },
    });
  }

  return { nodes, edges };
}
