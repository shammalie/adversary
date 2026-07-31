# Graph Report - api  (2026-07-31)

## Corpus Check
- 15 files · ~1,881 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 53 nodes · 62 edges · 10 communities (9 shown, 1 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.8)
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

## God Nodes (most connected - your core abstractions)
1. `Adversary API` - 8 edges
2. `newMigrator()` - 6 edges
3. `newUpCmd()` - 5 edges
4. `newDownCmd()` - 5 edges
5. `Load()` - 5 edges
6. `NewRouter()` - 5 edges
7. `newServeCmd()` - 4 edges
8. `Config` - 4 edges
9. `Provide()` - 4 edges
10. `ProvideRouter()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `newUpCmd()` --calls--> `Load()`  [INFERRED]
  cmd/migrate/main.go → internal/config/config.go
- `newUpCmd()` --calls--> `Up()`  [INFERRED]
  cmd/migrate/main.go → internal/migrate/migrate.go
- `newDownCmd()` --calls--> `Load()`  [INFERRED]
  cmd/migrate/main.go → internal/config/config.go
- `newDownCmd()` --calls--> `Down()`  [INFERRED]
  cmd/migrate/main.go → internal/migrate/migrate.go
- `newServeCmd()` --calls--> `RunServe()`  [INFERRED]
  cmd/api/main.go → internal/app/app.go

## Import Cycles
- None detected.

## Communities (10 total, 1 thin omitted)

### Community 0 - "newServeCmd"
Cohesion: 0.22
Nodes (8): Command, main(), newServeCmd(), Context, Injector, ProvideLogger(), RunServe(), Logger

### Community 1 - "Adversary API"
Cohesion: 0.22
Nodes (8): Adversary API, Architecture, Docker Compose, Environment, Migrate, Run locally, Stack, Swagger

### Community 2 - "NewRouter"
Cohesion: 0.32
Nodes (6): Handler, Middleware(), Handler, Injector, NewRouter(), ProvideRouter()

### Community 3 - "newMigrator"
Cohesion: 0.52
Nodes (6): FS, Down(), newMigrator(), toPgx5URL(), Up(), Migrate

### Community 4 - "newDownCmd"
Cohesion: 0.70
Nodes (4): Command, main(), newDownCmd(), newUpCmd()

### Community 5 - "Load"
Cohesion: 0.70
Nodes (4): Config, Injector, Load(), Provide()

### Community 6 - "Healthz"
Cohesion: 0.40
Nodes (4): HealthResponse, Healthz(), Request, ResponseWriter

## Knowledge Gaps
- **9 isolated node(s):** `github.com/shammalie/adversary/apps/api`, `HealthResponse`, `Stack`, `Environment`, `Run locally` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Load()` connect `Load` to `newDownCmd`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Why does `NewRouter()` connect `NewRouter` to `Load`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Why does `Config` connect `Load` to `NewRouter`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `newUpCmd()` (e.g. with `Load()` and `Up()`) actually correct?**
  _`newUpCmd()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `newDownCmd()` (e.g. with `Load()` and `Down()`) actually correct?**
  _`newDownCmd()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `Load()` (e.g. with `newDownCmd()` and `newUpCmd()`) actually correct?**
  _`Load()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `github.com/shammalie/adversary/apps/api`, `HealthResponse`, `Stack` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._