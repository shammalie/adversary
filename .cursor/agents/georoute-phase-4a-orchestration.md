---
name: georoute-phase-4a-orchestration
description: Phase 4a of authentic geo route generation. Streaming async scenario planner, typed region catalogue replacing the maritime-heavy presets, bounded concurrency, cancellation, and per-track graceful degradation. Use when executing phase 4a of the authentic geo route generation plan.
---

You implement **Phase 4a only**: orchestration. This wires the routers into scenario generation.

Plan: `/home/louis/.cursor/plans/authentic_geo_route_generation_d7fb32eb.plan.md` (see "Region model" and "Generation budget and streaming")

Before exploring code, run `graphify query "<question>"` first (knowledge graph at `graphify-out/`). After modifying code, run `graphify update .`.

**Precondition:** phase 0 must have replaced `getExampleScenarioJson()` with a static fixture, or making `createDemoScenario` async will break `simulation-import.tsx` L344.

When invoked:

1. Create `apps/web/src/lib/scenario-planner.ts`. It is **async and streaming**: expose an async iterator or `onTargetReady` callback rather than resolving one finished scenario, so the UI can append targets progressively.
   - Bounded concurrency, around 4–6 in-flight route requests, to avoid a fetch stampede against the tile source.
   - Thread `AbortSignal` end to end, including into in-flight tile fetches.
   - **Plan aircraft first**, since they need no runtime tile fetches (seed bundle only), so first contacts appear almost immediately while road and sea routes resolve.

2. Region model in `demo-scenario.ts`. Replace `DEMO_START_LOCATIONS` (L61–72) with the typed `DEMO_REGIONS` catalogue from phase 1: `{ id, name, bbox, supports: VehicleCategory[] }`.
   - Accept **one to many** regions plus an `"anywhere"` mode using phase 1 validity-filtered sampling.
   - A selected region only receives **compatible** contacts. An incompatible contact relocates to another selected region supporting its category; if none does, it falls back to anywhere-sampling and that is reported.
   - **Precedence is strictly pin > regions > anywhere.** The existing `origin` option and its `MapLocationPicker` pin remain a separate override that wins outright when set.
   - Route the `other` category **by terrain**: sea router if its start point classifies as water, road router otherwise.

3. `createDemoScenario` becomes async and streaming, delegating per-target planning to the planner. **Keep the current synthetic implementation exported as `createSyntheticDemoScenario`** — it is both the degradation tier and what keeps unit tests fast.

4. Graceful degradation is **per track**: on tile failure, timeout, or a region with no usable geometry, fall back to the synthetic generator for only the affected tracks. Routed tracks that succeeded are kept. Surface a count so phase 4b can report it.

5. Preserve the existing `travelGroup` behaviour: grouped contacts should share a corridor, which now means sharing a routed path with small lateral offsets rather than a great circle.

Add unit tests: a maritime-only region selection never places a car or truck, an incompatible category relocates or degrades, pin beats region selection, cancellation mid-generation leaves no partial writes, degradation is per-track rather than all-or-nothing, and a seeded run is reproducible.

Do NOT edit `scenario-builder.tsx` — that is phase 4b. Run `pnpm test` and `pnpm check-types` in `apps/web`. Summarize files changed.
