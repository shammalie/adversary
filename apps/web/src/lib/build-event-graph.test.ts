import { describe, expect, it } from "vitest";

import {
  buildEventGraph,
  EVENT_GRAPH_HORIZONTAL_GAP,
  EVENT_GRAPH_VERTICAL_GAP,
  formatEventDeltaMs,
} from "@/lib/build-event-graph";
import type { SimulationEvent, TargetDefinition } from "@/types/target";

const target: TargetDefinition = {
  id: "target-1",
  callsign: "ALPHA",
  revealOnFirstEvent: false,
  color: "#0e7490",
  profile: {
    vehicleCategory: "car",
    affiliation: "friendly",
    status: "active",
  },
};

function event(
  id: string,
  at: string,
  extras?: Partial<SimulationEvent>,
): SimulationEvent {
  return {
    id,
    targetId: "target-1",
    at,
    position: { latitude: 51.5, longitude: -0.12 },
    ...extras,
  };
}

describe("formatEventDeltaMs", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatEventDeltaMs(500)).toBe("Δ500ms");
    expect(formatEventDeltaMs(12_000)).toBe("Δ12s");
    expect(formatEventDeltaMs(125_000)).toBe("Δ2m 5s");
    expect(formatEventDeltaMs(3_600_000)).toBe("Δ1h");
    expect(formatEventDeltaMs(3_720_000)).toBe("Δ1h 2m");
  });
});

describe("buildEventGraph", () => {
  it("builds a horizontal temporal chain for one target", () => {
    const events = [
      event("e2", "2026-07-24T12:10:00.000Z"),
      event("e1", "2026-07-24T12:00:00.000Z"),
      event("e3", "2026-07-24T12:15:00.000Z", {
        message: "checkpoint",
        position: undefined,
      }),
    ];

    const { nodes, edges } = buildEventGraph({
      target,
      events,
      currentEventId: "e1",
      priorityTerms: [],
      layout: "horizontal",
    });

    expect(nodes.map((node) => node.id)).toEqual(["e1", "e2", "e3"]);
    expect(nodes[0]?.position).toEqual({ x: 0, y: 0 });
    expect(nodes[1]?.position).toEqual({ x: EVENT_GRAPH_HORIZONTAL_GAP, y: 0 });
    expect(nodes.every((node) => node.position.y === 0)).toBe(true);
    expect(nodes[0]?.data.playback).toBe("current");
    expect(nodes[1]?.data.playback).toBe("future");
    expect(nodes[2]?.data.hasMessage).toBe(true);
    expect(nodes[2]?.data.hasPosition).toBe(false);
    expect(nodes[2]?.data.kind).toBe("message");

    expect(edges).toHaveLength(2);
    expect(edges[0]?.id).toBe("e1->e2");
    expect(edges[0]?.data?.deltaLabel).toBe("Δ10m");
    expect(edges[0]?.data?.active).toBe(false);
    expect(edges[0]?.data?.layout).toBe("horizontal");
  });

  it("builds a vertical temporal chain aligned on a shared x axis", () => {
    const { nodes } = buildEventGraph({
      target,
      events: [
        event("e1", "2026-07-24T12:00:00.000Z"),
        event("e2", "2026-07-24T12:10:00.000Z"),
      ],
      currentEventId: "e1",
      layout: "vertical",
    });

    expect(nodes[0]?.position).toEqual({ x: 0, y: 0 });
    expect(nodes[1]?.position).toEqual({ x: 0, y: EVENT_GRAPH_VERTICAL_GAP });
    expect(nodes.every((node) => node.position.x === 0)).toBe(true);
    expect(nodes[0]?.data.layout).toBe("vertical");
  });

  it("ignores events for other targets", () => {
    const { nodes } = buildEventGraph({
      target,
      events: [
        event("mine", "2026-07-24T12:00:00.000Z"),
        {
          id: "other",
          targetId: "target-2",
          at: "2026-07-24T12:01:00.000Z",
          position: { latitude: 1, longitude: 1 },
        },
      ],
    });
    expect(nodes.map((node) => node.id)).toEqual(["mine"]);
  });

  it("marks priority messages and past/current edge states", () => {
    const { nodes, edges } = buildEventGraph({
      target,
      events: [
        event("e1", "2026-07-24T12:00:00.000Z", { message: "mayday contact" }),
        event("e2", "2026-07-24T12:05:00.000Z"),
        event("e3", "2026-07-24T12:10:00.000Z"),
      ],
      currentEventId: "e2",
      priorityTerms: ["mayday"],
    });

    expect(nodes[0]?.data.priority).toBe(true);
    expect(nodes[0]?.data.playback).toBe("past");
    expect(nodes[1]?.data.playback).toBe("current");
    expect(edges[0]?.data?.past).toBe(false);
    expect(edges[0]?.data?.active).toBe(true);
    expect(edges[1]?.data?.past).toBe(false);
    expect(edges[1]?.data?.active).toBe(false);
  });

  it("treats all nodes as future when no current event is due", () => {
    const { nodes, edges } = buildEventGraph({
      target,
      events: [
        event("e1", "2026-07-24T12:00:00.000Z"),
        event("e2", "2026-07-24T12:05:00.000Z"),
      ],
      currentEventId: null,
    });

    expect(nodes.every((node) => node.data.playback === "future")).toBe(true);
    expect(edges.every((edge) => edge.data?.active === false && edge.data?.past === false)).toBe(
      true,
    );
  });
});
