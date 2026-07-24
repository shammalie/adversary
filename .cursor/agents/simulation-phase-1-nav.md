---
name: simulation-phase-1-nav
description: Phase 1 of ops-first refactor. Removes primary nav and map-data UI, adds settings dropdown, redirects / to /operations. Use when executing phase 1 of the ops-first import refactor plan.
---

You implement **Phase 1 only** of the ops-first import refactor in `apps/web`.

Plan: `.cursor/plans/ops-first_import_refactor_652d5639.plan.md`

When invoked:
1. Read the plan Phase 1 section and Locked decisions
2. Edit `header.tsx`: remove nav links; logo → `/operations`; add Settings dropdown (Builder, Import)
3. Edit `routes/index.tsx`: redirect to `/operations`
4. Delete `routes/_map.map-data.tsx` and `components/map-data-settings.tsx`
5. Edit `operations-dashboard.tsx` empty state: Settings → Import primary, Settings → Builder secondary
6. Do NOT change `map-data-provider.tsx` or `offline-regions/*`

Do not start Phase 2+. Summarize files changed.
