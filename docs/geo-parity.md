# Geo / planner parity (Phase 7)

Go ports live in `apps/api/internal/geo` and `apps/api/internal/generate`, sourced from `apps/web/src/lib/geo/*`, `scenario-planner.ts`, `plan-target-events.ts`, and `event-generator.ts`.

## Exact (behavioral) parity

| Area | Notes |
| --- | --- |
| Vehicle profiles / speed bands | Same subtype table + category fallbacks |
| Seeded RNG / id factory | Numerical Recipes LCG; same seed stream |
| Synthetic `generateRouteEvents` | Wander + A→B with latitude soft steering |
| Soft-fail cascade | Router typed failure → synthetic track; no hard block on empty catalogue |
| Air router | Seed-only aerodromes; RTB / loiter / point-to-point |
| Path → events | Douglas–Peucker budget 60–150, turn-limited walk |
| Empty catalogue | Kick reseed if possible → else synthetic soft-fail |

## Documented deltas (follow-up)

| ID | Area | Delta |
| --- | --- | --- |
| P7-1 | Road hierarchical refine | Local refinement **reroutes** the local corridor rather than stitching two local legs onto the coarse skeleton (avoids cross-zoom join artifacts). Skeleton → local fallback on z10 failure is preserved. |
| P7-2 | Sea water-grid mask | Grid is built from **fetched corridor tiles** rather than a padded full bbox, limiting tile I/O on long routes. Ferry → grid → waterway preference order is unchanged. |
| P7-3 | Worker boundary | TS uses a Web Worker + client; Go runs routers in-process with `context.Context` cancellation / 12s timeout. |
| P7-4 | Scenario IDs | Postgres requires UUID scenario primary keys; seeded id factories apply to **targets/events only**. |
| P7-5 | Tile source | Go needs `GEO_TILEJSON_URL` at runtime; when unset, road/sea degrade to synthetic (same soft-fail outcome as worker/tile failures in TS). |
| P7-6 | Concurrent planner | Aircraft-first streaming UX is not exposed over HTTP; generate is an async job that commits the full scenario when done. Per-track soft-fail still applies. |

File these as follow-ups if golden path diffs appear against web fixtures.
