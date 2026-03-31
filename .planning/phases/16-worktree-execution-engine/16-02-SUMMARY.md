---
phase: 16
plan: 02
subsystem: board-ui
tags: [branch-selector, create-task-dialog, git, i18n, tdd]
dependency_graph:
  requires: [16-01]
  provides: [BR-01]
  affects: [create-task-dialog, board-page-client, i18n]
tech_stack:
  added: []
  patterns: [server-action-in-useEffect, conditional-ui-by-project-type]
key_files:
  created:
    - tests/unit/components/create-task-dialog.test.tsx
  modified:
    - src/components/board/create-task-dialog.tsx
    - src/app/workspaces/[workspaceId]/board-page-client.tsx
    - src/lib/i18n.tsx
    - .planning/phases/16-worktree-execution-engine/16-VALIDATION.md
decisions:
  - "Use native <select> element for branch selector (not shadcn Select) — avoids @base-ui/react/select complexity in jsdom tests"
  - "vi.clearAllMocks() in afterEach (not vi.restoreAllMocks()) — preserves vi.mock module mocks while clearing call history"
metrics:
  duration: ~8min
  completed: 2026-03-31
  tasks_completed: 2
  files_modified: 5
requirements: [BR-01]
---

# Phase 16 Plan 02: Base Branch Selector in Create Task Dialog Summary

**One-liner:** Branch selector UI wired to getProjectBranches server action for GIT projects, baseBranch flows through onSubmit to createTask DB storage.

## What Was Built

Added a base branch selector to the create-task dialog for GIT-type projects. When a user opens the create task dialog for a project with `type === "GIT"` and a non-null `localPath`, the dialog fetches available git branches via `getProjectBranches(localPath)` and renders a native `<select>` element showing all local branches. The first branch is selected by default. The selected `baseBranch` is included in the `onSubmit` payload and forwarded through `handleCreateTask` to the `createTask` server action where it gets stored on the Task record.

The branch selector is hidden when:
- The project is NORMAL type (no git)
- The project has no localPath
- The dialog is in edit mode (editing an existing task)

A loading indicator is shown while branches are being fetched.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 0 | Create test stubs for branch selector | 25cb8a4 | tests/unit/components/create-task-dialog.test.tsx |
| 1 | Implement branch selector + wire baseBranch | d95bfd8 | create-task-dialog.tsx, board-page-client.tsx, i18n.tsx |

## Decisions Made

1. **Native `<select>` over shadcn Select component**: The shadcn Select uses `@base-ui/react/select` which has complex portal/positioner rendering that is difficult to test in jsdom. A native `<select>` element styled with Tailwind achieves the same visual result and is straightforward to test with `screen.getByText` and `fireEvent.change`.

2. **`vi.clearAllMocks()` in afterEach**: Using `vi.restoreAllMocks()` caused test isolation issues because it restores original implementations but the `vi.mock` call count persists. `vi.clearAllMocks()` clears call counts and return values while keeping the module mock intact, combined with `beforeEach` re-setting the mock resolved value.

3. **`baseBranch` omitted when no branch selected**: If `getProjectBranches` returns an empty array and `selectedBranch` is empty string, `baseBranch` is not included in the submit payload (falsy check `&& selectedBranch`). This prevents storing an empty string as baseBranch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.restoreAllMocks → vi.clearAllMocks for test isolation**
- **Found during:** Task 0 verification (test execution)
- **Issue:** Test 4 (edit mode) was failing because `vi.restoreAllMocks()` doesn't clear mock call history on `vi.mock` module mocks, causing accumulated call counts across tests
- **Fix:** Changed to `vi.clearAllMocks()` in afterEach to clear call history while preserving the module mock
- **Files modified:** tests/unit/components/create-task-dialog.test.tsx
- **Commit:** d95bfd8 (included in Task 1 commit)

## Verification

All acceptance criteria confirmed:

```
✓ grep "getProjectBranches" src/components/board/create-task-dialog.tsx
✓ grep "projectType" src/components/board/create-task-dialog.tsx
✓ grep "baseBranch" src/app/workspaces/[workspaceId]/board-page-client.tsx
✓ grep "projectType={project.type}" src/app/workspaces/[workspaceId]/board-page-client.tsx
✓ grep "task.baseBranch" src/lib/i18n.tsx (both zh and en locales)
✓ 4/4 tests pass in create-task-dialog.test.tsx
```

## Known Stubs

None — branch selector is fully wired to `getProjectBranches` server action and `baseBranch` flows to DB storage via `createTask`.

## Self-Check: PASSED
