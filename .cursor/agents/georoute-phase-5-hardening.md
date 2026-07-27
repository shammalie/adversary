---
name: georoute-phase-5-hardening
description: Phase 5 of authentic geo route generation. Engine event indexing, localStorage quota visibility, PWA cache rules for tile fetches, and the full test sweep including replacing the global-scatter contract. Use when executing phase 5 or final verification of the authentic geo route generation plan.
---

You implement **Phase 5 only**: performance, caching, and tests. Documentation is **not** in this phase — that is Wave 7 (`georoute-phase-6-docs`) after you finish.

Plan: `/home/louis/.cursor/plans/authentic_geo_route_generation_d7fb32eb.plan.md` (see "Acceptance criteria")

Before exploring code, run `graphify query "<question>"` first (knowledge graph at `graphify-out/`). After modifying code, run `graphify update .`.

When invoked:

1. **Engine indexing.** `positionEventsForTarget` in `apps/web/src/lib/simulation-engine.ts` L161–163 calls `sortEvents(scenario.events)` **inside a per-target loop**, making interpolated preview O(targets x n log n). At 100 targets with 150 points that is a 15,000-element sort run 100 times per preview frame. Sort once and memoize a per-target position index. Behaviour must not change — only cost.

2. **Storage visibility.** `safeWrite` in `apps/web/src/lib/simulation-storage.ts` L36–43 silently swallows quota errors, so a large runtime can fail to persist with no signal. Surface a warning instead of failing invisibly. Runtime state lives in localStorage under `adversary:active-runtime:v2`.

3. **PWA caching** in `apps/web/vite.config.ts` (workbox config around L77–105):
   - Raise the `local-tileserver` `runtimeCaching` `maxEntries` well above its current 64, which is far too few for route-generation tile fetches.
   - Add a `runtimeCaching` rule for `tiles.openfreemap.org` so the dev provider is cacheable too.

4. **Tests.**
   - Replace the global-scatter contract in `apps/web/src/lib/demo-scenario.test.ts` L165–196. It currently asserts latitude span over 20 degrees, longitude span over 40 degrees, and fewer than three close pairs — that is, it **enshrines the terrain-blind scatter this whole effort removes**. Replace with terrain-validity assertions: road vehicles near a road, boats on water, aircraft near an aerodrome.
   - Convert remaining `createDemoScenario` tests to async; keep `createSyntheticDemoScenario` tests synchronous and fast.
   - Region compatibility: a maritime-only selection must not place trucks; an incompatible category relocates or degrades rather than spawning invalidly.
   - Cancellation: aborting mid-generation leaves no partial writes and no dangling in-flight fetches.
   - Extend `apps/web/e2e/a11y.spec.ts` to **open the demo dialog** so axe actually scans the region multi-select and the progress and cancel controls. Today the spec only visits `/builder` and never opens the dialog, so none of the demo controls are covered.

5. **Verify the acceptance criteria** from the plan and report each as pass or fail:
   - car and truck events lie on roadways; tracks turn at junctions
   - no boat event falls on land
   - aircraft start and end at real aerodromes on real runway headings, with climb, cruise plateau and descent; loiter holds a pattern; RTB lands where it departed
   - maritime-only region selection never yields a road vehicle in water
   - first contacts visible in under about 2 seconds at 100 targets; cancel works; totals stay in the low thousands of events
   - no new `docker-compose.yml` service; Docker reaches only `tiles.adversary`
   - with the tile source blocked, the demo still loads via the synthetic path and says so
   - the same seed reproduces the same scenario

Do NOT add new features. Run `pnpm test`, `pnpm check-types`, and `pnpm test:a11y` in `apps/web`. Report pass/fail per acceptance criterion and any remaining issues.
