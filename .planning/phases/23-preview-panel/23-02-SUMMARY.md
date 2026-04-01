---
phase: 23-preview-panel
plan: "02"
subsystem: ui
tags: [react, nextjs, iframe, preview, tailwind, i18n]

requires:
  - phase: 23-01
    provides: preview-actions.ts (startPreview/stopPreview/openInTerminal), i18n keys, preview-process-manager

provides:
  - PreviewPanel client component with toolbar, command input, address bar, iframe
  - Project type segmented control (FRONTEND/BACKEND) in create-project dialog
  - Terminal app text input in General Settings that persists to SystemConfig

affects:
  - 23-03 (wires PreviewPanel into workbench task-page-client)
  - top-bar.tsx consumers that call onCreateProject callback

tech-stack:
  added: []
  patterns:
    - PreviewPanelProps interface with refreshKey for parent-controlled iframe re-render
    - Status badge with per-status color classes (emerald/red/muted)
    - onBlur-persist pattern for command input (writes to DB without blocking typing)

key-files:
  created:
    - src/components/task/preview-panel.tsx
  modified:
    - src/components/layout/top-bar.tsx
    - src/components/settings/general-config.tsx

key-decisions:
  - "PreviewPanel console.error for terminal errors — no toast library needed for this edge case"
  - "refreshKey prop is parent-controlled; iframe key={refreshKey} handles forced re-render"
  - "onBlur-persist for commandInput: updateProject called when user tabs/clicks away, not on every keystroke"

patterns-established:
  - "Status badge: inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs + per-status color class"
  - "Empty state: Eye icon + h3 heading + p body, centered with flex col items-center justify-center"

requirements-completed: [PV-01, PV-02, PV-03, PV-04, PV-05]

duration: 8min
completed: "2026-03-26"
---

# Phase 23 Plan 02: Preview Panel UI Summary

**PreviewPanel client component with server controls, address bar, and iframe; project type selector in create dialog; terminal app config in General Settings**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-26T00:00:00Z
- **Completed:** 2026-03-26T00:08:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- PreviewPanel component: toolbar row (status badge + Run/Stop + Refresh + Terminal buttons), command input row, address bar row, iframe area — all matching UI-SPEC layout
- Empty state rendered when worktreePath is null (Eye icon + heading + desc)
- Project type segmented control (Frontend/Backend) added to create-project dialog in TopBar, state resets on form clear
- Terminal app text input in GeneralConfig reads/writes terminal.app SystemConfig key via getConfigValue/setConfigValue

## Task Commits

1. **Task 1: PreviewPanel component** - `dfefe1c` (feat)
2. **Task 2: Project type selector + terminal settings** - `b459e19` (feat)

## Files Created/Modified

- `src/components/task/preview-panel.tsx` — PreviewPanel "use client" component; exports PreviewPanel + PreviewPanelProps
- `src/components/layout/top-bar.tsx` — Added projectType state, segmented control in dialog, projectType in onCreateProject call
- `src/components/settings/general-config.tsx` — Added terminalApp state, useEffect load, onBlur save, terminal input UI

## Decisions Made

- PreviewPanel uses console.error for terminal open errors — no toast library needed for this rare edge case
- refreshKey is parent-controlled; the iframe key={refreshKey} forces re-render when parent increments it (Plan 03 wires this)
- onBlur-persist for command input: updateProject is called when user tabs/clicks away, not on every keystroke — avoids excessive DB writes

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. Pre-existing TypeScript errors in agent-config-actions.ts are unrelated to this plan's changes.

## Known Stubs

- `handleRefresh` in toolbar Refresh button is a stub — refresh logic currently re-sets iframeUrl to itself. Plan 03 will pass a real `onRefresh` callback or the parent will manage refreshKey increments.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- PreviewPanel is ready to drop into task-page-client (Plan 03)
- Plan 03 needs to: import PreviewPanel, pass taskId/worktreePath/previewCommand/refreshKey/projectId props, manage refreshKey increment on editor save
- No blockers

---
*Phase: 23-preview-panel*
*Completed: 2026-03-26*
