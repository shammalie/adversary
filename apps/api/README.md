# Adversary API

Go HTTP API for scenarios, geo, live runs, manage, generate/route, and auth.

## Stack

- Chi + `net/http`
- Viper (config), Cobra (`serve` / `migrate` / `geoseed`)
- samber/do v2 (DI)
- pgx + golang-migrate + PostGIS
- Redis pub/sub (ops + map fan-out across instances)
- slog JSON
- swaggo/swag + http-swagger
- gorilla/websocket (ops + map live channels)

Module: `github.com/shammalie/adversary/apps/api`

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `HTTP_ADDR` | `:8080` | Listen address |
| `DATABASE_URL` | `postgres://adversary:adversary@localhost:5432/adversary?sslmode=disable` | Postgres/PostGIS DSN |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis URL (required for ops WS fan-out) |
| `AUTH_MODE` | `off` | `off` (trusted local / Compose: no auth) or `session` (cookie sessions + owner scoping) |
| `AUTH_COOKIE_SECURE` | `false` | Set `true` when serving HTTPS so the session cookie gets `Secure` |
| `AUTH_SESSION_TTL` | `168h` | Session lifetime (Go duration) |
| `MBTILES_PATH` | `./data/tiles/openmaptiles.mbtiles` | Path to OpenMapTiles MBTiles (mine/reseed) |
| `GEO_TILEJSON_URL` | _(empty)_ | TileJSON URL for runtime road/sea vector tiles; empty → surface routes soft-fail to synthetic |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `INSTANCE_ID` | (random UUID) | Lease owner id; set uniquely per API replica |

For local commands, the API loads repo-root `.env`, then optional `apps/api/.env`; an already-exported process variable wins over both. Compose continues to inject its own environment. See also repo-root `.env.example`.

## Run locally

For day-to-day development from the monorepo root (requires Docker, Go 1.26+, and `go.work`):

```bash
pnpm dev:stack
```

It starts Postgres and Redis, applies migrations, serves the API on `:8080`, and starts Vite. Keep `VITE_API_BASE_URL` empty so Vite proxies `/v1` to the local API.

To run each command manually:

```bash
# Start Postgres (PostGIS) + Redis
docker compose up -d postgres redis

# Migrate (PostGIS + geo catalogue + scenarios + runs + auth users/sessions)
DATABASE_URL='postgres://adversary:adversary@localhost:5432/adversary?sslmode=disable' \
  go run ./apps/api/cmd/migrate up

# Serve — AUTH_MODE=off (default Compose / local trusted network)
HTTP_ADDR=':8080' AUTH_MODE=off go run ./apps/api/cmd/api serve

# Serve — AUTH_MODE=session (HttpOnly cookie `adversary_session`)
HTTP_ADDR=':8080' AUTH_MODE=session go run ./apps/api/cmd/api serve
```

- Health: `curl -s http://localhost:8080/healthz`
- Swagger UI: http://localhost:8080/swagger/index.html

## Auth (`AUTH_MODE`)

| Mode | Behavior |
| --- | --- |
| `off` | Middleware no-op. Drafts/runs/manage are shared (`owner_user_id` null). `usage_events.user_id` null. Default for Docker Compose. |
| `session` | Register/login set HttpOnly cookie `adversary_session`. Mutating `/v1` routes, owner-scoped reads (`/scenarios`, `/runs`, `/manage`, `/admin`), and ops/map WebSockets require a valid session. Geo catalogue `GET /v1/geo/*` stays public. Scenarios are scoped by `owner_user_id`; usage rows record `user_id`. |

