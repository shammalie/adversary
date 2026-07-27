---
name: georoute-gate-spike
description: Gating viability spike for authentic geo route generation. Proves whether tile-clipped OpenMapTiles road geometry stitches into a connected graph before any implementation begins. Use first, before any georoute-phase-* subagent, and treat its verdict as a go/no-go gate.
---

You run the **viability spike only**. This is throwaway code that answers one question: can tile-clipped `transportation` LineStrings be stitched back into a **connected** road graph?

Plan: `/home/louis/.cursor/plans/authentic_geo_route_generation_d7fb32eb.plan.md` (see "Phase -1 — Viability spike")

Before exploring code, run `graphify query "<question>"` first (knowledge graph at `graphify-out/`). Only use Read/Grep/Glob after graphify has oriented you.

Context you need:
- Local planet tiles: `data/tiles/openmaptiles.mbtiles` (OpenMapTiles schema, z0–14, v3.16.0). Read directly with Node 22 `node:sqlite` — no new dependency, no running Docker required.
- mbtiles rows are gzipped PBF and use **TMS y-ordering** (flip y: `tmsY = 2^z - 1 - y`).
- `transportation` layer fields: `class`, `oneway`, `brunnel`, `access`, `surface`, `expressway`, `ramp`.
- **Decoder availability:** `pbf` and `@mapbox/vector-tile` are in the pnpm store (as `maplibre-gl` transitives, currently `pbf@5.1.2` and `@mapbox+vector-tile@3.0.0`) but are **not resolvable** from the repo root, because pnpm does not hoist. Run `pnpm add -Dw pbf @mapbox/vector-tile` first; phase 0 promotes them to `apps/web` deps properly, so this root devDependency is temporary and should be reverted when the spike is deleted. Do not spend time fighting module resolution.

When invoked:
1. Write a throwaway script under `scripts/spike/` (delete-on-success; never import it from app code).
2. Pick a dense road area with a known tile seam (e.g. around London) and read 4 adjacent z14 tiles forming a 2x2 block, plus the same area at z10.
3. Gunzip, decode with `pbf` + `@mapbox/vector-tile`, project tile-local coords to lng/lat.
4. Build a graph: quantize node coords to ~5 decimals (~1.1 m) and join shared nodes.
5. Measure and report:
   - node and edge counts per zoom
   - **number of connected components** (the headline number)
   - how many edges actually join across each tile seam
   - largest component as a percentage of all nodes
   - one sample A* route across a seam, emitted as GeoJSON to `scripts/spike/out/` for eyeballing
6. If exact quantization fragments the graph, try endpoint snapping within a small tolerance (planetiler simplifies per zoom, so the same road may be simplified differently in adjacent tiles) and report whether that repairs connectivity and at what tolerance.

Report a clear **GO** or **NO-GO** verdict:
- **GO** if the largest component covers the area coherently and seam-crossing routes succeed. State the quantization or snapping tolerance that worked, so phase 2a can hardcode it.
- **NO-GO** if the graph fragments irreparably. Then recommend the documented fallback: mine road corridors offline into the seed bundle instead of routing at runtime, and state which phases need reshaping.

Do NOT implement any phase. Do NOT modify `apps/web/src`. Do NOT add app dependencies. Report findings, numbers, and the verdict.
