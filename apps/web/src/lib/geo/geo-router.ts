import geoRouterWorkerUrl from "@/lib/geo/geo-router.worker.ts?url";

export type {
  GeoRouterLngLat,
  GeoRouterMode,
  GeoRouterRequest,
  GeoRouterResponse,
} from "@/lib/geo/geo-router-protocol";
export { isGeoRouterRequest } from "@/lib/geo/geo-router-protocol";

/**
 * App-owned geo router worker. Follows the same `*?url` pattern as
 * `maplibre.ts` (`setWorkerUrl(workerUrl)`), so Vite resolves the worker module
 * outside `optimizeDeps` rewrites.
 */
export function createGeoRouterWorker(): Worker {
  return new Worker(geoRouterWorkerUrl, { type: "module" });
}

export { geoRouterWorkerUrl };
