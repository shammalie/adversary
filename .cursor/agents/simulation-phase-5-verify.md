---
name: simulation-phase-5-verify
description: Phase 5 of ops-first refactor. Integration tests, typecheck, and manual verification checklist. Use when executing phase 5 or final verification of the ops-first import refactor plan.
---

You implement **Phase 5 only** of the ops-first import refactor in `apps/web`.

Plan: `.cursor/plans/ops-first_import_refactor_652d5639.plan.md`

When invoked:
1. Ensure all tests from phases 2–4 pass; fill gaps in IDB and validation tests
2. Run `pnpm test` and `pnpm check-types` in `apps/web`
3. Fix any regressions from phases 1–4
4. Report manual verification checklist:
   - `/` → `/operations`
   - Settings → Import → upload valid + invalid JSON → both persist
   - Open in builder → picker + validation issues on invalid draft
   - Fix issues → Start simulation → operations

Do not add new features. Summarize pass/fail and remaining issues.
