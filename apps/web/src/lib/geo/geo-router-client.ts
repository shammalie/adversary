/**
 * Host-side client for the geo-router Web Worker.
 *
 * Cancellation: AbortSignal is **not** transferred into the worker. Aborting
 * the caller's signal posts `{ type: "cancel", requestId }` so the worker's
 * in-flight AbortController can tear down tile fetches.
 */

import { createGeoRouterWorker } from "@/lib/geo/geo-router";
import type {
  GeoRouterLngLat,
  GeoRouterMode,
  GeoRouterRequest,
  GeoRouterResponse,
} from "@/lib/geo/geo-router-protocol";

export type GeoRouteRequest = {
  mode: GeoRouterMode;
  origin: GeoRouterLngLat;
  destination: GeoRouterLngLat;
  options?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type GeoRouterClient = {
  route: (request: GeoRouteRequest) => Promise<GeoRouterLngLat[]>;
  terminate: () => void;
};

type Pending = {
  resolve: (coordinates: GeoRouterLngLat[]) => void;
  reject: (error: Error) => void;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function createGeoRouterClient(worker?: Worker): GeoRouterClient {
  const w = worker ?? createGeoRouterWorker();
  const pending = new Map<string, Pending>();

  const onMessage = (event: MessageEvent<GeoRouterResponse>) => {
    const message = event.data;
    if (!message || typeof message !== "object" || !("requestId" in message)) {
      return;
    }
    const entry = pending.get(message.requestId);
    if (!entry) return;
    pending.delete(message.requestId);

    switch (message.type) {
      case "route-result":
        entry.resolve(message.coordinates);
        break;
      case "cancelled":
        entry.reject(
          new DOMException("Geo route request was cancelled.", "AbortError"),
        );
        break;
      case "error":
        entry.reject(new Error(message.message));
        break;
      case "pong":
        entry.resolve([]);
        break;
    }
  };

  w.addEventListener("message", onMessage as EventListener);

  return {
    async route(request) {
      if (request.signal?.aborted) {
        throw new DOMException("Geo route request was cancelled.", "AbortError");
      }

      const requestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `route-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const payload: GeoRouterRequest = {
        type: "route",
        requestId,
        mode: request.mode,
        origin: request.origin,
        destination: request.destination,
        options: request.options,
      };

      return new Promise<GeoRouterLngLat[]>((resolve, reject) => {
        const onAbort = () => {
          w.postMessage({ type: "cancel", requestId } satisfies GeoRouterRequest);
        };

        pending.set(requestId, {
          resolve: (coordinates) => {
            request.signal?.removeEventListener("abort", onAbort);
            resolve(coordinates);
          },
          reject: (error) => {
            request.signal?.removeEventListener("abort", onAbort);
            reject(error);
          },
        });

        request.signal?.addEventListener("abort", onAbort, { once: true });
        w.postMessage(payload);
      }).catch((error: unknown) => {
        if (isAbortError(error)) throw error;
        throw error instanceof Error ? error : new Error(String(error));
      });
    },
    terminate() {
      w.removeEventListener("message", onMessage as EventListener);
      for (const [requestId, entry] of pending) {
        pending.delete(requestId);
        entry.reject(
          new DOMException("Geo router client terminated.", "AbortError"),
        );
      }
      w.terminate();
    },
  };
}
