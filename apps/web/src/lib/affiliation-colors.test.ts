import { describe, expect, it } from "vitest";

import {
  AFFILIATION_COLORS,
  isAccessibleAffiliationColor,
  resolveAffiliationColor,
  resolveAffiliationColorTheme,
} from "@/lib/affiliation-colors";
import { contrastRatio, TARGET_COLOR_SURFACES } from "@/lib/target-colors";
import { AFFILIATIONS } from "@/types/target";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

describe("affiliation colors", () => {
  it("resolves light vs dark theme", () => {
    expect(resolveAffiliationColorTheme("light")).toBe("light");
    expect(resolveAffiliationColorTheme("dark")).toBe("dark");
    expect(resolveAffiliationColorTheme(undefined)).toBe("dark");
  });

  it("every affiliation swatch meets AA against its theme surfaces", () => {
    for (const theme of ["light", "dark"] as const) {
      const surfaces = TARGET_COLOR_SURFACES[theme];
      for (const affiliation of AFFILIATIONS) {
        const color = AFFILIATION_COLORS[theme][affiliation];
        expect(
          contrastRatio(color, surfaces.background),
          `${theme} ${affiliation} vs background`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(color, surfaces.muted),
          `${theme} ${affiliation} vs muted`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(isAccessibleAffiliationColor(color, theme)).toBe(true);
      }
    }
  });

  it("falls back to unknown when affiliation is missing", () => {
    expect(resolveAffiliationColor(undefined, "dark")).toBe(
      AFFILIATION_COLORS.dark.unknown,
    );
    expect(resolveAffiliationColor(undefined, "light")).toBe(
      AFFILIATION_COLORS.light.unknown,
    );
  });

  it("returns the palette color for each affiliation", () => {
    for (const affiliation of AFFILIATIONS) {
      expect(resolveAffiliationColor(affiliation, "dark")).toBe(
        AFFILIATION_COLORS.dark[affiliation],
      );
    }
  });

  it("follows hue rules (gray / green / yellow-orange / red)", () => {
    for (const theme of ["light", "dark"] as const) {
      const unknown = hexToRgb(AFFILIATION_COLORS[theme].unknown);
      const friendly = hexToRgb(AFFILIATION_COLORS[theme].friendly);
      const neutral = hexToRgb(AFFILIATION_COLORS[theme].neutral);
      const hostile = hexToRgb(AFFILIATION_COLORS[theme].hostile);

      // Gray: channels roughly balanced
      expect(Math.abs(unknown.r - unknown.g)).toBeLessThan(30);
      expect(Math.abs(unknown.g - unknown.b)).toBeLessThan(30);

      // Green: G dominant
      expect(friendly.g).toBeGreaterThan(friendly.r);
      expect(friendly.g).toBeGreaterThan(friendly.b);

      // Yellow/orange: R and G high, B lower
      expect(neutral.r).toBeGreaterThan(neutral.b);
      expect(neutral.g).toBeGreaterThan(neutral.b);

      // Red: R dominant
      expect(hostile.r).toBeGreaterThan(hostile.g);
      expect(hostile.r).toBeGreaterThan(hostile.b);
    }
  });

  it("rejects cross-theme colors as inaccessible", () => {
    const lightFriendly = AFFILIATION_COLORS.light.friendly;
    expect(isAccessibleAffiliationColor(lightFriendly, "dark")).toBe(false);
  });
});
