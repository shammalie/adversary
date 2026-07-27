---
name: georoute-phase-0-foundations
description: Phase 0 of authentic geo route generation. Shared seeded PRNG, static docs fixture, vector tile client with TileJSON resolution, and the geo-router Web Worker scaffold. Use when executing phase 0 of the authentic geo route generation plan, after the gate spike returns GO.
---

You implement **Phase 0 only** of authentic geo route generation in `apps/web`. No behaviour change is expected; this is groundwork so later phases stay small.

Plan: `/home/louis/.cursor/plans/authentic_geo_route_generation_d7fb32eb.plan.md`

Before exploring code, run `graphify query "<question>"` first (knowledge graph at `graphify-out/`). After modifying code, run `graphify update .`.

When invoked:
1. Create `apps/web/src/lib/random.ts` exporting `createSeededRandom(seed)`. Replace the LCG duplicated in `demo-scenario.test.ts` L8–14, `event-generator.test.ts` L114, and `simulation-schema-docs.ts` L10.
2. Decouple docs from generation: `getExampleScenarioJson()` in `simulation-schema-docs.ts` currently calls `createDemoScenario` synchronously during render in `simulation-import.tsx` L344. Replace with a committed static JSON fixture so async generation never leaks into docs rendering. This must land before phase 4a.
3. Add `pbf` and `@mapbox/vector-tile` as direct deps of `apps/web` (already transitive via `maplibre-gl`). Note the gate spike left them as **root devDependencies** as a pnpm-hoisting workaround — move them to `apps/web` dependencies properly and remove the root entries.
4. Add `VITE_GEO_TILEJSON_URL` to `packages/env/src/web.ts` (both `client` and `runtimeEnv`), `.env.example`, and the `web` build args in `docker-compose.yml`. Dev default `https://tiles.openfreemap.org/planet`; Docker `http://tiles.adversary/data/openmaptiles.json`. Follow the existing `VITE_MAP_STYLE_*` pattern exactly.
5. Create `apps/web/src/lib/geo/tile-source.ts` — fetch TileJSON once, cache the resolved `{z}/{x}/{y}` template. Handle bodies that are still gzip-framed (magic bytes `0x1f 0x8b`) via `DecompressionStream("gzip")`.
6. Create `apps/web/src/lib/geo/vector-tile-client.ts` — fetch, decode, project tile coords to lng/lat, with an in-memory LRU keyed by `z/x/y/layer`. Accept an `AbortSignal`; phase 4a needs cancellation.
7. Create `apps/web/src/lib/geo/geo-router.worker.ts` as a scaffold with a typed request/response message contract. Follow the `setWorkerUrl` pattern in `apps/web/src/lib/maplibre.ts`, and note `optimizeDeps.exclude` in `vite.config.ts` exists for worker URL resolution.

Add unit tests for `createSeededRandom` determinism and for tile coordinate projection.

Do NOT change `demo-scenario.ts` generation logic, add routers, or touch the demo UI. Run `pnpm test` and `pnpm check-types` in `apps/web`. Summarize files changed.
