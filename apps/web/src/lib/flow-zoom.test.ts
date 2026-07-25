import { describe, expect, it } from "vitest";

import { eventGraphDetailLevel, zoomCompensatedWidth } from "@/lib/flow-zoom";

describe("zoomCompensatedWidth", () => {
  it("keeps base width near 1x zoom", () => {
    expect(zoomCompensatedWidth(1, 1.5)).toBe(1.5);
  });

  it("thickens strokes when zoomed out so borders stay visible", () => {
    expect(zoomCompensatedWidth(0.35, 1.5)).toBeGreaterThan(1.5);
    expect(zoomCompensatedWidth(0.35, 1.5)).toBeLessThanOrEqual(6);
  });

  it("does not shrink below the base when zoomed in", () => {
    expect(zoomCompensatedWidth(1.5, 1.5)).toBe(1.5);
  });
});

describe("eventGraphDetailLevel", () => {
  it("shows type only when zoomed out", () => {
    expect(eventGraphDetailLevel(0.35)).toBe("type");
    expect(eventGraphDetailLevel(0.64)).toBe("type");
  });

  it("shows time summary at mid zoom", () => {
    expect(eventGraphDetailLevel(0.65)).toBe("summary");
    expect(eventGraphDetailLevel(0.99)).toBe("summary");
  });

  it("shows full details when zoomed in", () => {
    expect(eventGraphDetailLevel(1)).toBe("full");
    expect(eventGraphDetailLevel(1.5)).toBe("full");
  });
});
