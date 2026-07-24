import { describe, expect, it } from "vitest";

import {
  getOnlineMapStyle,
  ONLINE_MAP_STYLE,
  ONLINE_MAP_STYLE_DARK,
  ONLINE_MAP_STYLE_LIGHT,
} from "@/lib/map-styles";
import { isOnline } from "@/lib/maplibre";

describe("map source fallback", () => {
  it("reports online state from navigator", () => {
    expect(typeof isOnline()).toBe("boolean");
  });

  it("exposes the online carto fallback style", () => {
    expect(ONLINE_MAP_STYLE).toContain("cartocdn.com");
    expect(ONLINE_MAP_STYLE).toBe(ONLINE_MAP_STYLE_DARK);
  });

  it("selects Dark Matter for dark theme and Positron for light", () => {
    expect(getOnlineMapStyle("dark")).toBe(ONLINE_MAP_STYLE_DARK);
    expect(getOnlineMapStyle("light")).toBe(ONLINE_MAP_STYLE_LIGHT);
    expect(ONLINE_MAP_STYLE_DARK).toContain("dark-matter");
    expect(ONLINE_MAP_STYLE_LIGHT).toContain("positron");
  });
});
