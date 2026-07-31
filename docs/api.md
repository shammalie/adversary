# Adversary API architecture

Go backend in `apps/api` (Phases 1–10). Multi-instance HTTP + WebSocket service with PostGIS, Redis fan-out, Swagger, and optional session auth. The web app talks to the API through **TanStack Query** (Phase 10).

## Role

`apps/api` owns:

- Scenario CRUD / drafts / publish / import / generate / route
- PostGIS geo catalogue + async reseed (advisory lock, one-at-a-time)
- Checkpointed live runs with Redis fan-out + **ops** and **map** WebSockets
- Viewport map cold-load (PostGIS envelope) + filtered live map channel
- Manage storage list/delete/stats + product usage metrics
- Prometheus `/metrics`
- Optional session auth (`AUTH_MODE=session`)

## Web client (Phase 10)

Point Vite at the API with `VITE_API_BASE_URL` (see repo-root `.env.example`). Leave it empty for local Vite — `/v1` is proxied to `localhost:8080` (including WebSockets). Cross-host Docker builds set `VITE_API_BASE_URL=http://api.adversary`; the API reflects `Origin` with credentials for CORS.

- All REST traffic goes through TanStack Query (`apps/web/src/lib/api/*`, `apps/web/src/hooks/*`).
- Live ops/map use WebSockets; handlers `setQueryData` / `invalidateQueries` on the snapshot and viewport caches (viewport keys include bbox + `includeTargetIds`).
- Builder drafts autosave via debounced `PUT /v1/scenarios/{id}/draft`. First builder load migrates IndexedDB drafts once; conflicts **prompt the user** (never auto-merge), then IDB writes stop.
- Routes: `/builder`, `/operations`, `/runs` (active scenarios), `/manage`, `/import`.

Until Phase 10, the API could run alongside client-local IndexedDB flows; that path is retired for API data.

## Process layout

| Binary | Purpose |
| --- | --- |
| `cmd/api` | Cobra root; `serve` starts Chi on `HTTP_ADDR` |
| `cmd/migrate` | `up` / `down` via golang-migrate (embedded SQL) |
| `cmd/geoseed` | Mine `MBTILES_PATH` → PostGIS (+ optional JSON/fixtures) |

DI composition root: samber/do v2 (`internal/app`). Config: Viper (`internal/config`). Auth: no-op when `AUTH_MODE=off` (`internal/auth`). DB pool: pgx (`internal/db`). Redis bus: `internal/bus`. Leases: `internal/lease`. Run ticker: `internal/engine`. Simulation apply/reconcile: `internal/simulation` (ported from web).

## Draft / publish semantics

Mirrors web `saveScenarioDraft`:

- **`PUT /v1/scenarios/{id}/draft`** — upsert builder JSON; incomplete/invalid documents are stored; response may include `issues` for UI badges; never fails solely for schema errors. Publishing is reverted if the scenario was `ready` (normalized `targets`/`events` cleared).
- **`POST /v1/scenarios/{id}/validate`** — full schema checks; does not change status.
- **`POST /v1/scenarios/{id}/publish`** — same checks; on success sets `status=ready`, rewrites normalized `targets`/`events`, and enables `POST /v1/runs`. Returns `422` with `issues` when invalid.
- **`POST /v1/scenarios/import`** — accepts v2 JSON; migrates v1 server-side; lands as `ready` when valid, otherwise `draft`.

Drafts live only in `scenarios.payload`. Normalized tables are populated only when `status=ready`.

## Runs / leases / startAt

- **Tables:** `runs`, `run_checkpoints`, `run_leases`.
- **startAt:** `schedule_offset_ms = startAt - min(firesAt ?? at)`; due times = authored time + delaySeconds + offset. Scenario payload is not rewritten.
- **Lease:** Postgres row per run (`owner_instance_id`, `expires_at`); only the holder ticks. Heartbeat ~5s, TTL 15s. On renew failure the local ticker **stops immediately**.
- **Checkpoint:** after every applied event (processed ids, ingested events, target states, critical alerts, next_event_at).
- **Catch-up (lease steal / restart):** load checkpoint → while due, apply without flood → publish one `catchup.target.updated` (latest target set) → resume waiting for the next future event.
- **REST snapshot:** full due-set ≤ now + target states (ops cold load). Distinct from catch-up wire shape.
- **Viewport:** `run_target_positions` (GIST) synced on checkpoint; `GET .../viewport` uses `ST_MakeEnvelope` for bbox ∪ `includeTargetIds`.

