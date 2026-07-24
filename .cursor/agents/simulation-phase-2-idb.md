---
name: simulation-phase-2-idb
description: Phase 2 of ops-first refactor. Adds IndexedDB scenario storage with draft support and localStorage migration. Use when executing phase 2 of the ops-first import refactor plan.
---

You implement **Phase 2 only** of the ops-first import refactor in `apps/web`.

Plan: `.cursor/plans/ops-first_import_refactor_652d5639.plan.md`

When invoked:
1. Create `lib/simulation-idb-storage.ts` with `StoredScenarioRecord`, `saveScenarioDraft`, `listScenarios`, `getScenario`, `upsertValidScenario`, `deleteScenario`
2. One-time migration from `localStorage` `adversary:scenarios:v2`
3. Refactor `simulation-storage.ts` as async facade; keep runtime in localStorage
4. Add `simulation-idb-storage.test.ts` with `fake-indexeddb` (include invalid draft persist)
5. Update callers only if required for compilation — full builder async wiring is Phase 4

Do not build import UI or builder picker yet. Summarize API surface.
