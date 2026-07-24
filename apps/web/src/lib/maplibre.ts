import { Protocol } from "pmtiles";
import { setWorkerUrl, addProtocol, type StyleSpecification } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

import {
  getOnlineMapStyle,
  isOnlineStyleUrl,
  ONLINE_MAP_STYLE,
  ONLINE_MAP_STYLE_DARK,
  ONLINE_MAP_STYLE_LIGHT,
  type MapColorScheme,
} from "@/lib/map-styles";
import { readRegionBlob, getActiveRegion } from "@/lib/offline-regions/storage";

export {
  getOnlineMapStyle,
  ONLINE_MAP_STYLE,
  ONLINE_MAP_STYLE_DARK,
  ONLINE_MAP_STYLE_LIGHT,
  type MapColorScheme,
} from "@/lib/map-styles";

setWorkerUrl(workerUrl);

/** @deprecated Use resolveMapStyle() instead. */
export const MAP_STYLE = ONLINE_MAP_STYLE;

let protocolRegistered = false;
const pmtilesBlobUrls = new Map<string, string>();

function ensurePmtilesProtocol() {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

export function registerPmtilesProtocol() {
  ensurePmtilesProtocol();
}

function rewriteStyleForLocalPmtiles(
  style: StyleSpecification,
  pmtilesUrl: string,
): StyleSpecification {
  const next = structuredClone(style);
  for (const source of Object.values(next.sources ?? {})) {
    if ("url" in source && typeof source.url === "string" && source.url.includes(".pmtiles")) {
      source.url = `pmtiles://${pmtilesUrl}`;
    }
  }
  return next;
}

export async function getPmtilesBlobUrl(regionId: string): Promise<string | null> {
  const cached = pmtilesBlobUrls.get(regionId);
  if (cached) return cached;

  const data = await readRegionBlob(regionId, "pmtiles");
  if (!data) return null;

  const url = URL.createObjectURL(new Blob([data], { type: "application/vnd.pmtiles" }));
  pmtilesBlobUrls.set(regionId, url);
  return url;
}

export async function resolveMapStyle(
  theme: MapColorScheme = "dark",
): Promise<string | StyleSpecification> {
  registerPmtilesProtocol();

  const active = await getActiveRegion();
  if (!active) {
    return getOnlineMapStyle(theme);
  }

  const [styleBuffer, pmtilesUrl] = await Promise.all([
    readRegionBlob(active.id, "style"),
    getPmtilesBlobUrl(active.id),
  ]);

  if (!styleBuffer || !pmtilesUrl) {
    return getOnlineMapStyle(theme);
  }

  try {
    const style = JSON.parse(new TextDecoder().decode(styleBuffer)) as StyleSpecification;
    return rewriteStyleForLocalPmtiles(style, pmtilesUrl);
  } catch {
    return getOnlineMapStyle(theme);
  }
}

export function isOnline(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

export async function resolveMapStyleWithFallback(
  theme: MapColorScheme = "dark",
): Promise<{
  style: string | StyleSpecification;
  source: "local" | "online";
}> {
  const active = await getActiveRegion();
  if (active) {
    const style = await resolveMapStyle(theme);
    if (typeof style !== "string" || !isOnlineStyleUrl(style)) {
      return { style, source: "local" };
    }
  }

  if (isOnline()) {
    return { style: getOnlineMapStyle(theme), source: "online" };
  }

  throw new Error("No offline map region is active and the network is unavailable.");
}

export function revokePmtilesBlobUrl(regionId: string) {
  const url = pmtilesBlobUrls.get(regionId);
  if (url) {
    URL.revokeObjectURL(url);
    pmtilesBlobUrls.delete(regionId);
  }
}

export function clearPmtilesBlobUrls() {
  for (const [regionId] of pmtilesBlobUrls) {
    revokePmtilesBlobUrl(regionId);
  }
}
