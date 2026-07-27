---
name: georoute-phase-4b-demo-ui
description: Phase 4b of authentic geo route generation. Region multi-select in the demo dialog, async loadRandomDemo with useTransition, progress readout and cancel button. Use when executing phase 4b of the authentic geo route generation plan.
---

You implement **Phase 4b only**: the demo dialog UI in `apps/web/src/components/scenario-builder.tsx`.

Plan: `/home/louis/.cursor/plans/authentic_geo_route_generation_d7fb32eb.plan.md`

Before exploring code, run `graphify query "<question>"` first (knowledge graph at `graphify-out/`). After modifying code, run `graphify update .`.

Current state to work from:
- Demo dialog JSX is around L872–1064; controls are in the scroll area around L885–1049.
- It uses `Dialog`, `Field`, `Checkbox`, `Input`, `DateTimePicker`, and a lazy `MapLocationPicker`. There is **no `Select`** in the dialog yet.
- `loadRandomDemo()` at L685–724 is fully synchronous, with no pending state on the Load demo button.
- There is **no `useTransition` anywhere in the app**, so this establishes the pattern.

When invoked:

1. Add a **region multi-select** for the typed `DEMO_REGIONS` catalogue, supporting one to many selections plus an "Anywhere" option. **Show each region's supported categories** so the pairing is obvious before generating — a user picking maritime-only regions with trucks selected should see the mismatch up front, not discover it afterwards.
2. Keep the existing `demoOrigin` pin and `MapLocationPicker`, and make the precedence visible in the UI: when a pin is set it overrides region selection.
3. Convert `loadRandomDemo` to async with `useTransition` for pending state on the Load demo button.
4. Add a **progress readout** (routed count against total) and a **Cancel button** wired to an `AbortController` passed into the planner.
5. Append targets progressively as the planner emits them. Important: `loadRandomDemo` currently calls `setSelectedTargetId(demo.targets[0]?.id)` and `setDraft(...)` after generation — these must fire **once on the first ready target**, not on every append, or selection will thrash while targets stream in.
6. Report degradation in the completion toast: how many tracks were routed authentically versus fell back to synthetic, and mention any category that had to relocate for want of a compatible region.
7. Keep the existing validation guards (target count, vehicle selection, end-time ordering) and their `toast.error` messages.

Accessibility matters here — the repo runs axe in e2e:
- The multi-select must be keyboard operable with a proper accessible name and grouping.
- The progress readout should be announced politely (`aria-live="polite"`), not assertively.
- Disabled and pending states must not rely on colour alone.

Do NOT change the planner, routers, or `demo-scenario.ts` logic — that was phase 4a. Run `pnpm test`, `pnpm check-types`, and `pnpm test:a11y` in `apps/web`. Summarize files changed and any axe findings.
