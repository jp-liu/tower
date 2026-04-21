---
phase: 63-mission-terminal-open
plan: 01
subsystem: ui
tags: [missions, terminal, i18n, lucide, sonner]

# Dependency graph
requires:
  - phase: 35-mission-control
    provides: MissionCard component with ActiveExecutionInfo type
  - phase: 23-preview-panel
    provides: openInTerminal server action in preview-actions.ts
provides:
  - TerminalSquare button in MissionCard header toolbar (conditional on projectLocalPath)
  - i18n keys missions.openInTerminal in zh.ts and en.ts
affects: [missions, mission-card]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - base-ui render prop pattern for TooltipTrigger (render=<Button/>) confirmed
    - Conditional toolbar button gated on nullable field (projectLocalPath)

key-files:
  created: []
  modified:
    - src/components/missions/mission-card.tsx
    - src/lib/i18n/zh.ts
    - src/lib/i18n/en.ts

key-decisions:
  - "Reused existing openInTerminal server action from preview-actions.ts — no new backend code needed"
  - "Button renders only when execution.projectLocalPath is truthy — null/empty projects get no button"
  - "Error handling uses existing preview.terminalError i18n key for consistency"

patterns-established:
  - "Conditional toolbar button: {field && (<Tooltip>...</Tooltip>)} gated on nullable ActiveExecutionInfo field"

requirements-completed:
  - MISSION-01

# Metrics
duration: 3min
completed: 2026-04-21
---

# Phase 63 Plan 01: Mission Terminal Open Summary

**TerminalSquare toolbar button in MissionCard opens system terminal at project localPath via existing openInTerminal server action**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-21T06:39:02Z
- **Completed:** 2026-04-21T06:41:13Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- Added "在终端打开" button to Mission Control card header toolbar
- Button only renders when `execution.projectLocalPath` is non-null (correct guard)
- Reused `openInTerminal` server action from `preview-actions.ts` — zero new backend code
- Wired error handling to Sonner toast with existing `preview.terminalError` i18n key
- Added bilingual i18n keys (`missions.openInTerminal`) in both zh.ts and en.ts

## Task Commits

1. **Task 1: Add "在终端打开" button to MissionCard toolbar** - `eeea3c2` (feat)

## Files Created/Modified

- `src/components/missions/mission-card.tsx` - Added TerminalSquare import, openInTerminal import, toast import, handleOpenInTerminal handler, and conditional toolbar button
- `src/lib/i18n/zh.ts` - Added `missions.openInTerminal: "在终端打开"`
- `src/lib/i18n/en.ts` - Added `missions.openInTerminal: "Open in Terminal"`

## Decisions Made

- Reused existing `openInTerminal` server action from `preview-actions.ts` — no new backend code required.
- Button placement: before "Open full view" (ArrowUpRight) button in toolbar order.
- Error toast reuses `preview.terminalError` key for consistency (same error message path as workbench preview panel).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 63 (MISSION-01) complete. Mission Control cards now support one-click terminal navigation to project directories.
- Phase 64 (Code Search) is next and requires `rg` (ripgrep) availability check at runtime.

---
*Phase: 63-mission-terminal-open*
*Completed: 2026-04-21*

## Self-Check: PASSED
