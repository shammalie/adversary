export type MapColorScheme = "light" | "dark";

export const ONLINE_MAP_STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
export const ONLINE_MAP_STYLE_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

/** @deprecated Prefer getOnlineMapStyle(theme). Defaults to dark. */
export const ONLINE_MAP_STYLE = ONLINE_MAP_STYLE_DARK;

export function getOnlineMapStyle(theme: MapColorScheme = "dark"): string {
  return theme === "light" ? ONLINE_MAP_STYLE_LIGHT : ONLINE_MAP_STYLE_DARK;
}

export function isOnlineStyleUrl(style: string): boolean {
  return style === ONLINE_MAP_STYLE_DARK || style === ONLINE_MAP_STYLE_LIGHT;
}
