# Graph Report - api  (2026-07-31)

## Corpus Check
- 37 files · ~24,038 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 284 nodes · 656 edges · 16 communities (15 shown, 1 thin omitted)
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 91 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `21066dc0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- newServeCmd
- Adversary API
- NewRouter
- newMigrator
- newDownCmd
- Load
- Healthz
- github.com/shammalie/adversary/apps/api
- Store
- scenario/migrate.go
- ScenarioStore
- .listBBox
- NewPool
- validate_test.go

## God Nodes (most connected - your core abstractions)
1. `Store` - 19 edges
2. `mineAerodromes()` - 18 edges
3. `writeJSON()` - 17 edges
4. `ScenarioHandlers` - 14 edges
5. `minePortsAndFerries()` - 13 edges
6. `probeRegionSupports()` - 13 edges
7. `ScenarioStore` - 13 edges
8. `MBTiles` - 12 edges
9. `Mine()` - 12 edges
10. `Catalogue` - 11 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `Load()`  [INFERRED]
  cmd/geoseed/main.go → internal/config/config.go
- `newServeCmd()` --calls--> `RunServe()`  [INFERRED]
  cmd/api/main.go → internal/app/app.go
- `main()` --calls--> `WriteFixtures()`  [INFERRED]
  cmd/geoseed/main.go → internal/geoseed/bundle.go
- `main()` --calls--> `WriteJSON()`  [INFERRED]
  cmd/geoseed/main.go → internal/geoseed/bundle.go
- `main()` --calls--> `OpenMBTiles()`  [INFERRED]
  cmd/geoseed/main.go → internal/geoseed/mbtiles.go

## Import Cycles
- None detected.

## Communities (16 total, 1 thin omitted)

### Community 0 - "newServeCmd"
Cohesion: 0.22
Nodes (8): Command, main(), newServeCmd(), Context, Injector, Logger, ProvideLogger(), RunServe()

### Community 1 - "Adversary API"
Cohesion: 0.17
Nodes (11): Adversary API, Architecture, Docker Compose, Environment, Geo catalogue / reseed, Migrate, Run locally, Scenarios (draft / publish / import) (+3 more)

### Community 2 - "NewRouter"
Cohesion: 0.12
Nodes (23): Command, main(), newDownCmd(), newUpCmd(), Config, FS, Handler, Middleware() (+15 more)

### Community 3 - "newMigrator"
Cohesion: 0.11
Nodes (46): Geometry, Aerodrome, BBox, Catalogue, Feature, LngLat, MineOptions, Port (+38 more)

### Community 4 - "newDownCmd"
Cohesion: 0.15
Nodes (31): createScenarioRequest, patchScenarioRequest, ScenarioHandlers, scenarioResponse, validateResponse, writeJSON(), RawMessage, Request (+23 more)

### Community 5 - "Load"
Cohesion: 0.13
Nodes (19): main(), Conn, DB, Bundle, FixtureSpec, MBTiles, Reseeder, DefaultFixtureSpecs() (+11 more)

### Community 6 - "Healthz"
Cohesion: 0.40
Nodes (4): HealthResponse, Request, ResponseWriter, Healthz()

### Community 10 - "Store"
Cohesion: 0.17
Nodes (9): Job, Meta, PointRow, Store, metaResponse, Context, Pool, RawMessage (+1 more)

### Community 11 - "scenario/migrate.go"
Cohesion: 0.19
Nodes (19): RawMessage, IsLegacy(), mergeProfile(), MigrateToV2(), migrateV1ToV2(), migrateVehicleCategory(), normalizePriorityTerms(), parseMillis() (+11 more)

### Community 12 - "ScenarioStore"
Cohesion: 0.28
Nodes (10): Context, Pool, RawMessage, Time, UUID, parseTime(), ListFilter, ScenarioRow (+2 more)

### Community 13 - ".listBBox"
Cohesion: 0.28
Nodes (7): bboxLister, errorBody, reseedResponse, GeoHandlers, Request, ResponseWriter, parseBBox()

### Community 14 - "NewPool"
Cohesion: 0.26
Nodes (10): Context, Injector, Pool, NewPool(), ProvidePool(), Pool, T, loadExample() (+2 more)

### Community 15 - "validate_test.go"
Cohesion: 0.52
Nodes (6): T, loadWebFixture(), TestEnsurePayloadID(), TestMigrateV1ToV2(), TestValidateExampleFixture(), TestValidateIncompleteDraftOKForIssues()

## Knowledge Gaps
- **16 isolated node(s):** `github.com/shammalie/adversary/apps/api`, `reseedResponse`, `errorBody`, `HealthResponse`, `patchScenarioRequest` (+11 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NewRouter()` connect `NewRouter` to `newDownCmd`, `NewPool`?**
  _High betweenness centrality (0.381) - this node is a cross-community bridge._
- **Why does `ScenarioHandlers` connect `newDownCmd` to `NewRouter`, `ScenarioStore`?**
  _High betweenness centrality (0.355) - this node is a cross-community bridge._
- **Why does `GeoHandlers` connect `NewRouter` to `Store`, `Load`?**
  _High betweenness centrality (0.257) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `mineAerodromes()` (e.g. with `decodeLayer()` and `propNumber()`) actually correct?**
  _`mineAerodromes()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `writeJSON()` (e.g. with `.CreateScenario()` and `.DeleteScenario()`) actually correct?**
  _`writeJSON()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `github.com/shammalie/adversary/apps/api`, `reseedResponse`, `errorBody` to the rest of the system?**
  _16 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `NewRouter` be split into smaller, more focused modules?**
  _Cohesion score 0.12433862433862433 - nodes in this community are weakly interconnected._