```bash
# Session mode smoke
curl -c /tmp/adv.ck -b /tmp/adv.ck -s -X POST http://localhost:8080/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"op@example.com","password":"password1"}'
curl -c /tmp/adv.ck -b /tmp/adv.ck -s http://localhost:8080/v1/auth/me
curl -c /tmp/adv.ck -b /tmp/adv.ck -s -X POST http://localhost:8080/v1/scenarios -H 'Content-Type: application/json' -d '{}'
curl -c /tmp/adv.ck -b /tmp/adv.ck -s -X POST http://localhost:8080/v1/auth/logout
```

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/v1/auth/register` | `{ email, password }` → user + cookie (`503` when mode is `off`) |
| `POST` | `/v1/auth/login` | Same shape; `401` on bad credentials |
| `POST` | `/v1/auth/logout` | Clears cookie + deletes server session |
| `GET` | `/v1/auth/me` | Current user |

## Runs (startAt replay + ops / map WebSocket)

Runs start only from `ready` scenarios. `startAt` sets `schedule_offset_ms` so the earliest authored event (`firesAt ?? at`) aligns to that wall clock (default: now). Authored scenario times are never mutated. The lease holder ticks events, checkpoints after each fire (and syncs PostGIS `run_target_positions`), and publishes over Redis.

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/v1/runs` | `{ scenarioId, startAt? }` → `{ runId, ... }` |
| `GET` | `/v1/runs` | **Active scenarios:** `running` + recently completed/stopped (24h); includes `scenarioName`. `?active=true` → running only |
| `GET` | `/v1/runs/{id}` | Status + `startAt` / offset + `scenarioName` |
| `POST` | `/v1/runs/{id}/stop` | Stop; lease released |
| `GET` | `/v1/runs/{id}/snapshot` | **Full due-set** ≤ now + target states (ops cold load) |
| `GET` | `/v1/runs/{id}/viewport` | **Map cold load:** PostGIS envelope `west&south&east&north` (+ optional `zoom`, `includeTargetIds`) |
| `GET` | `/v1/runs/{id}/ws/ops` | Ops WebSocket (unfiltered ingest/alerts) |
| `GET` | `/v1/runs/{id}/ws/map` | Map WebSocket (bbox ∪ `includeTargetIds`; in-band filter updates) |

**Ops WS messages:** `ops.hello`, `event.ingested`, `alert.raised`, `target.updated`, `run.completed`, `run.stopped`. Catch-up wire: single `catchup.target.updated` (latest target set). REST snapshot remains the full due-set.

### Map viewport + WS filter contract

Server sends map updates for targets in **bbox ∪ `includeTargetIds`**. Off-screen tracked contacts stay subscribed via `includeTargetIds`.

**Client eviction (local overlay):** when a target is **not** in `includeTargetIds` and its last known position is **outside** the current bbox (or has no position), the client **drops** it from the map overlay. The server does **not** send explicit evict messages — after a pan/`map.viewport` update, stop receiving updates for unmatched ids and clear local state.

**Viewport query params:**

| Param | Required | Notes |
| --- | --- | --- |
| `west` `south` `east` `north` | yes (REST) | WGS84 degrees; `west≤east`, `south≤north` (no antimeridian wrap) |
| `zoom` | no | Advisory (LOD reserved) |
| `includeTargetIds` | no | Comma-separated target ids |

**Map WS in-band control** (same connection; no reconnect storm):

```json
{"type":"map.viewport","west":-1,"south":50,"east":1,"north":52,"zoom":10,"includeTargetIds":["target-a"]}
```

Server replies `map.viewport.ok` with the applied `filter`. Initial filter may also be set via query string on the WS URL. Map channel forwards filtered `target.updated` / `catchup.target.updated` plus `run.completed` / `run.stopped` (not `event.ingested` / `alert.raised`).

