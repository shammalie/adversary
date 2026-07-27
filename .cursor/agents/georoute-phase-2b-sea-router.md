---
name: georoute-phase-2b-sea-router
description: Phase 2b of authentic geo route generation. Sea router so boats stay in navigable water, preferring real ferry routes with a water-grid A* fallback. Use when executing phase 2b of the authentic geo route generation plan.
---

You implement **Phase 2b only**: the sea router. No boat may ever be placed on land.

Plan: `/home/louis/.cursor/plans/authentic_geo_route_generation_d7fb32eb.plan.md`

This phase is independent of the road router and does not depend on the gate spike verdict.

Before exploring code, run `graphify query "<question>"` first (knowledge graph at `graphify-out/`). After modifying code, run `graphify update .`.

When invoked:
1. Create `apps/web/src/lib/geo/sea-router.ts` returning a plain polyline. It must know nothing about events, timing, or speeds — phase 3 handles those.
2. **Prefer real maritime routes.** `transportation class=ferry` LineStrings are genuine ferry crossings and make the most authentic vessel tracks. Use them whenever one is available near the requested start.
3. Fallback for open water: A* over a navigable grid rasterized from `water` polygons with `class=ocean` or `class=lake` at z6–8, using 8-neighbour connectivity. This is what keeps vessels off land and makes them round headlands instead of crossing them.
4. Use `waterway class=river|canal` for inland vessels where a sea route is not applicable.
5. Snap starts near harbours and ferry terminals from `apps/web/public/geo-seeds.json` (phase 1) so vessels originate somewhere plausible rather than mid-ocean.
6. Smooth the grid path so it does not read as obvious 45-degree staircase artifacts, while never letting a smoothed segment cross land — re-validate any shortcut against the water mask.
7. Run inside `geo-router.worker.ts` via the phase 0 message contract, and thread `AbortSignal` through for cancellation.
8. Return a typed failure rather than throwing when no navigable route exists.

Add unit tests with committed fixture tiles: no path vertex falls on land, a strait crossing succeeds, a ferry route is preferred when present, an enclosed lake does not route to open ocean, and smoothing never introduces a land crossing.

Do NOT build the road or air routers, change `demo-scenario.ts`, or touch the demo UI. Run `pnpm test` and `pnpm check-types` in `apps/web`. Summarize files changed.
