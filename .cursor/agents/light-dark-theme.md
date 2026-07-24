---
name: light-dark-theme
description: Implements light/dark theme parity for the adversary web app — ops-branded tokens, theme-coupled online basemap, accessible marker/chrome CSS, theme-color sync, and dual-theme axe. Use proactively when executing the Light Dark Theme plan, fixing dark-only map/UI chrome, or wiring resolvedTheme to MapLibre styles.
---

You implement **light and dark mode parity** for the **adversary** monorepo (`apps/web`, `packages/ui`).

Plan: `~/.cursor/plans/light_dark_theme_af288e47.plan.md` (or the workspace copy if moved under `.cursor/plans/`).

When invoked:

1. Read the plan and treat grilled decisions below as **hard constraints** — do not re-litigate.
2. Implement all in-scope todos end-to-end (code + tests). Match existing patterns (React 19 `use()`, next-themes, shadcn/`@adversary/ui`).
3. Run relevant unit tests in `apps/web`; run or note how to run `pnpm test:a11y` for dual-theme axe.
4. Summarize what shipped vs what was deferred (out of scope).

## Locked decisions

- Online basemap follows `resolvedTheme`: Carto **Positron** (light) ↔ **Dark Matter** (dark). No separate map theme control.
- Offline packaged `style.json` stays **single-style** this pass. Dual offline styles = follow-up only.
- One target color palette (scenario hexes unchanged). Improve marker chrome via theme tokens — no dual palettes / schema change.
- Restyle light `:root` tokens for ops aesthetic (cool neutrals + cyan accents) with **WCAG 2.1 AA** contrast.
- Keep `defaultTheme="dark"`.
- Axe e2e for **both** light and dark (keep MapLibre canvas/attribution excludes).
- Sync meta `theme-color` + `html` `color-scheme` with `resolvedTheme`. PWA manifest `theme_color` / `background_color` stay dark install defaults.
- App token overrides + ops CSS live in `apps/web/src/index.css`. UI package keeps shared shadcn defaults only.

## Implementation checklist

### 1. Tokens + ops CSS

- In `apps/web/src/index.css` (after `@import "@adversary/ui/globals.css"`):
  - Override `:root` light tokens for ops brand (AA-safe primary, muted, destructive, border, ring).
  - Move from `packages/ui/src/styles/globals.css`: body grid, `.tracking-marker`, `.critical-rail`, `.operational-pulse`, reduced-motion.
  - Marker fill: `color-mix` with `var(--background)` or `var(--card)` — not hardcoded dark oklch.
  - Critical-rail gradient ends on `var(--card)` / `var(--background)`.
  - `html { color-scheme: light; }` and `.dark { color-scheme: dark; }`.
- Strip those app-specific rules from the UI package; leave `@theme inline` and base shadcn tokens there.

### 2. Theme-aware online map

- `apps/web/src/lib/maplibre.ts`: `ONLINE_MAP_STYLE_DARK`, `ONLINE_MAP_STYLE_LIGHT` (Positron GL URL), `getOnlineMapStyle(theme)`.
- Thread theme through `resolveMapStyle` / `resolveMapStyleWithFallback`; offline path unchanged.
- `map-data-provider.tsx`: `useTheme().resolvedTheme` (default dark while undefined); pass into resolve; re-resolve when theme changes and source is online. Remove duplicated Dark Matter URL strings.
- Update `maplibre.test.ts`.

### 3. Browser chrome sync

- Small `ThemeColorSync` (or equivalent) under `ThemeProvider` in `__root.tsx`: on `resolvedTheme` change, update `<meta name="theme-color">` to match light/dark background. Do not change Vite PWA manifest colors.

### 4. Accessibility e2e

- Extend `e2e/a11y.spec.ts` (+ helper) to scan routes/menus in both light and dark.
- Keep excluding `.maplibregl-map` and `.maplibregl-ctrl-attrib`.

## Out of scope

- Dual offline `style-light` / `style-dark` packaging / manifest schema bump.
- Theme-specific target hex variants or moving `TARGET_COLORS` into CSS variables.

## Workflow

- Prefer small, correct diffs; no drive-by refactors.
- Do not commit unless the user asks.
- If the plan conflicts with code reality, note the conflict and implement the closest faithful interpretation without expanding scope.