```bash
# Import + ensure ready, then start a run aligned to now
SCENARIO=$(curl -s -X POST http://localhost:8080/v1/scenarios/import \
  -H 'Content-Type: application/json' \
  --data-binary @apps/web/src/lib/fixtures/example-scenario.json | jq -r .id)

RUN=$(curl -s -X POST http://localhost:8080/v1/runs \
  -H 'Content-Type: application/json' \
  -d "{\"scenarioId\":\"$SCENARIO\"}" | jq -r .runId)

# Active scenarios list
curl -s 'http://localhost:8080/v1/runs' | jq .

# Cold load (full due-set)
curl -s "http://localhost:8080/v1/runs/$RUN/snapshot" | jq .

# Map viewport (bbox + optional tracked ids)
curl -s "http://localhost:8080/v1/runs/$RUN/viewport?west=-1&south=50&east=1&north=52&zoom=8&includeTargetIds=" | jq .

# Ops WebSocket
websocat "ws://localhost:8080/v1/runs/$RUN/ws/ops"

# Map WebSocket (optional initial bbox on URL; then send map.viewport JSON)
websocat "ws://localhost:8080/v1/runs/$RUN/ws/map?west=-1&south=50&east=1&north=52"

# Stop
curl -s -X POST "http://localhost:8080/v1/runs/$RUN/stop"
```

Lease steal: another instance acquires an expired lease, fast-forwards silently from the checkpoint, publishes one `catchup.target.updated`, then resumes. The previous holder stops immediately on renew failure (no further fires/publishes).

## Scenarios (draft / publish / import)

Server-owned builder documents. Drafts live entirely in `scenarios.payload` JSONB (`status=draft`); incomplete JSON is allowed. Publishing runs full schema validation, sets `status=ready`, and writes normalized `targets` / `events` rows for later run loading (Phase 4).

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/v1/scenarios` | List; `?status=draft\|ready` (ready-only for run picker) |
| `POST` | `/v1/scenarios` | Create empty draft (optional `{name,payload}`) |
| `GET` | `/v1/scenarios/{id}` | Full row + optional `issues` |
| `PATCH` | `/v1/scenarios/{id}` | Rename (`{name}`) |
| `DELETE` | `/v1/scenarios/{id}` | Delete (cascades normalized rows) |
| `PUT` | `/v1/scenarios/{id}/draft` | Autosave upsert; **never rejects for validation**; returns `issues` for UI badges; ready→draft clears normalized rows |
| `POST` | `/v1/scenarios/{id}/validate` | Full checks; does not change status |
| `POST` | `/v1/scenarios/{id}/publish` | Full checks; on success → `ready` + normalize; `422` + `issues` on failure |
| `POST` | `/v1/scenarios/import` | v2 JSON (v1 migrated server-side); lands `ready` if valid else `draft` |
| `POST` | `/v1/scenarios/generate` | Async demo/random planner → draft (or ready when valid); returns `jobId` |
| `GET` | `/v1/scenarios/generate/jobs/{id}` | Generate job progress / `scenarioId` |
| `POST` | `/v1/scenarios/{id}/targets/{tid}/route` | Authentic plan for one target; persists events into draft |

### Generate / route (Phase 7)

Planners read the geo catalogue from **Postgres** (Phase 2 tables). Runtime road/sea still fetch vector tiles via `GEO_TILEJSON_URL`. Air routes are seed-only (aerodromes).

**Empty catalogue:** on generate/route, the API kicks `POST /v1/admin/geo/reseed` when possible; if reseed cannot start (no MBTiles / busy), planning **soft-fails to synthetic** wander tracks (no hard block, no transitional JSON required). Job response includes `catalogueEmpty` / `reseedKicked` / `degradedTrackCount`.

```bash
# Async generate (synthetic when catalogue empty / no TileJSON)
JOB=$(curl -s -X POST http://localhost:8080/v1/scenarios/generate \
  -H 'Content-Type: application/json' \
  -d '{"targetCount":5,"forceSynthetic":true,"seed":42}' | jq -r .jobId)
curl -s "http://localhost:8080/v1/scenarios/generate/jobs/$JOB" | jq .

# Per-target route into an existing draft
curl -s -X POST "http://localhost:8080/v1/scenarios/$ID/targets/$TID/route" \
  -H 'Content-Type: application/json' \
  -d '{"startAt":"2026-07-01T12:00:00Z","eventCount":40}'
```

Parity deltas vs the web Worker planners are documented in [docs/geo-parity.md](../../docs/geo-parity.md).

```bash
# Create draft
curl -s -X POST http://localhost:8080/v1/scenarios -H 'Content-Type: application/json' -d '{}'

