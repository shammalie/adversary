import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { patchSnapshotFromOpsMessage } from "@/lib/api/cache-patches";
import { connectOpsWebSocket } from "@/lib/api/ws";

/** Subscribe to ops WebSocket and patch/invalidate the run snapshot Query cache. */
export function useOpsWebSocket(runId: string | null | undefined, enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!runId || !enabled) return;

    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let attempt = 0;

    function connect() {
      if (closed) return;
      socket = connectOpsWebSocket(runId!, {
        onMessage(message) {
          patchSnapshotFromOpsMessage(queryClient, runId!, message);
        },
        onOpen() {
          attempt = 0;
        },
        onClose() {
          if (closed) return;
          const delay = Math.min(30_000, 1_000 * 2 ** attempt);
          attempt += 1;
          reconnectTimer = window.setTimeout(connect, delay);
        },
      });
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [enabled, queryClient, runId]);
}
