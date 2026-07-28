---
name: review-map-event-points
description: >-
  Implements Review-map per-event position circles with click-to-highlight
  in the builder. Use proactively when asked to add review map event points,
  map↔timeline highlight, or clickable event markers on the Review TrackingMap.
---

You implement **Review map event points** only in the adversary `apps/web` builder.

## Graphify (mandatory)

Before Read/Grep/Glob/Bash exploration, run `graphify query` / `graphify explain` / `graphify path` first. After modifying code files, run `graphify update .`.

## Locked decisions (do not re-litigate)

- Review map (`TrackingMap` in `apps/web/src/components/scenario-builder.tsx` Review panel) shows a **small circle for every event that has `position` and is due** at the current preview scrub time (`effectiveEventAtMs(at) <= previewTimeMs`, via `getEventsDueByTime`), **only when** Build preview “Event dots” is on (`showReviewEventPoints`, **default off**; control lives in Review Build preview toolbar, map mode only). Circles appear/disappear as the scrubber moves. All due targets, **in addition to** existing vehicle markers/trails.
- **Compose** (`MapLocationPicker`) must **not** receive Review `eventPoints` / `buildTrackingMapEventPoints`.
- Circle color matches target `color`.
- Click circle → expand that target’s accordion if collapsed + `setHighlightEventId(eventId)`. Do **not** call `preview.seek` — preview scrub time stays unchanged. Highlight scrolls the row into view via `GroupedTimeline`. Works in View and Edit timeline modes.
- Selected/highlighted circle may use a stronger ring; clear with the existing ~2.4s `highlightEventId` timeout.
- Event circles use **authored** event positions from `scenario.events`, not interpolated preview positions.
- Ops dashboard `TrackingMap` stays unchanged unless new props are optional and no-op when omitted.
- Legacy vehicle-marker `highlightedEventId` is a no-op visually — event-point highlight is the real selection signal (fix or ignore; do not expand scope).

## When invoked

1. Orient with graphify on Review / TrackingMap / GroupedTimeline / MapLocationPicker event points.
2. Extend `apps/web/src/components/tracking-map.tsx`:
   - Accept event points (`id`, `targetId`, lng/lat, `color`) + optional `onEventPointClick` + optional highlighted event id for ring styling.
   - Render small clickable circles (prefer lightweight DOM markers like `createEventPointElement` in `map-location-picker.tsx`).
3. Wire from Review `TrackingMap` only in `scenario-builder.tsx`:
   - Build points from `scenario.events` with `position`, resolve color via target.
   - `onEventPointClick` → expand accordion + `setHighlightEventId` only (no `preview.seek`).
4. Events without `position` get no circle.
5. Add or extend focused tests if practical; manually verify click → timeline highlight without changing scrubber time.
6. `graphify update .`
7. Summarize what changed. Do **not** implement scenario delay or message export.

## Key files

- `apps/web/src/components/scenario-builder.tsx` (Review `TrackingMap` ~preview section)
- `apps/web/src/components/tracking-map.tsx`
- `apps/web/src/components/map-location-picker.tsx` (`createEventPointElement` pattern)
- `apps/web/src/components/grouped-timeline.tsx` (`highlightEventId`)
- `apps/web/src/lib/use-builder-preview.ts` (`seek`)
