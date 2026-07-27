import { test } from "@playwright/test";

import {
  assertNoWcag21AaViolations,
  setColorScheme,
  type ColorScheme,
} from "./a11y.helpers";

/**
 * MapLibre canvas / attribution chrome often trips color-contrast and
 * landmark rules that are outside app control. Exclude the map container
 * surface; app chrome around it is still scanned.
 */
const MAP_EXCLUDE = [".maplibregl-map", ".maplibregl-ctrl-attrib"];

const routes = [
  { name: "operations", path: "/operations", exclude: MAP_EXCLUDE },
  { name: "builder", path: "/builder", exclude: MAP_EXCLUDE },
  { name: "import", path: "/import", exclude: [] as string[] },
] as const;

const themes: ColorScheme[] = ["dark", "light"];

for (const theme of themes) {
  test.describe(`WCAG 2.1 AA — ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await setColorScheme(page, theme);
    });

    for (const route of routes) {
      test.describe(route.name, () => {
        test(`has no axe violations on ${route.path}`, async ({ page }) => {
          await page.goto(route.path);
          await page.waitForLoadState("networkidle");
          await page.locator("header").waitFor({ state: "visible" });
          await assertNoWcag21AaViolations(page, { exclude: [...route.exclude] });
        });
      });
    }

    test("open settings dropdown has no axe violations", async ({ page }) => {
      await page.goto("/operations");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Settings" }).click();
      await page.getByRole("menu").waitFor({ state: "visible" });
      await assertNoWcag21AaViolations(page, { exclude: MAP_EXCLUDE });
    });

    test("theme menu has no axe violations", async ({ page }) => {
      await page.goto("/operations");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: /toggle theme|theme/i }).click();
      await page.getByRole("menu").waitFor({ state: "visible" });
      await assertNoWcag21AaViolations(page, { exclude: MAP_EXCLUDE });
    });

    test("open demo dialog has no axe violations", async ({ page }) => {
      await page.goto("/builder");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Load random demo" }).click();
      await page.getByRole("dialog", { name: "Load random demo" }).waitFor({
        state: "visible",
      });
      // Scope to the dialog so pre-existing builder chrome (empty-scenario
      // disabled labels / inactive tabs) does not fail this Phase 4b check.
      await assertNoWcag21AaViolations(page, {
        include: ['[data-slot="dialog-content"]'],
        exclude: MAP_EXCLUDE,
      });
    });
  });
}
