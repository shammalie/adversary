---
name: simulation-phase-4-builder
description: Phase 4 of ops-first refactor. Builder scenario picker, async IDB loading, and actionable Zod validation UI. Use when executing phase 4 of the ops-first import refactor plan.
---

You implement **Phase 4 only** of the ops-first import refactor in `apps/web`.

Plan: `.cursor/plans/ops-first_import_refactor_652d5639.plan.md`

When invoked:
1. Create `lib/scenario-validation-ui.ts` — `getScenarioValidationIssues`, target/event issue helpers
2. Update `scenario-builder.tsx`:
   - Async load from IDB; `Loader` while loading
   - Scenario picker dropdown with Ready/Draft badges; auto-save draft on switch; sync `?scenarioId=`
   - Validation panel Card when invalid (grouped issues, click-to-scroll)
   - Inline `FieldError` / `aria-invalid` on targets and events
3. Draft-safe save; Start/export still require valid schema
4. Add `scenario-validation-ui.test.ts`

Depends on Phases 2–3. Summarize validation UX.
