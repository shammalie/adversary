# Geo seed bundle

Build-time catalogue mined from the local OpenMapTiles MBTiles into `apps/web/public/geo-seeds.json`. The random-demo planner uses it for aerodrome / harbour placement, sea-lane anchors, road anchors, and the typed region catalogue (`DEMO_REGIONS`). See [Authentic geo routes](./authentic-geo-routes.md) for how the planner consumes it.

## Contents

Schema version field: `v` (currently `1`), plus `generatedAt` (ISO timestamp).

Geometry collections are stored **columnar** (parallel arrays) to keep the JSON compact:

| Key | Shape | Role |
| --- | --- | --- |
| `aerodromes` | `icao`, `iata`, `name`, `class`, `eleFt`, `lng`, `lat`, `runways` | Airport centres with runway `ref` + heading pairs (for departure/approach alignment) |
| `ports` | `lng`, `lat`, `name`, `kind` | Ports / ferry terminals for boat starts |
| `seaLanes` | `lng`, `lat` | Coarse maritime waypoints (ferry geometry + mid-bbox samples for boat-capable regions) |
| `roadAnchors` | `regionId`, `lng`, `lat` | Sample road midpoints per region (placement hints) |
| `regions` | array of `{ id, name, bbox, supports }` | Typed demo regions — `bbox` is `[west, south, east, north]`; `supports` is `VehicleCategory[]` |

Approximate counts on the current planet build (~644 KiB raw on disk):

- ~2450 aerodromes (IATA and/or runway ≥ ~1500 m)
- ~7200 ports
- ~4600 sea-lane points
- ~130 road anchors across 17 regions

The web app imports the file as a static module (`demo-regions.ts`, `scenario-planner.ts`, air/sea routers). Workbox precaches `*.json`, so the bundle is available offline once the PWA has installed.

## How `supports` is derived

Region **bboxes and names** are hand-picked in `scripts/build-geo-seeds.mjs` (`REGION_DEFS`). Category **`supports` is not hand-asserted** — `probeRegionSupports` samples tile geometry inside each bbox:

| Category | Probe |
| --- | --- |
| `car` / `truck` | ≥ 3 drivable `transportation` LineStrings at z10 (`motorway`…`service`) |
| `boat` | ≥ 1 `water` polygon with `class=ocean` or `dock` at z8, **or** ≥ 1 `class=ferry` line at z10 (lakes alone do not count — the sea router is ocean/ferry oriented) |
| `aircraft` | ≥ 1 mined aerodrome inside the bbox padded by 0.75° |
| `other` | Added when the region already supports `car` or `boat` (runtime routes `other` by terrain) |

Rebuild after changing `REGION_DEFS` or refreshing MBTiles so `supports` stays honest.

## Rebuild

**Prerequisites**

- Node.js **22+** (`node:sqlite` / `DatabaseSync`)
- Local planet file at `data/tiles/openmaptiles.mbtiles` (see `pnpm run tiles:collect` and [`data/tiles/SOURCE.txt`](../data/tiles/SOURCE.txt))
- `pbf` and `@mapbox/vector-tile` installed under `apps/web` (normal `pnpm install`)

```bash
pnpm run geo:seeds
```

This runs `node scripts/build-geo-seeds.mjs`, which:

1. Opens the MBTiles read-only
2. Mines aerodromes (+ runway headings), ports/ferries, and region probes
3. Writes `apps/web/public/geo-seeds.json`
4. Writes a few small PBF fixtures under `apps/web/src/lib/geo/fixtures/tiles/` for terrain unit tests

**When to rebuild:** after `tiles:collect` / a new MBTiles drop, after editing `REGION_DEFS`, or when aerodrome filters change. Commit the regenerated JSON and fixtures with the change.

**Runtime / disk:** dominated by SQLite reads over the planet file (tens of GB on disk). Expect on the order of **minutes** on a warm SSD; the output JSON is under **1 MiB** (gzip much smaller). No network required once the MBTiles is local.

## Related

- [Authentic geo routes](./authentic-geo-routes.md) — planner, routers, env, testing
- Root [README](../README.md) — scripts and env overview
