# Geo seed catalogue

Postgres/PostGIS is the **system of record** for the mined OpenMapTiles catalogue (aerodromes, ports, sea-lane points, road anchors, typed regions). The ~100GB planet MBTiles stays on disk for tileserver-gl; only the mined summary lives in the database.

The web app may still load `apps/web/public/geo-seeds.json` during the FE transition. Rebuild that file with the Go miner’s `--export-json` flag (see below). API generate/route planners read the catalogue from **Postgres** (soft-fail to synthetic when empty — see [api.md](./api.md) and [geo-parity.md](./geo-parity.md)).

## Contents

Schema version: `geo_seed_meta.schema_v` (currently `1`), plus `generated_at`.

| Table | Role |
| --- | --- |
| `geo_aerodromes` | Airport centres (`geography(Point,4326)`) + runway `ref`/heading JSONB; GIST + unique ICAO where present |
| `geo_ports` | Ports / ferry terminals / ferry endpoints |
| `geo_sea_lanes` | Coarse maritime waypoints |
| `geo_road_anchors` | Sample road midpoints per region |
| `geo_regions` | Typed demo regions — bbox envelope + `supports` (`aircraft\|boat\|car\|truck\|other`) |
| `geo_seed_meta` | Singleton: path, SOURCE URL, job status, row counts |
| `geo_reseed_jobs` | Async reseed job status |

Approximate counts on the current planet build:

- ~2450 aerodromes (IATA and/or runway ≥ ~1500 m)
- ~7200 ports
- ~4600 sea-lane points
- ~130 road anchors across 17 regions

Columnar JSON export (optional) matches the previous `geo-seeds.json` shape for web fixtures.

## How `supports` is derived

Region **bboxes and names** are hand-picked in `apps/api/internal/geoseed` (`REGION_DEFS`, ported from `scripts/build-geo-seeds.mjs`). Category **`supports` is not hand-asserted** — `probeRegionSupports` samples tile geometry inside each bbox:

| Category | Probe |
| --- | --- |
| `car` / `truck` | ≥ 3 drivable `transportation` LineStrings at z10 (`motorway`…`service`) |
| `boat` | ≥ 1 `water` polygon with `class=ocean` or `dock` at z8, **or** ≥ 1 `class=ferry` line at z10 (lakes alone do not count) |
| `aircraft` | ≥ 1 mined aerodrome inside the bbox padded by 0.75° |
| `other` | Added when the region already supports `car` or `boat` |

Rebuild after changing `REGION_DEFS` or refreshing MBTiles so `supports` stays honest.

## Collect tiles → mine catalogue

1. **`pnpm tiles:collect`** — resume-friendly wget of planet MBTiles + styles into `data/tiles/`. Writes `SOURCE.txt` and `READY.json` (path, source URL, `collectedAt`). Documented for the API via `MBTILES_PATH` (Compose mounts `./data/tiles` → `/data/tiles`).
2. **Mine** with the Go CLI or admin API (below).

### CLI

```bash
# From monorepo root — also: pnpm run geo:seeds
MBTILES_PATH=./data/tiles/openmaptiles.mbtiles \
  go run ./apps/api/cmd/geoseed \
  --export-json apps/web/public/geo-seeds.json \
  --export-fixtures apps/web/src/lib/geo/fixtures/tiles
```

Requires Postgres migrations applied (`go run ./apps/api/cmd/migrate up`) unless you pass `--skip-db`.

### Admin API

```bash
curl -s -X POST http://localhost:8080/v1/admin/geo/reseed
# → { "jobId": "…", "status": "queued" }

curl -s http://localhost:8080/v1/admin/geo/jobs/$JOB_ID
curl -s http://localhost:8080/v1/admin/geo/meta
```

Only one reseed runs at a time (Postgres advisory lock `0xAE505EED` + in-flight job check → `ErrReseedBusy`). Progress is on the job row (`progress` / `status`); poll `GET /v1/admin/geo/jobs/{id}` (no SSE job channel).

### Read APIs

```bash
GET /v1/geo/regions
GET /v1/geo/aerodromes?west=&south=&east=&north=
GET /v1/geo/ports?west=&south=&east=&north=
GET /v1/geo/sea-lanes?west=&south=&east=&north=
GET /v1/geo/road-anchors?west=&south=&east=&north=
```

## Legacy Node miner

`scripts/build-geo-seeds.mjs` remains as a reference; **`pnpm geo:seeds` now invokes the Go CLI**. Prefer Go for new work.

**Runtime / disk:** dominated by SQLite reads over the planet file (tens of GB). Expect on the order of **minutes** on a warm SSD. No network required once MBTiles is local.

## Related

- [Authentic geo routes](./authentic-geo-routes.md) — planner, routers, env, testing
- [API architecture](./api.md) — HTTP surface
- [apps/api/README.md](../apps/api/README.md) — env vars, migrate, Compose
- Root [README](../README.md) — scripts overview
