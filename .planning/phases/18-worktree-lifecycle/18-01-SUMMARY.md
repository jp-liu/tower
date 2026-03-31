---
phase: 18-worktree-lifecycle
plan: "01"
subsystem: worktree-lifecycle
tags: [worktree, git, cleanup, task-lifecycle]
dependency_graph:
  requires: []
  provides: [removeWorktree, worktree-cleanup-on-done, worktree-cleanup-on-cancelled]
  affects: [src/lib/worktree.ts, src/app/api/tasks/[taskId]/merge/route.ts, src/actions/task-actions.ts]
tech_stack:
  added: []
  patterns: [best-effort-cleanup, existsSync-guard, try-catch-log]
key_files:
  created: []
  modified:
    - src/lib/worktree.ts
    - src/app/api/tasks/[taskId]/merge/route.ts
    - src/actions/task-actions.ts
    - tests/unit/lib/worktree.test.ts
    - tests/unit/actions/task-actions.test.ts
decisions:
  - "removeWorktree uses existsSync guard before git worktree remove (D-11)"
  - "removeWorktree uses git branch --list check before git branch -D (D-12)"
  - "Best-effort pattern: cleanup failure never blocks DONE/CANCELLED transition (D-05)"
  - "CANCELLED cleanup only runs extra DB query when status === CANCELLED (Pitfall 2 avoidance)"
  - "NORMAL projects (localPath=null) skip cleanup silently with no error"
metrics:
  duration: 290s
  completed_date: "2026-03-31"
  tasks_completed: 2
  files_changed: 5
---

# Phase 18 Plan 01: Worktree Lifecycle Cleanup Summary

**One-liner:** `removeWorktree(localPath, taskId)` wired into merge route (DONE) and updateTaskStatus (CANCELLED) with existsSync/branch-list guards and best-effort error handling.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement removeWorktree and add unit tests | 72bdb87 | src/lib/worktree.ts, tests/unit/lib/worktree.test.ts |
| 2 | Wire removeWorktree into merge route and updateTaskStatus | 7519e8e | src/app/api/tasks/[taskId]/merge/route.ts, src/actions/task-actions.ts, tests/unit/actions/task-actions.test.ts |

## What Was Built

### removeWorktree function (`src/lib/worktree.ts`)

- Added `import { existsSync } from "fs"` to existing imports
- Exported `removeWorktree(localPath, taskId): Promise<void>` that:
  - Derives `worktreePath` and `worktreeBranch` same as `createWorktree`
  - Guards `git worktree remove --force` behind `existsSync(worktreePath)` check (D-11)
  - Guards `git branch -D` behind `git branch --list` non-empty result check (D-12)
  - Uses 30s timeout for worktree remove, 5s for branch operations (consistent with createWorktree)

### Merge route wiring (`src/app/api/tasks/[taskId]/merge/route.ts`)

- Added `import { removeWorktree } from "@/lib/worktree"`
- Added best-effort cleanup after `db.task.update({ status: "DONE" })` in a nested try/catch
- Cleanup failure logs to `console.error("[merge] Worktree cleanup failed:", error)` and does NOT rethrow
- `localPath` and `taskId` were already in scope

### updateTaskStatus wiring (`src/actions/task-actions.ts`)

- Added `import { removeWorktree } from "@/lib/worktree"`
- Extended `updateTaskStatus` to run cleanup only when `status === "CANCELLED"`
- Extra `db.task.findUnique({ include: { project: true } })` only runs on CANCELLED path (not all transitions)
- Skips cleanup silently when `project.localPath` is null (NORMAL projects)
- Failure caught and logged; `revalidatePath` and return always execute

## Test Coverage

**worktree.test.ts — removeWorktree describe block (4 new tests):**
- Both dir and branch exist: removes both
- Dir missing, branch exists: skips worktree remove, still deletes branch
- Dir exists, branch missing: removes dir, skips branch delete
- Neither exists: no-op (only branch --list called)

**task-actions.test.ts — updateTaskStatus CANCELLED cleanup (3 new tests):**
- GIT project with localPath: calls removeWorktree with correct args
- NORMAL project (no localPath): removeWorktree never called
- removeWorktree throws: updateTaskStatus resolves without error (D-05)

**Total: 14 tests passing (8 worktree + 6 task-actions)**

## Decisions Made

1. **existsSync guard before worktree remove** — Prevents git error when worktree was already manually deleted; matches D-11 specification
2. **git branch --list check before branch delete** — Prevents error when branch was already deleted; matches D-12 specification
3. **Best-effort cleanup (try/catch at both call sites)** — Status transitions always succeed even if cleanup fails; matches D-05
4. **Extra DB query gated on CANCELLED** — Non-CANCELLED transitions (TODO, IN_PROGRESS, IN_REVIEW, DONE from merge) incur no overhead
5. **NORMAL projects silently skipped** — localPath null check ensures git ops are never attempted on non-git projects

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

Files created/modified:
- FOUND: src/lib/worktree.ts (removeWorktree exported)
- FOUND: src/app/api/tasks/[taskId]/merge/route.ts (removeWorktree import + try/catch)
- FOUND: src/actions/task-actions.ts (removeWorktree import + CANCELLED gate)
- FOUND: tests/unit/lib/worktree.test.ts (removeWorktree describe block with 4 tests)
- FOUND: tests/unit/actions/task-actions.test.ts (CANCELLED cleanup describe block with 3 tests)

Commits:
- FOUND: 72bdb87 (feat(18-01): implement removeWorktree with edge-case handling)
- FOUND: 7519e8e (feat(18-01): wire removeWorktree into merge route and updateTaskStatus)

Tests: 14/14 passing