## WebSocket live channels

OpenAPI documents both Upgrade endpoints (`101 Switching Protocols`). Clients must use a WebSocket client (not plain HTTP).

| Channel | Path | Filter | Notes |
| --- | --- | --- | --- |
| Ops | `GET /v1/runs/{id}/ws/ops` | none | `event.ingested`, `alert.raised`, `target.updated`, `run.completed` / `run.stopped`; catch-up = one `catchup.target.updated` |
| Map | `GET /v1/runs/{id}/ws/map` | bbox ∪ `includeTargetIds` | Forwards filtered target updates + run terminal msgs; **not** ingest/alerts. In-band `map.viewport` control (no reconnect). |

Both fan out via Redis pub/sub (`run:{id}:ops`) across API replicas. `AUTH_MODE=session` requires a valid session cookie on Upgrade.

## Map viewport filter + eviction

| Concern | Contract |
| --- | --- |
| Server filter | Send updates for targets in **bbox ∪ `includeTargetIds`** |
| Off-screen tracked | Client lists ids in `includeTargetIds` (REST query + WS control) |
| Client eviction | Drop local overlay when **unwatched** and **outside bbox** (or no position). Server does not emit evict frames |
| Pan / zoom | In-band WS `map.viewport` — **no reconnect** required |
| Catch-up on map WS | Same `catchup.target.updated` shape as ops, with `targetStates` filtered to the current filter |
| Ops vs map | Ops WS stays unfiltered for ingest/alerts; map WS drops those types |

