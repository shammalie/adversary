import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { patchSnapshotFromOpsMessage } from "@/lib/api/cache-patches";
import { queryKeys } from "@/lib/api/query-keys";
import type { RunSnapshot } from "@/lib/api/types";

function emptySnapshot(): RunSnapshot {
  return {
    run: {
      id: "run-1",
      scenarioId: "sc-1",
      status: "running",
      startAt: new Date().toISOString(),
      scheduleOffsetMs: 0,
      startedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    status: "running",
    processedEventIds: [],
    ingestedEvents: [],
    targetStates: {},
    criticalAlertIds: [],
    asOf: new Date().toISOString(),
  };
}

describe("patchSnapshotFromOpsMessage", () => {
  it("appends ingested events and patches target state", () => {
    const client = new QueryClient();
    const key = queryKeys.runs.snapshot("run-1");
    client.setQueryData(key, emptySnapshot());

    patchSnapshotFromOpsMessage(client, "run-1", {
      type: "event.ingested",
      runId: "run-1",
      payload: {
        id: "ev-1",
        targetId: "t-1",
        at: new Date().toISOString(),
      },
    });

    patchSnapshotFromOpsMessage(client, "run-1", {
      type: "target.updated",
      runId: "run-1",
      payload: {
        targetId: "t-1",
        callsign: "ALPHA",
        color: "#fff",
        profile: {},
        revealed: true,
        appeared: true,
        trail: [],
      },
    });

    const snap = client.getQueryData<RunSnapshot>(key);
    expect(snap?.ingestedEvents).toHaveLength(1);
    expect(snap?.processedEventIds).toEqual(["ev-1"]);
    expect(snap?.targetStates["t-1"]?.callsign).toBe("ALPHA");
  });

  it("marks run completed", () => {
    const client = new QueryClient();
    const key = queryKeys.runs.snapshot("run-1");
    client.setQueryData(key, emptySnapshot());

    patchSnapshotFromOpsMessage(client, "run-1", {
      type: "run.completed",
      runId: "run-1",
      payload: { completedAt: "2026-01-01T00:00:00.000Z" },
    });

    const snap = client.getQueryData<RunSnapshot>(key);
    expect(snap?.status).toBe("completed");
    expect(snap?.run.status).toBe("completed");
  });
});