# Autosave incomplete document (HTTP 200 even when invalid)
curl -s -X PUT "http://localhost:8080/v1/scenarios/$ID/draft" \
  -H 'Content-Type: application/json' \
  -d '{"schemaVersion":2,"id":"'"$ID"'","name":"WIP","createdAt":"2024-01-01T00:00:00.000Z","updatedAt":"2024-01-01T00:00:00.000Z","priorityTerms":[],"targets":[],"events":[]}'

# Publish (422 until valid)
curl -s -X POST "http://localhost:8080/v1/scenarios/$ID/publish"

# Import fixture (→ ready when valid)
curl -s -X POST http://localhost:8080/v1/scenarios/import \
  -H 'Content-Type: application/json' \
  --data-binary @apps/web/src/lib/fixtures/example-scenario.json

# Ready-only list (run picker)
curl -s 'http://localhost:8080/v1/scenarios?status=ready'
```

`AUTH_MODE=off`: `owner_user_id` stays null; `usage_events` records activity with `user_id=null`. Optional `X-Client-Id` → `properties.client_id`.

`AUTH_MODE=session`: creates set `owner_user_id`; list/get/draft/publish/manage/delete and runs are owner-scoped; `usage_events.user_id` is set; login/register emit `auth.login` / `auth.register`.

## Manage + metrics (Phase 6)

Storage management and observability (full `/manage` UI is Phase 10).

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/v1/manage/scenarios` | Paginated: status, name, updatedAt, sizeBytes, target/event counts, owner, activeRuns. `?status=&q=&limit=&offset=` |
| `GET` | `/v1/manage/stats` | draft/ready counts, sum payload bytes, runs active/completed/stopped |
| `DELETE` | `/v1/manage/scenarios/{id}` | Cascade-stops active runs, deletes all runs for the scenario, then the scenario |
| `POST` | `/v1/manage/scenarios/bulk-delete` | `{ "ids": ["…"] }` (max 100); partial success OK |
| `GET` | `/v1/manage/metrics/usage` | Time-bucketed `usage_events` (`from`/`to` RFC3339, `userId`, `clientId`, `bucket=15m\|1h\|1d`) |
| `GET` | `/metrics` | Prometheus scrape (low-cardinality: method, route pattern, status_class) |

```bash
curl -s 'http://localhost:8080/v1/manage/scenarios?limit=20'
curl -s 'http://localhost:8080/v1/manage/stats'
curl -s 'http://localhost:8080/v1/manage/metrics/usage?bucket=1h'
curl -s http://localhost:8080/metrics | head
curl -s -X DELETE "http://localhost:8080/v1/manage/scenarios/$ID"
curl -s -X POST http://localhost:8080/v1/manage/scenarios/bulk-delete \
  -H 'Content-Type: application/json' -d '{"ids":["…"]}'
```

Prometheus series (examples): `adversary_http_request_duration_seconds`, `adversary_http_requests_total`, `adversary_runs_active`, `adversary_ws_clients{channel="ops\|map"}`, `adversary_leases_owned`, `adversary_reseed_jobs_active`.

## Geo catalogue / reseed

Source of truth is PostGIS (`geo_*` tables), mined from `MBTILES_PATH`. The planet MBTiles stays on disk (not loaded into Postgres).

**CLI** (also wired as root `pnpm geo:seeds`):

```bash
# Mine → Postgres (default)
MBTILES_PATH=./data/tiles/openmaptiles.mbtiles \
  go run ./apps/api/cmd/geoseed

# Optional JSON + terrain fixtures for web unit tests during FE transition
go run ./apps/api/cmd/geoseed \
  --export-json apps/web/public/geo-seeds.json \
  --export-fixtures apps/web/src/lib/geo/fixtures/tiles

# Mine only (no DB)
go run ./apps/api/cmd/geoseed --skip-db --export-json /tmp/geo-seeds.json
```

**HTTP** (async; one-at-a-time via advisory lock + job row):

