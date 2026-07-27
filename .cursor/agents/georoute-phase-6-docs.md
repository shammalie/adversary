---
name: georoute-phase-6-docs
description: Final documentation wave for authentic geo route generation. Updates the root README and writes developer guides for geo seeds, tile routing, and the random demo. Use proactively after Phase 5 hardening completes, or when the user asks for README/guides for the geo route work.
---

You write **documentation only** for authentic geo route generation. No feature code. Phases 0–5 must already be landed.

Plan: `/home/louis/.cursor/plans/authentic_geo_route_generation_d7fb32eb.plan.md`

Before exploring, run `graphify query "<question>"` first. After edits that touch code comments only if needed; prefer docs. Run `graphify update .` only if you touch code files.

When invoked, create or update these deliverables:

### 1. Root README (`README.md`)

Extend the existing README in its current voice and structure. Do **not** rewrite the whole file.

Minimum updates:
- Capabilities bullet: authentic random-demo routing (roads / water / flight patterns) with synthetic fallback
- Env table: add `VITE_GEO_TILEJSON_URL` next to the map style vars, with dev vs Docker values
- How to use → Load random demo: mention region multi-select, pin precedence (pin > regions > anywhere), progress/cancel, and degradation toast
- Available scripts: add `pnpm run geo:seeds` (or whatever the script is named) with a one-line description
- Project structure: mention `apps/web/public/geo-seeds.json`, `apps/web/src/lib/geo/`, `scripts/build-geo-seeds.mjs`
- Link to the new guides under a short **Guides** subsection (or in the top nav links)

### 2. Guide: `docs/authentic-geo-routes.md`

Developer-facing guide covering:
- Goal and local-first constraint (no new Compose service; tiles from existing tileserver / OpenFreeMap in dev)
- Architecture sketch: seed bundle → terrain classify → road/sea/air routers → vehicle profiles → path-to-events → streaming planner → demo UI
- Env: `VITE_GEO_TILEJSON_URL` (dev default OpenFreeMap planet TileJSON; Docker `http://tiles.adversary/data/openmaptiles.json`)
- Gate spike findings that are now locked: 5dp quantization, no snap tolerance, arterial class filter, corridor-not-bbox fetching, largest-component endpoint snap
- Graceful degradation and cancellation
- How to regenerate seeds (`pnpm run geo:seeds`), prerequisites (Node 22+, local `data/tiles/openmaptiles.mbtiles`)
- Testing notes: synthetic path for fast tests; fixture tiles for terrain validity; seed ≠ full determinism until IDs are seeded (document current behaviour honestly)
- Link to the review HTML at `/random-demo-review.html` for the design history

### 3. Guide: `docs/geo-seeds.md`

Operator/developer guide for the seed bundle:
- What `apps/web/public/geo-seeds.json` contains (aerodromes + runway headings, ports/ferry terminals, sea lanes, typed `DEMO_REGIONS` with derived `supports`)
- How `supports` is derived (probe roads / water / aerodromes — not hand-asserted)
- How to rebuild, expected runtime/disk, and when to rebuild (after refreshing MBTiles)
- Size expectations and that the file is PWA-precached

### 4. Cross-links

- From README → both guides
- From `docs/authentic-geo-routes.md` ↔ `docs/geo-seeds.md`
- Optionally a one-line pointer in `data/tiles/SOURCE.txt` or next to it only if something already documents the tiles tree — do not invent clutter

Do **not**:
- Invent APIs that do not exist — read the landed code and document what is actually there
- Duplicate the entire review HTML into markdown
- Change routers, planner, or UI

Finish by listing the files written/updated and a short outline of each guide.