## HTTP surface

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/healthz` | Process up |
| `GET` | `/metrics` | Prometheus scrape (not in OpenAPI path list; see Swagger description) |
| `GET` | `/swagger/*` | OpenAPI UI (swag) |
| `POST` | `/v1/auth/register\|login\|logout` | Session auth (`503` when `AUTH_MODE=off` for register/login) |
| `GET` | `/v1/auth/me` | Current user |
| `GET` | `/v1/scenarios` | List; `?status=draft\|ready` |
| `POST` | `/v1/scenarios` | Create draft |
| `GET/PATCH/DELETE` | `/v1/scenarios/{id}` | Read / rename / delete |
| `PUT` | `/v1/scenarios/{id}/draft` | Autosave (invalid OK) |
| `POST` | `/v1/scenarios/{id}/validate` | Validate only |
| `POST` | `/v1/scenarios/{id}/publish` | Validate → ready + normalize |
| `POST` | `/v1/scenarios/import` | Import v2 (v1 migrated) |
| `POST` | `/v1/scenarios/generate` | Async demo/random planner → draft/ready; `{ jobId }` |
| `GET` | `/v1/scenarios/generate/jobs/{id}` | Generate job progress + `scenarioId` |
| `POST` | `/v1/scenarios/{id}/targets/{tid}/route` | Authentic single-target route into draft |
| `POST` | `/v1/runs` | Start ready scenario (`startAt` optional) |
| `GET` | `/v1/runs` | Active + recent (24h); `scenarioName`; `?active=true` |
| `GET` | `/v1/runs/{id}` | Summary + `scenarioName` |
| `POST` | `/v1/runs/{id}/stop` | Stop |
| `GET` | `/v1/runs/{id}/snapshot` | Full due-set |
| `GET` | `/v1/runs/{id}/viewport` | Map cold load (`west&south&east&north&zoom&includeTargetIds`) |
| `GET` | `/v1/runs/{id}/ws/ops` | Ops WebSocket |
| `GET` | `/v1/runs/{id}/ws/map` | Map WebSocket (in-band `map.viewport`) |
| `GET` | `/v1/manage/scenarios` | Storage list (size, counts, owner); paginated |
| `GET` | `/v1/manage/stats` | Draft/ready + payload bytes + run counts |
| `DELETE` | `/v1/manage/scenarios/{id}` | Cascade-stop active runs → delete runs → delete scenario |
| `POST` | `/v1/manage/scenarios/bulk-delete` | `{ ids: [] }` |
| `GET` | `/v1/manage/metrics/usage` | Time-bucketed usage_events |
| `POST` | `/v1/admin/geo/reseed` | Async mine → PostGIS; returns `jobId` (busy → error) |
| `GET` | `/v1/admin/geo/meta` | Catalogue meta, counts, path health |
| `GET` | `/v1/admin/geo/jobs/{id}` | Reseed job status |
| `GET` | `/v1/geo/*` | Regions / bbox seed queries (public even in session mode) |

## Generate / route + empty catalogue

- Planners load regions/aerodromes/ports/sea-lanes from **Postgres**.
- Road/sea runtime tiles: `GEO_TILEJSON_URL` (TileJSON → `{z}/{x}/{y}`).
- **Empty catalogue:** kick reseed (`POST /v1/admin/geo/reseed`) when MBTiles available; otherwise **synthetic soft-fail** (wander tracks). Response flags: `catalogueEmpty`, `reseedKicked`, `degraded` / `degradedTrackCount`.
- Parity deltas: [geo-parity.md](./geo-parity.md).

## Manage + usage_events

- Emitted event types: `scenario.draft_saved`, `scenario.published`, `scenario.deleted`, `run.started`, `run.stopped`, `run.completed` (+ `auth.login` / `auth.register` in session mode).
- `AUTH_MODE=off`: `user_id` is null; optional `X-Client-Id` → `properties.client_id`.
- Manage delete always removes dependent `runs` (FK is `ON DELETE RESTRICT`) after stopping any `running` runs.
- Full TanStack Query `/manage` + `/runs` UI ships with Phase 10 (`VITE_API_BASE_URL`).

## Backing services

- **Postgres + PostGIS** — geo catalogue + scenarios/targets/events + runs/checkpoints/leases + `run_target_positions` + `usage_events` + `users` / `sessions`
- **Redis** — pub/sub for ops and map channels across API instances
- **MBTiles** — `MBTILES_PATH` volume shared with tileserver; mined into PostGIS, not stored as blob
- **TileJSON** — optional `GEO_TILEJSON_URL` for runtime road/sea MVT fetches

## Compose / Traefik

- Host rule: `Host(\`api.adversary\`)`, entrypoint `web`
- Depends on healthy `postgres` + `redis`; `migrate` one-shot before `api`
- `INSTANCE_ID` optional per replica for lease identity
- `data/tiles` mounted read-only; after `tiles:collect`, see `SOURCE.txt` / `READY.json`
- Default `AUTH_MODE=off` for local Compose; set `AUTH_MODE=session` to enable cookies

## Auth

| `AUTH_MODE` | Behavior |
| --- | --- |
| `off` | No-op middleware (trusted network). Shared scenarios (`owner_user_id` null). Usage `user_id` null. |
| `session` | Opaque HttpOnly cookie `adversary_session`. Protects mutating `/v1`, owner-scoped reads, and ops/map WS. Drafts/runs/manage scoped by `owner_user_id`. Usage sets `user_id`. |

## Verification checklist

```bash
# From monorepo root
docker compose up -d postgres redis
DATABASE_URL='postgres://adversary:adversary@localhost:5432/adversary?sslmode=disable' \
  go run ./apps/api/cmd/migrate up

# Build + unit tests (DB integration tests skip without DATABASE_URL)
cd apps/api && go build ./... && go test ./... -count=1

# With DB: include lease steal, reseed advisory lock, draft/publish, manage
DATABASE_URL='postgres://adversary:adversary@localhost:5432/adversary?sslmode=disable' \
  go test ./... -count=1

# Race on concurrency-sensitive packages
go test ./internal/bus/ ./internal/engine/ ./internal/lease/ -race -count=1

# Runtime smoke
HTTP_ADDR=':8080' AUTH_MODE=off go run ./apps/api/cmd/api serve
curl -sf http://localhost:8080/healthz
curl -sf http://localhost:8080/swagger/index.html >/dev/null
# Compose Traefik: http://api.adversary/healthz (add 127.0.0.1 api.adversary to /etc/hosts)
```

## Related docs

- [apps/api/README.md](../apps/api/README.md) — env vars, local run, migrate, runs/WS curl examples, draft/publish, generate/route, geoseed, tests
- [geo-seeds.md](./geo-seeds.md) — catalogue schema, reseed CLI/API, collect → mine workflow
- [geo-parity.md](./geo-parity.md) — Phase 7 exact vs documented deltas