```bash
curl -s -X POST http://localhost:8080/v1/admin/geo/reseed   # → { "jobId", "status" }
curl -s http://localhost:8080/v1/admin/geo/jobs/{id}
curl -s http://localhost:8080/v1/admin/geo/meta
curl -s 'http://localhost:8080/v1/geo/regions'
curl -s 'http://localhost:8080/v1/geo/aerodromes?west=-1&south=51&east=1&north=52'
```

Workflow: `pnpm tiles:collect` → writes `data/tiles/SOURCE.txt` + `READY.json` → `pnpm geo:seeds` or `POST /v1/admin/geo/reseed`. See [docs/geo-seeds.md](../../docs/geo-seeds.md).

## Docker Compose

From repo root:

```bash
docker compose up -d postgres redis migrate api
```

- Traefik host: `http://api.adversary` (entrypoint `web`)
- API mounts `./data/tiles` at `/data/tiles` (`MBTILES_PATH=/data/tiles/openmaptiles.mbtiles`)
- One-shot `migrate` service applies migrations before `api` starts
- Image also builds `/app/geoseed` for in-container CLI mining

## Migrate

```bash
go run ./apps/api/cmd/migrate up    # apply all
go run ./apps/api/cmd/migrate down  # roll back one
```

Migrations live in `migrations/` and are embedded in the migrate binary.

## Tests

Unit tests always run. Integration tests that need Postgres **skip** when `DATABASE_URL` is unset (no Docker / testcontainers required).

```bash
cd apps/api
go test ./... -count=1

# Race + goleak packages (bus LocalHub, engine renew-stop, lease)
go test ./internal/bus/ ./internal/engine/ ./internal/lease/ -race -count=1

# Integration (requires migrated Postgres):
DATABASE_URL='postgres://adversary:adversary@localhost:5432/adversary?sslmode=disable' \
  go test ./... -count=1
```

Coverage highlights:

| Area | Package / test | Needs DB |
| --- | --- | --- |
| startAt / `schedule_offset_ms` replay | `internal/simulation` `TestScheduleOffset` | no |
| Draft invalid OK + publish 422 | `internal/handler` `TestScenarioDraftPublishImport` | yes |
| Lease steal / renew → `ErrNotHeld` | `internal/lease` `TestAcquireStealRenewFailure` | yes |
| Ticker stops on renew failure | `internal/engine` `TestRunLoopStopsOnRenewFailure` (+ goleak) | no |
| Reseed one-at-a-time (advisory + in-flight job) | `internal/geoseed` `TestAdvisoryLock*` / `TestStartReseedBusy*` | yes |
| Local bus fan-out race | `internal/bus` `TestLocalHubConcurrentFanout` (+ goleak) | no |

Optional: when Docker is available, start Compose Postgres/Redis and set `DATABASE_URL` / `REDIS_URL` — no testcontainers dependency is wired.

## Verification checklist

1. `go build ./...` and `go test ./...` in `apps/api` (skips OK without `DATABASE_URL`)
2. With Compose: migrate → `curl -sf http://localhost:8080/healthz` → Swagger UI loads
3. Traefik host: add `127.0.0.1 api.adversary` → `http://api.adversary/healthz`
4. Draft autosave returns 200 with `issues`; publish of incomplete payload returns 422
5. Start run with `startAt`; ops/map WS upgrade; lease steal stops previous ticker
6. Second `POST /v1/admin/geo/reseed` while busy returns reseed-busy error

See also [docs/api.md](../../docs/api.md#verification-checklist).

## Swagger

All v1 REST handlers and both WebSocket Upgrade routes (`/ws/ops`, `/ws/map`) are annotated. Prometheus `GET /metrics` is described in the OpenAPI info blob only (not a REST resource). Regenerate:

```bash
cd apps/api && go run github.com/swaggo/swag/cmd/swag@v1.16.6 init -g cmd/api/main.go -o docs --parseDependency --parseInternal
```

## Architecture

See [docs/api.md](../../docs/api.md).
