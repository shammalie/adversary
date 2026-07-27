# Authentic geo routes

Geography-aware random-demo generation: cars and trucks follow roads, boats stay in navigable water, and aircraft fly runway-aligned profiles with climb / cruise / descent, loiter, and return-to-base — using the OpenMapTiles vector data you already host. There is **no new Compose service**; routing reads the same tileserver (Docker) or OpenFreeMap planet TileJSON (dev).

Design history (grill + review): open [`/random-demo-review.html`](http://localhost:3001/random-demo-review.html) on the running web app (static file under `apps/web/public/`).

Seed catalogue details: [Geo seed bundle](./geo-seeds.md).

## Goal and constraints

- Replace terrain-blind random walks with routes grounded in OpenMapTiles layers (`transportation`, `water`, `aeroway` / `aerodrome_label`).
- Keep the stack local-first: Docker builds bake `VITE_GEO_TILEJSON_URL` to `http://tiles.adversary/data/openmaptiles.json`; Vite defaults to `https://tiles.openfreemap.org/planet` (same planet lineage as `data/tiles/openmaptiles.mbtiles`).
- Fail soft: per-track synthetic fallback and a completion toast — never discard a whole demo because one corridor timed out.

## Pipeline

```text
Demo options (regions, pin, categories, count, window, seed, AbortSignal)
        │
        ▼
 scenario-planner  ◄── geo-seeds.json (build-time, PWA-precached)
        │
        ├─ placement (pin > regions > anywhere) + terrain classify
        ├─ air-router     (seed-only — planned first for fast first paint)
        ├─ road-router    ┐
        └─ sea-router     ┴── vector tiles via TileJSON → Web Worker
                │
                ▼
        vehicle-profiles → path-to-events (kinematics + Douglas–Peucker)
                │
                ▼
        onTargetReady stream → builder UI (progress / cancel / toast)
```

| Stage | Location | Role |
| --- | --- | --- |
| Seed bundle | `apps/web/public/geo-seeds.json` | Aerodromes, ports, sea lanes, regions + derived `supports` |
| Terrain | `apps/web/src/lib/geo/terrain.ts` | Validity-filtered placement from water / road layers |
| Road / sea / air | `apps/web/src/lib/geo/{road,sea,air}-router.ts` | Polyline routing (air needs no runtime tile I/O) |
| Worker | `geo-router.worker.ts` + `geo-router-client.ts` | Decode + route off the UI thread; cancel by `requestId` |
| Profiles | `vehicle-profiles.ts` | Subtype-keyed cruise, turn limits, climb/descent, loiter/RTB |
| Events | `path-to-events.ts` | Walk polylines → authored speed/altitude events (≈60–150 pts) |
| Planner | `scenario-planner.ts` | Streaming `planDemoScenario` / `createDemoScenario` |
| UI | Builder demo dialog | Region multi-select, progress, Cancel, degradation toast |

Public entry: `createDemoScenario` in `demo-scenario.ts` (async). Fast offline / test path: `createSyntheticDemoScenario` or `forceSynthetic: true`.

## Environment

| Variable | Dev (Vite) | Docker Compose default |
| --- | --- | --- |
| `VITE_GEO_TILEJSON_URL` | `https://tiles.openfreemap.org/planet` | `http://tiles.adversary/data/openmaptiles.json` |

Defined in `packages/env/src/web.ts`, documented in root `.env.example`, and passed as a web image build arg in `docker-compose.yml`. Like the map style URLs, it is **baked at build time**.

`tile-source.ts` fetches TileJSON once, resolves the `{z}/{x}/{y}` template, and handles raw-gzip tile bodies when needed. Override the URL in tests via the vector-tile client options.

## Locked gate parameters (road graph)

The Phase −1 spike proved tile-clipped `transportation` LineStrings stitch into a usable graph. Locked for `road-router.ts`:

| Parameter | Value | Why |
| --- | --- | --- |
| Node quantization | **5 decimal places** (~1.1 m) | Seam stitching without false merges |
| Snap tolerance | **none** | Tolerance sweeps did not improve connectivity |
| Class filter (z14) | **Arterial / drivable** sets | Connectivity lever vs all-classes fragmentation |
| Endpoint snap | Into the **largest connected component** | Avoid stub dead-ends (~12% of arterial nodes) |
| Tile fetch | **Corridor**, never bbox | Budget: ~21 tiles for a 10 km corridor vs hundreds for a wide bbox |
| z10 long-haul | **No extra class filter** | OpenMapTiles is already arterial-only at z10 |

Constants live on the road router (`ROAD_QUANTIZE_DECIMALS`, `ARTERIAL_CLASSES`, `tilesAlongCorridor`, etc.).

## Placement precedence

1. **Origin pin** (`origin` / map picker) — wins entirely; region selection is ignored.
2. **Selected regions** — contacts only land in regions whose derived `supports` include their category; incompatible contacts relocate within the selection or fall back to anywhere.
3. **Anywhere** — validity-filtered world sampling when unpinned and no regions (or no compatible region).

`other` is terrain-routed at plan time (sea vs road), not declared as its own geometry class.

## Graceful degradation

- Per-track failures (timeout default **12 s**, empty graph, abort of a single route, missing tiles) call `synthesizeDemoTarget` and continue.
- Successfully routed tracks are kept; `degradedTrackCount` / `degraded` on stream updates feed the builder toast (`N routed authentically, M fell back to synthetic`, plus relocated categories when regions could not host them).
- Aircraft planning that cannot find a seed pair also degrades rather than failing the run.
- Bounded concurrency (default **5**) limits tile stampede.

## Cancellation

- Builder **Cancel** (or closing the dialog while pending) aborts an `AbortController` passed as `options.signal`.
- AbortSignal is **not** transferred into the worker; the client posts `{ type: "cancel", requestId }` and the worker aborts its own controller (including in-flight tile fetches).
- On cancel, the planner returns `{ cancelled: true }` with an empty scenario; the UI restores the pre-generation snapshot — **no partial writes**.

## Regenerating seeds

```bash
pnpm run geo:seeds
```

Requires Node **22+** and `data/tiles/openmaptiles.mbtiles`. Full operator notes: [geo-seeds.md](./geo-seeds.md).

## Testing notes

| Approach | Use when |
| --- | --- |
| `createSyntheticDemoScenario` / `forceSynthetic: true` | Fast unit tests; no network or TileJSON |
| Fixture PBFs under `apps/web/src/lib/geo/fixtures/tiles/` | Terrain / tile-decode validity (regenerated by `geo:seeds`) |
| Injected `routeFn` / `aerodromes` on planner deps | Orchestration tests without a live tileserver |
| Live TileJSON | Integration / manual demos only |

**Determinism:** pass `options.seed`. That swaps in `createSeededRandom(seed)` and, unless you override `idFactory`, a seed-derived id factory (`createSeededIdFactory`) — so the **same seed reproduces geometry and ids**. Without `seed`, ids use `crypto.randomUUID()`. Live tile routing still depends on the TileJSON source remaining reachable and stable; failures flip individual tracks to synthetic and can change which tracks degrade across runs.

## Related

- [Geo seed bundle](./geo-seeds.md)
- Root [README](../README.md) — env table, scripts, how to use the demo dialog
