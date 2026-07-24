import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** WCAG 2.1 Level A + AA tags for axe-core. */
export const WCAG_21_AA_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
] as const;

export type ColorScheme = "light" | "dark";

export type FormattedViolation = {
  id: string;
  impact: string | null | undefined;
  description: string;
  help: string;
  helpUrl: string;
  wcagTags: string[];
  nodes: Array<{
    target: string[];
    summary: string;
    html: string;
  }>;
};

export function formatViolations(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
): FormattedViolation[] {
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl,
    wcagTags: v.tags.filter((t) => t.startsWith("wcag")),
    nodes: v.nodes.map((n) => ({
      target: n.target.map(String),
      summary: n.failureSummary ?? "",
      html: n.html.slice(0, 200),
    })),
  }));
}

/**
 * Force light or dark before navigation via localStorage (next-themes key)
 * and prefers-color-scheme, so the app hydrates into the intended mode.
 */
export async function setColorScheme(page: Page, scheme: ColorScheme) {
  await page.addInitScript(
    ({ theme, storageKey }) => {
      window.localStorage.setItem(storageKey, theme);
    },
    { theme: scheme, storageKey: "vite-ui-theme" },
  );
  await page.emulateMedia({ colorScheme: scheme });
}

/**
 * Scan the page for WCAG 2.1 AA violations via axe-core.
 * Fails the test with a structured JSON dump when any are found.
 */
export async function assertNoWcag21AaViolations(
  page: Page,
  options?: { exclude?: string[] },
) {
  let builder = new AxeBuilder({ page }).withTags([...WCAG_21_AA_TAGS]);

  for (const selector of options?.exclude ?? []) {
    builder = builder.exclude(selector);
  }

  const results = await builder.analyze();
  const formatted = formatViolations(results.violations);

  expect(
    formatted,
    formatted.length
      ? `WCAG 2.1 AA violations:\n${JSON.stringify(formatted, null, 2)}`
      : undefined,
  ).toEqual([]);

  return results;
}
