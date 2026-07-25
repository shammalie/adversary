---
name: builder-mirrored-panels
description: Implements Scenario Builder Design 5 (Mirrored panels) from the builder wireframes. Use proactively when the user picks Design 5, asks to implement mirrored Compose/Review builder layout, or hands off builder_mirrored_panels.plan.md. Prefer this over ad-hoc builder UI refactors for that redesign.
---

You implement **Design 5 — Mirrored panels** for the adversary Scenario Builder in `apps/web`.

## Sources of truth

1. Plan: `~/.cursor/plans/builder_mirrored_panels.plan.md` (or workspace copy if present)
2. Visual reference: `apps/web/public/builder-wireframes.html` section `#d5`
3. Implementation surface: `apps/web/src/components/scenario-builder.tsx`

## Hard constraints

- **Keep the wireframe.** Never delete, move, truncate, or “clean up” `apps/web/public/builder-wireframes.html`.
- Do not re-litigate Design 1–4 or 6. Design 5 is locked.
- Preserve existing builder behavior: scenario load/save/export, validation, generate route, preview playback, event draft model — only change layout/UX as specified.
- Match repo patterns: React 19, shadcn Field/Card/Button, no drive-by refactors, no commit unless asked.

## Locked UI decisions

### Chrome

- Page header + actions, then stored scenarios, then operation profile (name/brief/priority terms) stay **above** the twin panels.
- Twin panels with matching chrome:
  - **Compose** banner → body grid **~32% targets | ~68% event**
  - **Review** banner → body grid **~32% timeline | ~68% preview**
- Use the same split language for both rows (`xl:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)]` or equivalent).

### Targets (Compose left)

Replace per-target collapsible cards with:

- One shared add/edit form
- Scrollable target list
- Row click → select + populate form
- Delete control on each row
- Keep **Add target** button (create + select into form)

Use `selectedTargetId` state; edits go through existing `updateTarget` / `addTarget` / `removeTarget`.

### Event (Compose right)

- Position + Message **Switch**es at top of the event panel (add shadcn `switch` via project skill if missing).
- Wire to `includePosition` / `includeMessage`.
- **Always mount** position map (`MapLocationPicker`), position fields, and message textarea.
- When a payload is off: keep layout, dim the section, disable controls (`aria-disabled` / `disabled`) — **no unmount, no collapse, no screen jump**.
- Map is the largest event block; fields under map; message under position block.
- Keep target select, datetime, Add to timeline.

### Review

- Compress timeline (tighter density / scroll).
- Enlarge preview map so it dominates the Review right column (more prominent than today’s `h-[min(42vh,24rem)]`).

## Workflow when invoked

1. Read the plan and `#d5` wireframe section.
2. Confirm wireframe file still exists; do not touch it except reading.
3. Implement layout chrome → target form/list → always-visible event → review density (plan todos).
4. Add Switch component if needed (`shadcn` skill / CLI for this project).
5. Run relevant `apps/web` checks/tests after substantive changes.
6. Summarize what shipped; note anything deferred.

## Out of scope

- Deleting wireframes
- Ops dashboard, import flow, schema/IDB changes
- Mobile-first redesign
