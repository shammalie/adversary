/** Approximate ops chrome surfaces used for contrast checks (matches theme-color / cards). */
export const TARGET_COLOR_SURFACES = {
  light: { background: "#f5f8f9", muted: "#e8eef1" },
  dark: { background: "#0c1014", muted: "#12181e" },
} as const;

export type TargetColorTheme = keyof typeof TARGET_COLOR_SURFACES;

export interface TargetColorOption {
  id: string;
  label: string;
  /** Hex used as the stored target.color value. */
  value: string;
}

/**
 * Theme-specific palettes: each swatch meets WCAG 2.1 AA (≥4.5:1) against that theme's
 * background and muted/card chrome. One stored hex per target — picker only offers the
 * active theme's options (legacy/custom values remain selectable if already set).
 */
export const TARGET_COLOR_OPTIONS: Record<TargetColorTheme, readonly TargetColorOption[]> = {
  light: [
    { id: "cyan", label: "Cyan", value: "#0e7490" },
    { id: "sky", label: "Sky", value: "#0369a1" },
    { id: "blue", label: "Blue", value: "#1d4ed8" },
    { id: "navy", label: "Navy", value: "#1e3a8a" },
    { id: "indigo", label: "Indigo", value: "#3730a3" },
    { id: "violet", label: "Violet", value: "#6d28d9" },
    { id: "purple", label: "Purple", value: "#5b21b6" },
    { id: "fuchsia", label: "Fuchsia", value: "#a21caf" },
    { id: "magenta", label: "Magenta", value: "#86198f" },
    { id: "pink", label: "Pink", value: "#9d174d" },
    { id: "rose", label: "Rose", value: "#be123c" },
    { id: "red", label: "Red", value: "#b91c1c" },
    { id: "crimson", label: "Crimson", value: "#9f1239" },
    { id: "orange", label: "Orange", value: "#9a3412" },
    { id: "amber", label: "Amber", value: "#92400e" },
    { id: "brown", label: "Brown", value: "#78350f" },
    { id: "olive", label: "Olive", value: "#854d0e" },
    { id: "lime", label: "Forest", value: "#166534" },
    { id: "green", label: "Green", value: "#047857" },
    { id: "emerald", label: "Emerald", value: "#065f46" },
    { id: "teal", label: "Teal", value: "#0f766e" },
    { id: "slate-teal", label: "Deep teal", value: "#115e59" },
    { id: "ocean", label: "Ocean", value: "#155e75" },
    { id: "steel", label: "Steel", value: "#164e63" },
  ],
  dark: [
    { id: "cyan", label: "Cyan", value: "#22d3ee" },
    { id: "aqua", label: "Aqua", value: "#67e8f9" },
    { id: "sky", label: "Sky", value: "#38bdf8" },
    { id: "blue", label: "Blue", value: "#60a5fa" },
    { id: "ice", label: "Ice", value: "#93c5fd" },
    { id: "indigo", label: "Indigo", value: "#818cf8" },
    { id: "violet", label: "Violet", value: "#a78bfa" },
    { id: "lavender", label: "Lavender", value: "#c4b5fd" },
    { id: "fuchsia", label: "Fuchsia", value: "#e879f9" },
    { id: "pink", label: "Pink", value: "#f472b6" },
    { id: "blush", label: "Blush", value: "#f9a8d4" },
    { id: "rose", label: "Rose", value: "#fb7185" },
    { id: "coral", label: "Coral", value: "#fda4af" },
    { id: "orange", label: "Orange", value: "#f97316" },
    { id: "apricot", label: "Apricot", value: "#fb923c" },
    { id: "amber", label: "Amber", value: "#fbbf24" },
    { id: "gold", label: "Gold", value: "#facc15" },
    { id: "yellow", label: "Yellow", value: "#fde047" },
    { id: "lime", label: "Lime", value: "#a3e635" },
    { id: "green", label: "Green", value: "#4ade80" },
    { id: "mint", label: "Mint", value: "#86efac" },
    { id: "emerald", label: "Emerald", value: "#34d399" },
    { id: "teal", label: "Teal", value: "#2dd4bf" },
    { id: "seafoam", label: "Seafoam", value: "#5eead4" },
  ],
} as const;

export function normalizeHex(color: string): string | null {
  const trimmed = color.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  return null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const n = Number.parseInt(normalized.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

/** WCAG contrast ratio between two hex colors. */
export function contrastRatio(foreground: string, background: string): number | null {
  const L1 = relativeLuminance(foreground);
  const L2 = relativeLuminance(background);
  if (L1 === null || L2 === null) return null;
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

const AA_NORMAL_TEXT = 4.5;

export function isAccessibleTargetColor(
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

export function resolveTargetColorTheme(resolvedTheme: string | undefined): TargetColorTheme {
  return resolvedTheme === "light" ? "light" : "dark";
}

export function getTargetColorOptions(theme: TargetColorTheme): readonly TargetColorOption[] {
  return TARGET_COLOR_OPTIONS[theme];
}

function usedColorSet(existingColors: string[]): Set<string> {
  return new Set(
    existingColors
      .map((color) => normalizeHex(color))
      .filter((color): color is string => Boolean(color)),
  );
}

/**
 * Random palette color not used by other targets.
 * Prefers a color different from `preferDifferentFrom` when alternatives exist.
 * Returns null when the palette is fully taken by other targets.
 */
export function randomUnusedTargetColor(
  otherTargetColors: string[],
  theme: TargetColorTheme,
  options?: { preferDifferentFrom?: string; random?: () => number },
): string | null {
  const random = options?.random ?? Math.random;
  const used = usedColorSet(otherTargetColors);
  const preferDifferent = options?.preferDifferentFrom
    ? normalizeHex(options.preferDifferentFrom)
    : null;

  let pool = getTargetColorOptions(theme).filter((option) => !used.has(option.value));
  if (pool.length === 0) return null;

  if (preferDifferent && pool.length > 1) {
    const withoutCurrent = pool.filter((option) => option.value !== preferDifferent);
    if (withoutCurrent.length > 0) pool = withoutCurrent;
  }

  const index = Math.floor(random() * pool.length);
  return pool[index]?.value ?? null;
}

/** Next auto-assigned color for a new target in the active theme. */
export function nextTargetColor(existingColors: string[], theme: TargetColorTheme): string {
  const options = getTargetColorOptions(theme);
  const used = usedColorSet(existingColors);
  const unused = options.find((option) => !used.has(option.value));
  return unused?.value ?? options[existingColors.length % options.length]?.value ?? options[0].value;
}

export function targetColorOptionList(
  theme: TargetColorTheme,
  currentColor: string | undefined,
): TargetColorOption[] {
  const options = [...getTargetColorOptions(theme)];
  const normalized = currentColor ? normalizeHex(currentColor) : null;
  if (!normalized) return options;
  if (options.some((option) => option.value === normalized)) return options;
  return [
    {
      id: "current",
      label: isAccessibleTargetColor(normalized, theme)
        ? "Current"
        : "Current (low contrast)",
      value: normalized,
    },
    ...options,
  ];
}

export function findTargetColorLabel(theme: TargetColorTheme, color: string): string {
  const normalized = normalizeHex(color);
  if (!normalized) return color;
  const match = getTargetColorOptions(theme).find((option) => option.value === normalized);
  if (match) return match.label;
  return isAccessibleTargetColor(normalized, theme) ? "Custom" : "Custom (low contrast)";
}
