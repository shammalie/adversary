---
name: georoute-phase-3-kinematics
description: Phase 3 of authentic geo route generation. Subtype-keyed vehicle profiles as the single source of kinematic truth, plus polyline-to-events synthesis with turn limits and Douglas-Peucker simplification to a 60-150 point budget. Use when executing phase 3 of the authentic geo route generation plan.
---

You implement **Phase 3 only**: kinematics and track synthesis. This turns routed polylines into timed `SimulationEvent[]`.

Plan: `/home/louis/.cursor/plans/authentic_geo_route_generation_d7fb32eb.plan.md`

Before exploring code, run `graphify query "<question>"` first (knowledge graph at `graphify-out/`). After modifying code, run `graphify update .`.

When invoked:

1. Create `apps/web/src/lib/geo/vehicle-profiles.ts` as **the single source of kinematic truth**, keyed by `vehicleSubtype` rather than category. Today `VEHICLE_SUBTYPES` in `demo-scenario.ts` L89–95 is only display strings with no physics, which is why a "Transport" can currently cruise at 1,300 kt while a "Multi-role fighter" plods at 95 kt. Every existing subtype gets: cruise band, max speed, climb and descent rate, turn radius, typical flight level, and loiter / return-to-base flags.
   - Demote `CATEGORY_SPEED_RANGES` to a fallback for targets with no subtype.
   - Keep `CATEGORY_TOP_SPEED_KNOTS` as the hard clamp used by `clampSpeedToCategory` in `vehicle-speed.ts`.
   - Turn radius and climb rate feed step 2; loiter and RTB flags are consumed by the air router in phase 2c.

2. Create `apps/web/src/lib/geo/path-to-events.ts`:
   - Walk the routed polyline at the profile's speed, applying turn-rate limits and reducing speed through turns.
   - Then **simplify with Douglas-Peucker by perpendicular distance in metres** to hit a 60–150 point budget, so corners survive and straights stay sparse.
   - Emit authored `speed` and `altitude` on every point. The engine prefers authored speed (`derivePositionSnapshot` in `position-telemetry.ts` L91), so never leave it to be inferred.
   - Round coordinates to 6 decimals to match the existing generator's output.

3. Preserve the existing physical contract, which is the best part of the current system: distance equals speed times elapsed time, and `assertFeasibleEndWindow` semantics from `event-generator.ts` L208 must still hold. When a routed distance cannot fit the authored window, retime or reject — never emit a track that exceeds the category maximum.

4. Non-uniform spacing is already safe: `interpolatePositionSnapshot` computes progress per segment, so dense-at-corners and sparse-on-straights needs no engine change. Do not add uniform-interval assumptions.

Add unit tests: simplification keeps corner vertices and drops collinear ones, point counts land inside the budget, no emitted speed exceeds the category ceiling, subtype profiles override category bands, altitude follows the climb and descent rates, and a window too short for the routed distance is rejected rather than producing an impossible speed.

Do NOT change `demo-scenario.ts` orchestration or touch the demo UI. Run `pnpm test` and `pnpm check-types` in `apps/web`. Summarize files changed.
