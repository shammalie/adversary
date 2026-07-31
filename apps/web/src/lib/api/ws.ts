import { wsUrl } from "@/lib/api/client";
import type { BusMessage, ViewportBBox } from "@/lib/api/types";

export type MapViewportControl = ViewportBBox & {
  type: "map.viewport";
  zoom?: number;
  includeTargetIds?: string[];
};

type WsHandlers = {
  onMessage: (message: BusMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
};

function connectJsonWs(path: string, handlers: WsHandlers): WebSocket {
  const socket = new WebSocket(wsUrl(path));
  socket.addEventListener("open", () => handlers.onOpen?.());
  socket.addEventListener("close", () => handlers.onClose?.());
  socket.addEventListener("error", (event) => handlers.onError?.(event));
  socket.addEventListener("message", (event) => {
    try {
      const parsed = JSON.parse(String(event.data)) as BusMessage;
      if (parsed && typeof parsed.type === "string") {
        handlers.onMessage(parsed);
      }
    } catch {
      // ignore malformed frames
    }
  });
  return socket;
}

export function connectOpsWebSocket(runId: string, handlers: WsHandlers): WebSocket {
  return connectJsonWs(`/v1/runs/${runId}/ws/ops`, handlers);
}

export function connectMapWebSocket(
  runId: string,
  initial: ViewportBBox & { zoom?: number; includeTargetIds?: string[] },
  handlers: WsHandlers,
): { socket: WebSocket; sendViewport: (next: Omit<MapViewportControl, "type">) => void } {
  const params = new URLSearchParams({
    west: String(initial.west),
    south: String(initial.south),
    east: String(initial.east),
    north: String(initial.north),
  });
  if (initial.zoom !== undefined) params.set("zoom", String(initial.zoom));
  if (initial.includeTargetIds?.length) {
    params.set("includeTargetIds", initial.includeTargetIds.join(","));
  }

  const socket = connectJsonWs(`/v1/runs/${runId}/ws/map?${params.toString()}`, handlers);

  function sendViewport(next: Omit<MapViewportControl, "type">) {
    if (socket.readyState !== WebSocket.OPEN) return;
    const control: MapViewportControl = { type: "map.viewport", ...next };
    socket.send(JSON.stringify(control));
  }

  return { socket, sendViewport };
}
