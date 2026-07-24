import { describe, expect, it } from "vitest";

import { createEventDraft, draftFromEvent, eventFromDraft, replaceEvent } from "@/lib/event-draft";
import type { SimulationEvent } from "@/types/target";

const baseEvent: SimulationEvent = {
  id: "event-1",
  targetId: "target-1",
  at: "2026-07-24T12:00:00.000Z",
  position: { latitude: 51.5, longitude: -0.12, altitude: 100 },
  message: "Contact steady",
};

describe("event draft", () => {
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
});
