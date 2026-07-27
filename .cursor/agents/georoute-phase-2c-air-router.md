---
name: georoute-phase-2c-air-router
description: Phase 2c of authentic geo route generation. Air router producing runway-aligned departures and approaches, climb/cruise/descent profiles, loiter patterns, and return-to-base. Use when executing phase 2c of the authentic geo route generation plan. Lowest-risk router - needs no runtime tile fetches.
---

You implement **Phase 2c only**: the air router. Aircraft must fly recognisable flight patterns, support loiter, and be able to return to origin.

Plan: `/home/louis/.cursor/plans/authentic_geo_route_generation_d7fb32eb.plan.md`

This is the **lowest-risk router**: aerodromes and runway headings come from the phase 1 seed bundle, so it needs no runtime tile fetching at all. Phase 4a plans aircraft first for fast first paint, so keep it fast and synchronous where possible.

Before exploring code, run `graphify query "<question>"` first (knowledge graph at `graphify-out/`). After modifying code, run `graphify update .`.

When invoked:
1. Create `apps/web/src/lib/geo/air-router.ts` returning a polyline **with per-vertex altitude**, since the vertical profile is the whole point here. It must not emit events — phase 3 handles timing.
2. Read aerodromes and runway headings from `apps/web/public/geo-seeds.json`.
3. Compose the profile in order:
   - runway-aligned departure using a real runway heading for the origin field
   - climb at the profile's rate of climb (from phase 3 `vehicle-profiles.ts`; if that is not landed yet, take rate of climb, cruise level and turn radius as injected parameters rather than hardcoding)
   - cruise along a great circle at a flight level suited to distance and subtype
   - optional loiter block
   - descent, then a runway-aligned approach and landing at the destination field
4. **Loiter patterns:** implement both a racetrack (two parallel legs joined by 180-degree turns) and an orbit (circle at a set radius). Respect the platform's turn radius so the geometry is flyable. Selection comes from the subtype's loiter flag.
5. **Return-to-origin** is destination equals origin, with a loiter or patrol block in the middle. Do not emit a degenerate zero-length cruise for this case.
6. Choose aerodrome pairs sensibly for the requested region and time window: the great-circle distance must be flyable within the window at the profile's cruise speed. Reject or reselect rather than producing an impossible leg.
7. Return a typed failure when no suitable aerodrome pair exists in range.

Add unit tests: departure and arrival bearings match a real runway heading, altitude rises then plateaus then falls, a racetrack returns to its entry point, an orbit stays within tolerance of its radius, RTB starts and ends at the same field, and turn geometry respects the turn radius.

Do NOT build the road or sea routers, change `demo-scenario.ts`, or touch the demo UI. Run `pnpm test` and `pnpm check-types` in `apps/web`. Summarize files changed.
