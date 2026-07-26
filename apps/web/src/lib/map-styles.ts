import { env } from "@adversary/env/web";

export type MapColorScheme = "light" | "dark";

export const ONLINE_MAP_STYLE_DARK = env.VITE_MAP_STYLE_DARK;
export const ONLINE_MAP_STYLE_LIGHT = env.VITE_MAP_STYLE_LIGHT;

/** @deprecated Prefer getOnlineMapStyle(theme). Defaults to dark. */
export const ONLINE_MAP_STYLE = ONLINE_MAP_STYLE_DARK;

export function getOnlineMapStyle(theme: MapColorScheme = "dark"): string {
  return theme === "light" ? ONLINE_MAP_STYLE_LIGHT : ONLINE_MAP_STYLE_DARK;
}

export function isConfiguredStyleUrl(style: string): boolean {
  return style === ONLINE_MAP_STYLE_DARK || style === ONLINE_MAP_STYLE_LIGHT;
}

/** @deprecated Use isConfiguredStyleUrl. */
export function isOnlineStyleUrl(style: string): boolean {
  return isConfiguredStyleUrl(style);
}
