---
name: event-message-export
description: >-
  Implements builder dialog to export positioned events as tactical text lines
  (callsign, per-target ordinal, POS, optional ALT/HDG/SPD, optional message,
  OUT) with preview, copy, and file download. Use proactively when asked for
  message export, event POS export, or tactical message lines from events.
---

You implement **event message export** only in the adversary `apps/web` builder.

## Graphify (mandatory)

Before Read/Grep/Glob/Bash exploration, run `graphify query` / `graphify explain` / `graphify path` first. After modifying code files, run `graphify update .`.

## Locked decisions (do not re-litigate)

- One line per **positioned** event only. **Skip message-only events** (no `position`), even if they have `message`.
- When a positioned event **also** has `message`, append the message **face value** (verbatim; empty after trim → treat as absent) **immediately before** `OUT`. Not a checkbox; always included when present.
- **Message is independent of ALT/HDG/SPD:** missing or unchecked altitude/heading/speed must not block the message. A line can be `… POS lat lon <message> OUT` with no ALT/HDG/SPD tokens.
- Format:  
  `TARGET_NAME MESSAGE_POSITION POS latH lonH[ ALT n][ HDG n][ SPD n][ MESSAGE] OUT RELATIVE_SECONDS`
- **Relative time (whole file):** after `OUT`, append cumulative seconds from the first **exported** line in the file, using authored **`event.at` only** (ignore `firesAt` and `scenario.fastForwardMultiplier`). Message-only skips do not set the origin. Per-target ordinals still reset per target; relative time does **not** reset per target.
- **Dialog-only time multiplier:** `EventMessageExportOptions.timeMultiplier` (integer 1×–10× Select in the export dialog; default/reset to **1×** on each open). Not stored on the scenario; independent of scenario fast-forward. Affects **only** trailing `OUT n`.
- **Compression:** `floored = Math.floor((atMs − originMs) / timeMultiplier / 1000)`. Then enforce uniqueness: `out = max(floored, lastOut + 1)` so successive exported lines differ by ≥1 second.
- **Origin-first exception:** the first positioned export per `targetId` whose `at` equals the file origin `at` may all share **`OUT 0`** (no bump among them).
- Canonical examples (unit tests must cover these):

```text
ALPHA 004 POS 58.90N 24.20E ALT 25000 HDG 258 SPD 780 OUT 180
ALPHA 005 POS 59.10N 24.40E ALT 24000 HDG 260 SPD 760 BANDIT MANEUVERING WEST OUT 240
BRAVO 001 POS 58.50N 23.90E CONTACT LOST OUT 0
BRAVO 002 POS 58.55N 23.95E OUT 60
```

  - Line 1: position + optional telemetry, no `message`, relative seconds from file origin
  - Line 2: position + telemetry + face-value `message` before `OUT`, then relative seconds
  - Line 3: position, **no** ALT/HDG/SPD (missing or unchecked), **message still present** before `OUT`, then relative seconds
  - Line 4: position only, no telemetry tokens, no message, then relative seconds
  - Not exported: an event with only `message` and no `position`
  - Cumulative example across targets: `… OUT 0` / `… OUT 90` / `… OUT 150`
- `TARGET_NAME` = `target.callsign`.
- `MESSAGE_POSITION` = **per-target** ordinal over that target’s **positioned** events in `sortEvents` order, zero-padded to 3 (`001`…). Message-only events do not consume an ordinal.
- Coords: absolute value + hemisphere (`N`/`S`, `E`/`W`); 2 decimal places for lat/lon.
- `ALT` / `HDG` / `SPD` are **optional export fields** controlled by checkboxes in the dialog (default: all three on). If a checkbox is on but the value is missing/underivable, **omit that token** (do not invent `0` for HDG on first point unless derive already yields a value).
- `ALT` from `position.altitude` (feet as stored). `SPD` from `position.speed` if authored, else derived via `derivePositionSnapshot`. `HDG` derived via previous→current bearing (same helper).
- Trailing `OUT` always present.
- UI: Dialog (same pattern as Load random demo) from Review timeline footer next to existing JSON **Export** in `scenario-builder.tsx`. Contents: **Time multiplier** Select (1×–10×), ALT/HDG/SPD checkboxes, live preview of all lines, **Copy**, **Export to file** (download `.txt` via blob, mirror `downloadScenario`).

## When invoked

1. Orient with graphify on scenario export, GroupedTimeline footer, `derivePositionSnapshot`, Dialog patterns.
2. Add pure formatter `apps/web/src/lib/event-message-export.ts` (+ `event-message-export.test.ts`) covering all canonical examples and a message-only skip case.
3. Add dialog (component or inline) with checkboxes, preview, copy, download.
4. Wire button next to JSON Export in Review timeline footer (`scenario-builder.tsx`).
5. Reuse `@workspace/ui` Dialog; follow existing download blob pattern from `downloadScenario`.
6. `graphify update .`
7. Summarize what changed. Do **not** implement review map circles or scenario delay.

## Key files

- `apps/web/src/lib/event-message-export.ts` (new)
- `apps/web/src/lib/event-message-export.test.ts` (new)
- `apps/web/src/lib/position-telemetry.ts` (`derivePositionSnapshot`)
- `apps/web/src/lib/simulation-engine.ts` (`sortEvents`)
- `apps/web/src/lib/simulation-storage.ts` (`downloadScenario` pattern)
- `apps/web/src/components/scenario-builder.tsx` (timeline footer Export)
- `packages/ui` Dialog components
