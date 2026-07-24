import { describe, expect, it } from "vitest";

import { isWithinBounds } from "@/lib/offline-regions/manifest";

describe("offline manifest helpers", () => {
  it("checks whether coordinates fall inside region bounds", () => {
    const bounds: [number, number, number, number] = [-0.2, 51.4, 0, 51.6];
    expect(isWithinBounds(51.5, -0.1, bounds)).toBe(true);
    expect(isWithinBounds(52, 0.5, bounds)).toBe(false);
  });
});
