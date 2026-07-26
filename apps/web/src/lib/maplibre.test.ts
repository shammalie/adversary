import { describe, expect, it } from "vitest";

import {
  getOnlineMapStyle,
  ONLINE_MAP_STYLE,
  ONLINE_MAP_STYLE_DARK,
  ONLINE_MAP_STYLE_LIGHT,
} from "@/lib/map-styles";
import { isOnline, resolveMapStyle } from "@/lib/maplibre";

describe("map styles", () => {
  it("reports online state from navigator", () => {
    expect(typeof isOnline()).toBe("boolean");
  });

  it("exposes configured dark style as the default export", () => {
    expect(ONLINE_MAP_STYLE).toBe(ONLINE_MAP_STYLE_DARK);
    expect(ONLINE_MAP_STYLE_DARK).toMatch(/^https?:\/\//);
    expect(ONLINE_MAP_STYLE_LIGHT).toMatch(/^https?:\/\//);
  });

  it("selects light and dark styles from env", () => {
    expect(getOnlineMapStyle("dark")).toBe(ONLINE_MAP_STYLE_DARK);
    expect(getOnlineMapStyle("light")).toBe(ONLINE_MAP_STYLE_LIGHT);
    expect(resolveMapStyle("light")).toBe(ONLINE_MAP_STYLE_LIGHT);
  });
});
