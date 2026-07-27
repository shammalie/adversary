/**
 * Typed message contract for the geo-router Web Worker.
 *
 * Cancellation uses an explicit `cancel` message keyed by `requestId` rather
 * than transferring AbortSignal (not reliably transferable across worker
 * boundaries). Phase 4a threads AbortController.abort() into `cancel`.
 */

export type GeoRouterLngLat = {
  longitude: number;
  latitude: number;
};

export type GeoRouterMode = "road" | "sea" | "air";

/** Host → worker */
export type GeoRouterRequest =
  | {
      type: "ping";
      requestId: string;
    }
  | {
      type: "cancel";
      /** Abort the in-flight request with this id (AbortSignal equivalent). */
      requestId: string;
    }
  | {
      type: "route";
      requestId: string;
      mode: GeoRouterMode;
      origin: GeoRouterLngLat;
      destination: GeoRouterLngLat;
      /** Opaque options bag — routers fill this in phase 2. */
      options?: Record<string, unknown>;
    };

/** Worker → host */
export type GeoRouterResponse =
  | {
      type: "pong";
      requestId: string;
    }
  | {
      type: "cancelled";
      requestId: string;
    }
  | {
      type: "error";
      requestId: string;
      message: string;
    }
  | {
      type: "route-result";
      requestId: string;
      mode: GeoRouterMode;
      /** Ordered lng/lat polyline. Empty until phase 2 routers land. */
      coordinates: GeoRouterLngLat[];
    };

export function isGeoRouterRequest(value: unknown): value is GeoRouterRequest {
  if (!value || typeof value !== "object") return false;
  const msg = value as { type?: unknown; requestId?: unknown };
  if (typeof msg.type !== "string" || typeof msg.requestId !== "string") return false;
  return msg.type === "ping" || msg.type === "cancel" || msg.type === "route";
}
