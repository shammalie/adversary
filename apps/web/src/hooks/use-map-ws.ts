import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { patchViewportFromMapMessage } from "@/lib/api/cache-patches";
import type { ViewportBBox } from "@/lib/api/types";
import { connectMapWebSocket } from "@/lib/api/ws";

/** Subscribe to map WebSocket; send in-band viewport updates; patch viewport Query caches. */
export function useMapWebSocket(
  runId: string | null | undefined,
  bbox: ViewportBBox | null,
  includeTargetIds: string[] = [],
  zoom?: number,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const sendRef = useRef<((next: ViewportBBox & { zoom?: number; includeTargetIds?: string[] }) => void) | null>(
    null,
  );

  useEffect(() => {
    if (!runId || !bbox || !enabled) return;

    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let attempt = 0;

    function connect() {
      if (closed || !bbox) return;
      const connection = connectMapWebSocket(
        runId!,
        { ...bbox, zoom, includeTargetIds },
        {
          onMessage(message) {
            patchViewportFromMapMessage(queryClient, runId!, message);
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
        },
      );
      socket = connection.socket;
      sendRef.current = connection.sendViewport;
    }

    connect();

    return () => {
      closed = true;
      sendRef.current = null;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
    // Reconnect only when run changes; viewport updates go in-band below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional stable socket
  }, [enabled, queryClient, runId]);

  useEffect(() => {
    if (!bbox || !sendRef.current) return;
    sendRef.current({ ...bbox, zoom, includeTargetIds });
  }, [bbox, includeTargetIds, zoom]);
}
