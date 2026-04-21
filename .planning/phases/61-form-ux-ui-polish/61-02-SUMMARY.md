---
phase: 61
plan: "02"
subsystem: ui
tags: [form, textarea, max-height, tooltip, top-bar, bot-icon]
dependency_graph:
  requires: []
  provides: [textarea-overflow-constraint, bot-icon-tooltip]
  affects: [import-project-dialog, create-task-dialog, top-bar]
tech_stack:
  added: []
  patterns: [base-ui-tooltip-render-prop]
key_files:
  created: []
  modified:
    - src/components/project/import-project-dialog.tsx
    - src/components/board/create-task-dialog.tsx
    - src/components/layout/top-bar.tsx
decisions:
  - Use base-ui render prop pattern for TooltipTrigger (not asChild) — matches project convention
  - TooltipProvider already globally provided in layout.tsx — no per-tooltip wrapping needed
  - delay prop on TooltipTrigger (not delayDuration on Tooltip) — base-ui API difference from shadcn
metrics:
  duration: "3 minutes"
  completed: "2026-04-21T05:45:00Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 61 Plan 02: Form UX & UI Polish (Textarea + Bot Icon) Summary

## One-liner

Added max-height scroll constraint to description textareas in two dialogs, and relocated the Bot assistant icon to after the search bar with a tooltip.

## What Was Done

### Task 1: Add max-height to description textareas (FORM-04)

Applied `max-h-[200px] overflow-y-auto` to the description textarea in:
- `import-project-dialog.tsx` — raw `<textarea>` element, appended to existing className string
- `create-task-dialog.tsx` — shadcn `<Textarea>`, added as new `className` prop

This prevents both dialogs from growing beyond the viewport when the user enters long descriptions — the textarea now caps at 200px and scrolls internally.

### Task 2: Relocate Bot icon and add Tooltip (UI-01)

Updated `top-bar.tsx`:
- Added `Tooltip`, `TooltipContent`, `TooltipTrigger` imports from `@/components/ui/tooltip`
- Removed the Bot button from the "Right Actions" div
- Created a new `<div className="flex items-center gap-2">` wrapping both the search button and the Bot button
- Wrapped Bot button in `Tooltip > TooltipTrigger` (using base-ui render prop pattern) with `delay={500}`
- Added `TooltipContent` showing `t("assistant.iconLabel")` ("助手" in zh)

The Bot icon now renders immediately to the right of the search bar, before the language toggle and settings area.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] base-ui Tooltip API differs from shadcn/radix**

- **Found during:** Task 2 TypeScript check
- **Issue:** Plan specified `delayDuration={500}` on `<Tooltip>` and `asChild` on `<TooltipTrigger>` — these are radix-ui props, not base-ui. This project uses `@base-ui/react/tooltip` which has a different API.
- **Fix:** Used `delay={500}` on `<TooltipTrigger>` (base-ui prop), used `render` prop instead of `asChild`, removed per-tooltip `TooltipProvider` (already global in layout.tsx)
- **Files modified:** src/components/layout/top-bar.tsx
- **Commit:** 57d6e83

## Known Stubs

None — all changes are fully wired CSS and JSX with no placeholder data.

## Self-Check: PASSED
