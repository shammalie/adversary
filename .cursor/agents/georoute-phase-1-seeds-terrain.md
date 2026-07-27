---
name: georoute-phase-1-seeds-terrain
description: Phase 1 of authentic geo route generation. Build-time seed bundle mined from the local mbtiles (aerodromes with runway headings, ports, sea lanes, typed region catalogue) plus the terrain classifier for validity-filtered placement. Use when executing phase 1 of the authentic geo route generation plan.
---

You implement **Phase 1 only** of authentic geo route generation. This phase produces the offline data tier and the terrain primitive every router depends on.

Plan: `/home/louis/.cursor/plans/authentic_geo_route_generation_d7fb32eb.plan.md` (see "Region model (typed catalogue)")

Before exploring code, run `graphify query "<question>"` first (knowledge graph at `graphify-out/`). After modifying code, run `graphify update .`.

Source data: `data/tiles/openmaptiles.mbtiles` (planet, z0–14). Read with Node 22 `node:sqlite` — no new dependency. Rows are gzipped PBF with **TMS y-ordering** (flip y: `tmsY = 2^z - 1 - y`).

When invoked:
1. Create `scripts/build-geo-seeds.mjs` emitting `apps/web/public/geo-seeds.json`:
   - **Aerodromes** from `aerodrome_label` (z8–14): `icao`, `iata`, `name`, `class`, `ele_ft`, lat/lng. Filter to entries with an IATA code or a runway longer than ~1500 m to keep the file to a few thousand entries.
   - **Runway headings** per aerodrome, derived from `aeroway class=runway` LineString bearings (z12–14), keeping `ref` (the designator). Phase 2c needs these so departures and approaches align to real runways.
   - **Ports and ferry terminals** from `poi` and the endpoints of `transportation class=ferry`.
   - **Coarse sea-lane waypoints** and per-region road anchors.
   - **The typed region catalogue** (see step 2).
2. The region catalogue is the critical correctness item. Today's `DEMO_START_LOCATIONS` in `demo-scenario.ts` L61–72 is **9 of 10 maritime**; using it for a region picker would put trucks in open water. Emit regions shaped as `{ id, name, bbox, supports: VehicleCategory[] }` and **derive `supports` from real geometry** — probe each bbox for usable `transportation` road classes, navigable `water`, and nearby aerodromes, rather than hand-asserting. Include land and mixed-coastal regions (e.g. Central Europe, US Eastern Seaboard, Benelux) alongside the existing maritime straits.
3. Keep the bundle compact: prefer parallel arrays or short keys over verbose objects, and report the gzipped size. It is precached by the existing workbox glob `**/*.{js,css,html,ico,png,svg,woff2,mjs,json}`, so it doubles as the offline tier.
4. Create `apps/web/src/lib/geo/terrain.ts` — `classifyPoint(lngLat)` returning water class (point-in-polygon over `water` at z8–10) and the nearest road candidate. This is the primitive that makes globally-valid rejection sampling work: sample a candidate, probe, accept or retry within a **bounded** attempt count, then relocate. Never allow an unbounded retry loop.
5. Add a script entry (e.g. `geo:seeds`) to the root `package.json` alongside `tiles:collect`.

Add unit tests for `classifyPoint` using small committed fixture tiles, covering a known ocean point, a known inland point, and a coastline.

Do NOT build routers, change `demo-scenario.ts`, or touch the demo UI. Run `pnpm test` and `pnpm check-types` in `apps/web`. Report the bundle size, region count with their `supports` values, and files changed.
