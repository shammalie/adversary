---
name: scenario-global-delay
description: >-
  Adds scenario-level delaySeconds to Operation profile and applies it to event
  scheduling in engine/preview/ops display without ops delay UI. Use proactively
  when asked for global scenario delay, schedule offset, or delayed event times.
---

You implement **scenario global delay** only in the adversary `apps/web` codebase.

## Graphify (mandatory)

Before Read/Grep/Glob/Bash exploration, run `graphify query` / `graphify explain` / `graphify path` first. After modifying code files, run `graphify update .`.

## Locked decisions (do not re-litigate)

- Persist optional `delaySeconds: number` on `SimulationScenario` (`apps/web/src/types/target.ts`) as a **schema v2 soft-add** (no bump to v3).
- Constraint: **>= 0** only; omit or `0` = no delay; reject negatives in Zod and UI.
- **Unit: seconds** (non-negative number; integer seconds is fine if simpler).
- Builder control in Operation profile card `#scenario-profile` in `scenario-builder.tsx`, beside name/brief/priority terms.
- **Ops is aware in the engine** (scenario carries `delaySeconds` into runtime) but **must not show** delay UI, badges, or copy explaining delay.
- Effective time everywhere scheduling matters: `Date.parse(event.at) + delaySeconds * 1000`.
- Apply in `simulation-engine.ts` `reconcileRuntime` due checks and builder preview helpers (`use-builder-preview.ts` / preview range / due-by-time).
- Authored `event.at` stays editable as written in the timeline; **do not rewrite** stored ISO strings when delay changes.
- Ops tables (`ops-event-tables.tsx`): display **effective** times with **no** delay labeling (wall clock matches ingest).
- Update Zod in `simulation-schema.ts`, docs in `simulation-schema-docs.ts`, `coerceEditableScenario` / blank scenario defaults / any load path that copies known fields.

## When invoked

1. Orient with graphify on `SimulationScenario`, `reconcileRuntime`, Operation profile, ops event tables.
2. Add `delaySeconds` to type + Zod (`z.number().nonnegative().optional()` or equivalent) + schema docs.
3. Add Operation profile field (number input, reject negatives, empty/0 clears delay).
4. Centralize `effectiveEventAtMs(event, delaySeconds)` (or equivalent) and use it in:
   - `reconcileRuntime` due checks
   - builder preview time range / get-events-due helpers
   - ops table displayed times
5. Ensure exported JSON includes `delaySeconds` so ops runtime can apply it; ops UI never surfaces the setting.
6. Tests: engine — event due only after `at + delay`; schema rejects negative; confirm ops has no delay controls.
7. `graphify update .`
8. Summarize what changed. Do **not** implement review map circles or message export.

## Key files

- `apps/web/src/types/target.ts`
- `apps/web/src/lib/simulation-schema.ts`
- `apps/web/src/lib/simulation-schema-docs.ts`
- `apps/web/src/lib/simulation-engine.ts`
- `apps/web/src/lib/use-builder-preview.ts`
- `apps/web/src/lib/simulation-idb-storage.ts` (`coerceEditableScenario`)
- `apps/web/src/components/scenario-builder.tsx` (`#scenario-profile`)
- `apps/web/src/components/ops-event-tables.tsx`
- `apps/web/src/lib/simulation-engine.test.ts`
