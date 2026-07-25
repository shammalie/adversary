import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  getTargetColorOptions,
  isAccessibleTargetColor,
  nextTargetColor,
  randomUnusedTargetColor,
  resolveTargetColorTheme,
  targetColorOptionList,
  TARGET_COLOR_OPTIONS,
  TARGET_COLOR_SURFACES,
} from "@/lib/target-colors";

describe("target colors", () => {
  it("resolves light vs dark theme", () => {
    expect(resolveTargetColorTheme("light")).toBe("light");
    expect(resolveTargetColorTheme("dark")).toBe("dark");
    expect(resolveTargetColorTheme(undefined)).toBe("dark");
  });

  it("exposes expanded theme palettes", () => {
    expect(TARGET_COLOR_OPTIONS.light.length).toBeGreaterThanOrEqual(20);
    expect(TARGET_COLOR_OPTIONS.dark.length).toBeGreaterThanOrEqual(20);
  });

  it("every palette swatch meets AA against its theme surfaces", () => {
    for (const theme of ["light", "dark"] as const) {
      const surfaces = TARGET_COLOR_SURFACES[theme];
      const values = new Set<string>();
      for (const option of TARGET_COLOR_OPTIONS[theme]) {
        expect(values.has(option.value), `duplicate ${theme} ${option.value}`).toBe(false);
        values.add(option.value);
        expect(
          contrastRatio(option.value, surfaces.background),
          `${theme} ${option.id} vs background`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(option.value, surfaces.muted),
          `${theme} ${option.id} vs muted`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(isAccessibleTargetColor(option.value, theme)).toBe(true);
      }
    }
  });

  it("light palette colors are not assumed accessible on dark chrome", () => {
    const lightCyan = TARGET_COLOR_OPTIONS.light[0]!.value;
    expect(isAccessibleTargetColor(lightCyan, "dark")).toBe(false);
  });

  it("picks an unused palette color for new targets", () => {
    const first = getTargetColorOptions("dark")[0]!.value;
    const second = getTargetColorOptions("dark")[1]!.value;
    expect(nextTargetColor([first], "dark")).toBe(second);
  });

  it("random picks only unused colors and avoids the current when possible", () => {
    const options = getTargetColorOptions("dark");
    const current = options[0]!.value;
    const taken = options[1]!.value;
    const picked = randomUnusedTargetColor([taken], "dark", {
      preferDifferentFrom: current,
      random: () => 0,
    });
    expect(picked).not.toBe(taken);
    expect(picked).not.toBe(current);
    expect(picked).toBe(options[2]!.value);
  });

  it("random returns null when every palette color is taken by others", () => {
    const all = getTargetColorOptions("dark").map((option) => option.value);
    expect(randomUnusedTargetColor(all, "dark")).toBeNull();
  });

  it("keeps a legacy current color in the option list", () => {
    const list = targetColorOptionList("dark", "#111111");
    expect(list[0]).toMatchObject({ id: "current", value: "#111111" });
    expect(list[0]?.label).toContain("low contrast");
  });
});
