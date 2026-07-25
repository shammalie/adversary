import { describe, expect, it } from "vitest";

import {
  createDraftForTargetChange,
  createEventDraft,
  createFollowOnDraft,
  draftFromEvent,
  eventFromDraft,
  lastPositionForTarget,
  replaceEvent,
} from "@/lib/event-draft";
import type { SimulationEvent } from "@/types/target";

const baseEvent: SimulationEvent = {
  id: "event-1",
  targetId: "target-1",
  at: "2026-07-24T12:00:00.000Z",
  position: { latitude: 51.5, longitude: -0.12, altitude: 100 },
  message: "Contact steady",
};

describe("event draft", () => {
  it("defaults position and message switches on", () => {
    const draft = createEventDraft("target-1");
    expect(draft.includePosition).toBe(true);
    expect(draft.includeMessage).toBe(true);
  });

  it("round-trips unified events through draft state", () => {
    const draft = draftFromEvent(baseEvent);
    expect(draft.includePosition).toBe(true);
    expect(draft.includeMessage).toBe(true);
    expect(eventFromDraft(draft)).toEqual(baseEvent);
  });

  it("rejects drafts without any payload section", () => {
    const draft = createEventDraft("target-1");
    draft.includePosition = false;
    draft.includeMessage = false;
    expect(eventFromDraft(draft)).toBeNull();
  });

  it("preserves event id when editing", () => {
    const draft = draftFromEvent(baseEvent);
    draft.message = "Updated message";
    draft.includeMessage = true;
    const updated = eventFromDraft(draft);
    expect(updated?.id).toBe("event-1");
    expect(updated?.message).toBe("Updated message");
  });

  it("replaces and re-sorts events in a scenario list", () => {
    const events: SimulationEvent[] = [
      baseEvent,
      {
        id: "event-2",
        targetId: "target-1",
        at: "2026-07-24T12:10:00.000Z",
        message: "Later",
      },
    ];
    const updated = eventFromDraft({
      ...draftFromEvent(baseEvent),
      at: "2026-07-24T12:15:00.000Z",
    });
    expect(updated).not.toBeNull();
    const next = replaceEvent(events, updated!);
    expect(next?.map((event) => event.id)).toEqual(["event-2", "event-1"]);
  });

  it("returns null when schema validation fails", () => {
    const draft = createEventDraft("target-1");
    draft.includeMessage = true;
    draft.message = "   ";
    draft.includePosition = false;
    expect(eventFromDraft(draft)).toBeNull();
  });

  it("follow-on draft keeps switches and map pin, clears message, steps time", () => {
    const draft = createEventDraft("target-1");
    draft.includePosition = false;
    draft.includeMessage = true;
    draft.message = "note";
    draft.position = { latitude: 52, longitude: 1, altitude: 10 };
    draft.at = "2026-07-24T12:00:00.000Z";

    const next = createFollowOnDraft(draft);
    expect(next.targetId).toBe("target-1");
    expect(next.includePosition).toBe(false);
    expect(next.includeMessage).toBe(true);
    expect(next.message).toBe("");
    expect(next.position).toEqual({ latitude: 52, longitude: 1, altitude: 10 });
    expect(next.at).toBe("2026-07-24T12:05:00.000Z");
  });

  it("target change resets switches to defaults and loads last position", () => {
    const events: SimulationEvent[] = [
      baseEvent,
      {
        id: "event-2",
        targetId: "target-2",
        at: "2026-07-24T13:00:00.000Z",
        position: { latitude: 48.8, longitude: 2.3, altitude: 50 },
      },
    ];
    const next = createDraftForTargetChange("target-2", events, "2026-07-24T12:00:00.000Z");
    expect(next.includePosition).toBe(true);
    expect(next.includeMessage).toBe(true);
    expect(next.message).toBe("");
    expect(next.position).toEqual({ latitude: 48.8, longitude: 2.3, altitude: 50 });
    expect(next.at).toBe("2026-07-24T12:00:00.000Z");
  });

  it("finds the latest position for a target", () => {
    const events: SimulationEvent[] = [
      baseEvent,
      {
        id: "event-3",
        targetId: "target-1",
        at: "2026-07-24T11:00:00.000Z",
        position: { latitude: 1, longitude: 2, altitude: 3 },
      },
      {
        id: "event-4",
        targetId: "target-1",
        at: "2026-07-24T14:00:00.000Z",
        position: { latitude: 9, longitude: 8, altitude: 7 },
      },
    ];
    expect(lastPositionForTarget(events, "target-1")).toEqual({
      latitude: 9,
      longitude: 8,
      altitude: 7,
    });
    expect(lastPositionForTarget(events, "missing")).toBeNull();
  });
});
