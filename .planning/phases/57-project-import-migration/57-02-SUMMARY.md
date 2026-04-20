---
phase: 57-project-import-migration
plan: 02
subsystem: ui
tags: [migration, fs-rename, server-actions, i18n]

requires:
  - phase: 57-01
    provides: "import dialog with git detection, resolveGitLocalPath action"
provides:
  - "migrateProjectPath server action with pre-flight safety checks"
  - "checkMigrationSafety exported function for UI pre-check"
  - "Migration toggle UI in import-project-dialog"
  - "i18n keys for migration flow (zh/en)"
affects: [project-import, workspace-layout]

tech-stack:
  added: []
  patterns: ["two-step create-then-migrate flow", "pre-flight safety check pattern"]

key-files:
  created:
    - src/actions/project-actions.ts
  modified:
    - src/components/project/import-project-dialog.tsx
    - src/components/project/create-project-dialog.tsx
    - src/components/layout/layout-client.tsx
    - src/components/layout/top-bar.tsx
    - src/lib/i18n/zh.ts
    - src/lib/i18n/en.ts

key-decisions:
  - "Two-step flow: create project first, then migrate — avoids complex rollback"
  - "checkMigrationSafety as separate export for lightweight pre-check without performing rename"
  - "onCreateProject returns { id } to enable migration flow after project creation"

patterns-established:
  - "Pre-flight safety pattern: separate check function + inline warnings before destructive action"

requirements-completed: [PROJ-03, PROJ-04, PROJ-05, PROJ-06]

duration: 5min
completed: 2026-04-20
---

# Phase 57 Plan 02: Project Migration Toggle Summary

**Atomic directory migration via fs.rename with 3 pre-flight safety checks (running executions, PTY sessions, worktrees) and editable target path derived from git URL rules**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-20T16:20:34Z
- **Completed:** 2026-04-20T16:25:14Z
- **Tasks:** 2/2
- **Files modified:** 7

## Accomplishments

### Task 1: migrateProjectPath server action
- Created `src/actions/project-actions.ts` with "use server" directive
- `migrateProjectPath` performs 3 pre-flight checks: running executions (DB query), active PTY sessions (getSession), worktrees (.worktrees dir)
- Uses `fs.rename` for atomic move, handles EXDEV explicitly
- Updates project.localPath in DB after successful rename
- `checkMigrationSafety` exported separately for UI pre-check without side effects
- Commit: 2f4416a

### Task 2: Migration toggle UI in import dialog
- Added migration toggle (checkbox) that only appears when git remote is detected
- Target path auto-derived from `resolveGitLocalPath`, shown in editable mono input
- Same-path detection shows info message, disables migration
- Safety warning and error display inline (amber/rose)
- Updated `onCreateProject` prop to return `{ id: string }` across TopBar, LayoutClient, CreateProjectDialog
- Added 8 i18n keys in both zh.ts and en.ts
- Commit: bc4f8a7

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated CreateProjectDialog prop type**
- **Found during:** Task 2
- **Issue:** TopBar passes the same callback to both CreateProjectDialog and ImportProjectDialog; changing the return type of the callback caused a type error in CreateProjectDialog
- **Fix:** Updated CreateProjectDialog's `onCreateProject` prop type to accept the broader return type
- **Files modified:** src/components/project/create-project-dialog.tsx

## Known Stubs

None - all data flows are wired to real server actions.

## Verification

- TypeScript compiles with no new errors (pre-existing test mock type issues unrelated)
- Migration toggle only visible when gitDetected is true
- Pre-flight checks block migration with Chinese error messages
- EXDEV error returns cross-device migration error

## Self-Check: PASSED
