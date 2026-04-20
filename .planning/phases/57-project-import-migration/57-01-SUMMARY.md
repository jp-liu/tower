---
phase: 57-project-import-migration
plan: 01
subsystem: ui
tags: [dialog, i18n, git-url, folder-browser, react]

requires:
  - phase: none
    provides: existing top-bar.tsx with inline create project dialog
provides:
  - CreateProjectDialog component (git URL-first project creation)
  - ImportProjectDialog component (folder browse-first project import)
  - Two distinct entry points in TopBar
affects: [57-02 migration plan may reference these dialogs]

tech-stack:
  added: []
  patterns: [extracted dialog components with shared CreateProjectData interface]

key-files:
  created:
    - src/components/project/create-project-dialog.tsx
    - src/components/project/import-project-dialog.tsx
  modified:
    - src/components/layout/top-bar.tsx
    - src/lib/i18n/zh.ts
    - src/lib/i18n/en.ts

key-decisions:
  - "CreateProjectDialog auto-derives project name from parseGitUrl pathSegments"
  - "ImportProjectDialog uses regex on remoteUrl to extract repo name as fallback"

patterns-established:
  - "Dialog extraction pattern: move inline dialog to separate component with open/onOpenChange/onAction props"

requirements-completed: [PROJ-01, PROJ-02]

duration: 3min
completed: 2026-04-20
---

# Phase 57 Plan 01: Project Import Migration Summary

**Split monolithic project creation dialog into two flows: git URL-first (create) and folder browse-first (import) with auto-detection**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-20T16:15:01Z
- **Completed:** 2026-04-20T16:18:46Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created CreateProjectDialog with git URL auto-resolve, clone button, and auto-derived project name
- Created ImportProjectDialog with folder browser, git remote auto-detection, and auto-filled fields
- Refactored TopBar from 358 lines to 130 lines by extracting dialogs
- Added 3 i18n keys (topbar.importProject, project.importHint, project.autoDetected) in both zh/en

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the two dialog components** - `dcb96fa` (feat)
2. **Task 2: Wire dialogs into TopBar with two buttons** - `e82b4ff` (refactor)

## Files Created/Modified
- `src/components/project/create-project-dialog.tsx` - Git URL-first project creation dialog with clone support
- `src/components/project/import-project-dialog.tsx` - Folder browse-first project import with git auto-detection
- `src/components/layout/top-bar.tsx` - Simplified to two button + two dialog render
- `src/lib/i18n/zh.ts` - Added 3 Chinese i18n keys
- `src/lib/i18n/en.ts` - Added 3 English i18n keys

## Decisions Made
- CreateProjectDialog auto-derives project name from git URL using parseGitUrl (last path segment)
- ImportProjectDialog uses regex on remote URL for repo name extraction as fallback to folder basename
- Import button uses outline variant to visually distinguish from primary "New Project" button

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Dialog components ready for use
- Phase 57 Plan 02 (migration to git-standard paths) can proceed independently

---
*Phase: 57-project-import-migration*
*Completed: 2026-04-20*
