import {
  contrastRatio,
  resolveTargetColorTheme,
  TARGET_COLOR_SURFACES,
  type TargetColorTheme,
} from "@/lib/target-colors";
import { AFFILIATIONS, type Affiliation } from "@/types/target";

const AFFILIATION_SET = new Set<string>(AFFILIATIONS);

/**
 * Theme-specific affiliation glyph colors for map markers.
 * Each hex meets WCAG 2.1 AA (≥4.5:1) against that theme's background and muted chrome.
 *
 * Hue rules: unknown = gray/white, friendly = green, neutral = yellow/orange, hostile = red.
 */
export const AFFILIATION_COLORS: Record<
  TargetColorTheme,
  Record<Affiliation, string>
> = {
  light: {
    unknown: "#52525b",
    friendly: "#166534",
    neutral: "#9a3412",
    hostile: "#b91c1c",
  },
  dark: {
    unknown: "#e2e8f0",
    friendly: "#4ade80",
    neutral: "#fbbf24",
    hostile: "#f87171",
  },
} as const;

const AA_NORMAL_TEXT = 4.5;

export function isAccessibleAffiliationColor(
  color: string,
  theme: TargetColorTheme,
  minimumRatio = AA_NORMAL_TEXT,
): boolean {
  const surfaces = TARGET_COLOR_SURFACES[theme];
  const againstBackground = contrastRatio(color, surfaces.background);
  const againstMuted = contrastRatio(color, surfaces.muted);
  if (againstBackground === null || againstMuted === null) return false;
  return againstBackground >= minimumRatio && againstMuted >= minimumRatio;
}

export function resolveAffiliationColorTheme(
  resolvedTheme: string | undefined,
): TargetColorTheme {
  return resolveTargetColorTheme(resolvedTheme);
}

/** Map marker glyph color for an affiliation; missing values fall back to unknown. */
export function resolveAffiliationColor(
  affiliation: Affiliation | undefined,
  theme: TargetColorTheme,
): string {
  const key =
    affiliation && AFFILIATION_SET.has(affiliation) ? affiliation : "unknown";
  return AFFILIATION_COLORS[theme][key as Affiliation];
}
