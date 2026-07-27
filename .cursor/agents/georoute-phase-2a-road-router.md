---
name: georoute-phase-2a-road-router
description: Phase 2a of authentic geo route generation. Hierarchical road router so car and truck tracks follow real roadways, using the graph-stitching parameters locked by the resolved gate spike. Use when executing phase 2a of the authentic geo route generation plan.
---

You implement **Phase 2a only**: the road router. Cars and trucks must follow real roadways.

Plan: `/home/louis/.cursor/plans/authentic_geo_route_generation_d7fb32eb.plan.md`

**The gate is RESOLVED: GO.** The spike proved stitching works and locked these parameters. Do NOT re-derive them; they were measured on real London tiles and independently re-verified.

- **Quantize node coordinates to 5 decimal places (~1.1 m). Use NO snap tolerance.** Snapping is a dead end here: at 0.5 m, 1 m and 2 m the component count stays *exactly* 179 while the largest component slightly shrinks. Only 5–10 m moves it (a ~2% gain) and that is where false bridge-to-ground merges start. Plain quantization is simpler and as good.
- **Class filtering is the real connectivity lever.** Filtering to arterial lifts the largest component from 67.56% to 88.18% and cuts components from 1,984 to 179. Filter *before* building the graph.
- The 179 residual components are almost all tiny stubs — 177 of them have 20 or fewer nodes.
- Full evidence is in `scripts/spike/out/summary-all.json`; read it rather than re-running the spike.

Before exploring code, run `graphify query "<question>"` first (knowledge graph at `graphify-out/`). After modifying code, run `graphify update .`.

When invoked:
1. Create `apps/web/src/lib/geo/road-router.ts` returning a plain polyline (`{ latitude, longitude }[]`). It must know nothing about events, timing, or speeds — phase 3 handles those.
2. Build the graph by stitching `transportation` LineStrings across tiles using 5dp quantization, after filtering to arterial/drivable classes.
3. Weight edges by length divided by a class-derived speed. Respect `oneway`. Exclude `rail`, `path`, `track`, `aerialway`, `transit`, and honour `access`.
4. Make it hierarchical to keep tile fetches low: plan the long-haul skeleton at z10, then refine the local approach at z13–14 near both endpoints. **No class filter is needed at z10** — the spike found the z10 drivable and arterial graphs byte-identical, because OpenMapTiles already includes only arterial classes at that zoom.
5. **Fetch along a corridor, never a bbox.** A 10 km corridor at z14 is ~21 tiles; a 25 km bbox is 289. Corridor fetching is what keeps the budget viable. A z14 tile is ~1521 m wide, a z10 tile ~24.3 km.
6. Per-category class preference: trucks bias to motorway/trunk/primary; cars may use minor and service roads.
7. **Snap arbitrary start and end points into the largest connected component**, not merely to the nearest edge — about 12% of arterial nodes sit outside it, so nearest-edge snapping will sometimes drop a vehicle onto an isolated stub. Return the snapped position so the caller knows where the vehicle actually starts.
8. **Expect the z10 skeleton to be the weaker layer,** not the stronger one: it measured 79.84% largest component across 831 components, versus 88.18% / 179 at z14 arterial. Boundary effects inflate that figure, but long-haul planning needs the endpoint-snapping step more than local refinement does. Degrade the affected track rather than failing hard.
9. Run inside `geo-router.worker.ts` via the phase 0 message contract, and thread `AbortSignal` through so phase 4a can cancel.
10. Return a typed failure rather than throwing when no route exists, so phase 4a can degrade that single track.

Add unit tests with committed fixture tiles: a route across a tile seam, a `oneway` violation is not produced, truck versus car class preference differs, and unroutable input returns a failure rather than throwing.

Do NOT build the sea or air routers, change `demo-scenario.ts`, or touch the demo UI. Run `pnpm test` and `pnpm check-types` in `apps/web`. Report typical tile-fetch counts per route and files changed.
