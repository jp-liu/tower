---
phase: 19-workbench-entry-layout
plan: "01"
subsystem: ui
tags: [react-resizable-panels, i18n, task-detail-panel, navigation]

# Dependency graph
requires:
  - phase: 18-worktree-lifecycle
    provides: worktreeId passed from BoardPageClient into TaskDetailPanel for navigation
provides:
  - react-resizable-panels@^2.1.9 installed (v2.x API with Panel/PanelGroup/PanelResizeHandle)
  - 6 new taskPage.* i18n keys in zh and en locales (tabFiles, tabPreview, filesPlaceholder, previewPlaceholder, comingSoon, comingSoonPhase23)
  - Confirmed 查看详情 button navigates to /workspaces/[workspaceId]/tasks/[taskId] via router.push()
affects:
  - 19-02 (layout refactor uses react-resizable-panels and i18n keys added here)
  - Phase 20-23 (tab labels and placeholder text available for all workbench phases)

# Tech tracking
tech-stack:
  added: [react-resizable-panels@^2.1.9]
  patterns: [v2.x API exports Panel/PanelGroup/PanelResizeHandle — NOT ResizablePanel/ResizablePanelGroup]

key-files:
  created: []
  modified:
    - package.json
    - pnpm-lock.yaml
    - src/lib/i18n.tsx

key-decisions:
  - "react-resizable-panels v2.1.9 pinned at ^2.x — v4.x has breaking API changes (shadcn wrapper names)"
  - "查看详情 button already correctly wired — no code change needed in task-detail-panel.tsx"

patterns-established:
  - "taskPage.comingSoon/comingSoonPhase23 pattern: use phase-specific coming-soon keys for placeholder panels"

requirements-completed: [WB-01]

# Metrics
duration: 8min
completed: 2026-03-31
---

# Phase 19 Plan 01: Dependency and i18n Foundation Summary

**react-resizable-panels v2.1.9 installed and 12 workbench i18n entries added; 查看详情 navigation confirmed correct**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-31T10:04:53Z
- **Completed:** 2026-03-31T10:12:00Z
- **Tasks:** 2
- **Files modified:** 3 (package.json, pnpm-lock.yaml, src/lib/i18n.tsx)

## Accomplishments
- Installed react-resizable-panels@^2.1.9 (v2.x, not v4.x — correct API surface for Plan 02)
- Added 6 new i18n keys × 2 locales = 12 entries to i18n.tsx after taskPage.loadingDiff in both zh and en blocks
- Confirmed 查看详情 button in task-detail-panel.tsx already meets all WB-01 criteria: ExternalLink icon, correct route, viewDetails i18n key, muted-foreground hover styling, placement in tab bar row

## Task Commits

1. **Task 1: Install react-resizable-panels and add i18n keys** - `fe75293` (feat)
2. **Task 2: Verify 查看详情 button** - no commit needed (button already correct, no code changes)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `package.json` - Added react-resizable-panels@^2.1.9 dependency
- `pnpm-lock.yaml` - Updated lockfile with new dependency
- `src/lib/i18n.tsx` - Added taskPage.tabFiles, tabPreview, filesPlaceholder, previewPlaceholder, comingSoon, comingSoonPhase23 in both zh and en locales

## Decisions Made
- react-resizable-panels v2.x pinned intentionally — v4.x wraps with different names (ResizablePanel/ResizablePanelGroup) and has breaking API; Plan 02 uses v2 API directly
- 查看详情 button required no changes — all 5 WB-01 criteria were already satisfied by Phase 17 implementation

## Deviations from Plan

None - plan executed exactly as written. Task 2 was a verification task with no code changes needed (button was already correct).

## Issues Encountered

- Pre-existing test failures in board-stats.test.tsx and prompts-config.test.tsx (11 failures, 2 test files). These are out-of-scope pre-existing issues — confirmed by running tests before any changes. Not introduced by this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- react-resizable-panels v2.1.9 is installed and ready for Plan 02's layout refactor
- i18n keys for all workbench tab labels and placeholders are available
- 查看详情 navigation entry point is confirmed working
- No blockers for Plan 02

---
*Phase: 19-workbench-entry-layout*
*Completed: 2026-03-31*
