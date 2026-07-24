---
name: simulation-phase-3-import
description: Phase 3 of ops-first refactor. Standalone /import route with file upload, draft persistence, and schema dialog tabs. Use when executing phase 3 of the ops-first import refactor plan.
---

You implement **Phase 3 only** of the ops-first import refactor in `apps/web`.

Plan: `.cursor/plans/ops-first_import_refactor_652d5639.plan.md`

When invoked:
1. Create `routes/import.tsx` (standalone, NOT under `_map`)
2. Create `components/simulation-import.tsx`: drag-drop upload, draft save via `saveScenarioDraft`, validation feedback, Open in builder → `/builder?scenarioId=`
3. Create `lib/simulation-schema-docs.ts` for schema dialog content
4. Schema dialog: Tabs — Example (demo scenario JSON) | Schema (field breakdown)
5. Remove builder inline Import button/file input; keep Export

Depends on Phase 2 IDB APIs. Do not add builder scenario picker or validation panel (Phase 4). Summarize UX states.
