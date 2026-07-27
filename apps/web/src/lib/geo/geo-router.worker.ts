/// <reference lib="webworker" />

import {
  isGeoRouterRequest,
  type GeoRouterRequest,
  type GeoRouterResponse,
} from "@/lib/geo/geo-router-protocol";
import {
  routeRoad,
  type RoadVehicleKind,
} from "@/lib/geo/road-router";
import {
  routeSea,
  seaRouteToWorkerCoordinates,
  unpackSeaSeeds,
  type ColumnarSeaSeeds,
} from "@/lib/geo/sea-router";
import { VectorTileClient } from "@/lib/geo/vector-tile-client";

declare const self: DedicatedWorkerGlobalScope;

/** In-flight route work keyed by requestId — cancelled via a follow-up message. */
const inflight = new Map<string, AbortController>();

function post(message: GeoRouterResponse): void {
  self.postMessage(message);
}

function handlePing(requestId: string): void {
  post({ type: "pong", requestId });
}

function handleCancel(requestId: string): void {
  const controller = inflight.get(requestId);
  if (!controller) return;
  controller.abort();
  inflight.delete(requestId);
  post({ type: "cancelled", requestId });
}

function readSeaOptions(options: Record<string, unknown> | undefined): {
  seeds?: ReturnType<typeof unpackSeaSeeds>;
  gridZoom?: number;
  cellsPerTile?: number;
  ferrySnapM?: number;
  portSnapM?: number;
  waterwaySnapM?: number;
} {
  if (!options) return {};
  const out: ReturnType<typeof readSeaOptions> = {};
  if (options.seeds && typeof options.seeds === "object") {
    out.seeds = unpackSeaSeeds(options.seeds as ColumnarSeaSeeds);
  }
  if (typeof options.gridZoom === "number") out.gridZoom = options.gridZoom;
  if (typeof options.cellsPerTile === "number") out.cellsPerTile = options.cellsPerTile;
  if (typeof options.ferrySnapM === "number") out.ferrySnapM = options.ferrySnapM;
  if (typeof options.portSnapM === "number") out.portSnapM = options.portSnapM;
  if (typeof options.waterwaySnapM === "number") out.waterwaySnapM = options.waterwaySnapM;
  return out;
}

function readRoadOptions(options: Record<string, unknown> | undefined): {
  vehicle?: RoadVehicleKind;
} {
  if (!options) return {};
  if (options.vehicle === "car" || options.vehicle === "truck") {
    return { vehicle: options.vehicle };
  }
  return {};
}

/**
 * Phase 2 routers plug in here. Road (2a) and sea (2b) are live; air remains 2c.
 * Honours AbortSignal so phase 4a can cancel mid-flight tile work.
 */
async function handleRoute(message: Extract<GeoRouterRequest, { type: "route" }>): Promise<void> {
  const controller = new AbortController();
  inflight.set(message.requestId, controller);

  try {
    if (controller.signal.aborted) {
      post({ type: "cancelled", requestId: message.requestId });
      return;
    }

    if (message.mode === "road") {
      const client = new VectorTileClient();
      const roadOpts = readRoadOptions(message.options);
      const result = await routeRoad(
        {
          longitude: message.origin.longitude,
          latitude: message.origin.latitude,
        },
        {
          longitude: message.destination.longitude,
          latitude: message.destination.latitude,
        },
        {
          source: client,
          signal: controller.signal,
          ...roadOpts,
        },
      );
      if (controller.signal.aborted) {
        post({ type: "cancelled", requestId: message.requestId });
        return;
      }
      if (!result.ok) {
        post({
          type: "error",
          requestId: message.requestId,
          message: result.message,
        });
        return;
      }
      post({
        type: "route-result",
        requestId: message.requestId,
        mode: "road",
        coordinates: result.coordinates,
      });
      return;
    }

    if (message.mode === "sea") {
      const client = new VectorTileClient();
      const seaOpts = readSeaOptions(message.options);
      const result = await routeSea(
        [message.origin.longitude, message.origin.latitude],
        [message.destination.longitude, message.destination.latitude],
        {
          source: client,
          signal: controller.signal,
          ...seaOpts,
        },
      );
      if (controller.signal.aborted) {
        post({ type: "cancelled", requestId: message.requestId });
        return;
      }
      const mapped = seaRouteToWorkerCoordinates(result);
      if (!mapped.ok) {
        post({
          type: "error",
          requestId: message.requestId,
          message: mapped.message,
        });
        return;
      }
      post({
        type: "route-result",
        requestId: message.requestId,
        mode: "sea",
        coordinates: mapped.coordinates,
      });
      return;
    }

    // Air arrives in phase 2c.
    void message.origin;
    void message.destination;
    void message.options;

    post({
      type: "route-result",
      requestId: message.requestId,
      mode: message.mode,
      coordinates: [],
    });
  } catch (error) {
    if (controller.signal.aborted) {
      post({ type: "cancelled", requestId: message.requestId });
      return;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    post({ type: "error", requestId: message.requestId, message: errorMessage });
  } finally {
    inflight.delete(message.requestId);
  }
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (!isGeoRouterRequest(data)) {
    post({
      type: "error",
      requestId: "unknown",
      message: "Invalid geo-router request",
    });
    return;
  }

  switch (data.type) {
    case "ping":
      handlePing(data.requestId);
      break;
    case "cancel":
      handleCancel(data.requestId);
      break;
    case "route":
      void handleRoute(data);
      break;
  }
};
