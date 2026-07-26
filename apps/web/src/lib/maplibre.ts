import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

import {
  getOnlineMapStyle,
  ONLINE_MAP_STYLE,
  ONLINE_MAP_STYLE_DARK,
  ONLINE_MAP_STYLE_LIGHT,
  type MapColorScheme,
} from "@/lib/map-styles";

export {
  getOnlineMapStyle,
  ONLINE_MAP_STYLE,
  ONLINE_MAP_STYLE_DARK,
  ONLINE_MAP_STYLE_LIGHT,
  type MapColorScheme,
} from "@/lib/map-styles";

setWorkerUrl(workerUrl);

/** @deprecated Use getOnlineMapStyle() instead. */
export const MAP_STYLE = ONLINE_MAP_STYLE;

export function resolveMapStyle(theme: MapColorScheme = "dark"): string {
  return getOnlineMapStyle(theme);
}

export function isOnline(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}
