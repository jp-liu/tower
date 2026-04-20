---
phase: 16-worktree-execution-engine
plan: "01"
subsystem: worktree-execution
tags: [worktree, git, execution, isolation]
dependency_graph:
  requires: [phase-15-schema-fields]
  provides: [worktree-creation, execution-isolation]
  affects: [stream-route, task-execution-flow]
tech_stack:
  added: []
  patterns: [execSync-with-timeout, TDD-red-green, SSE-error-event]
key_files:
  created:
    - src/lib/worktree.ts
    - tests/unit/lib/worktree.test.ts
  modified:
    - src/app/api/tasks/[taskId]/stream/route.ts
decisions:
  - "createWorktree propagates original git error on failure — no wrapping, per plan step 10"
  - "worktree reuse check uses exact line match 'worktree {path}' from porcelain output"
  - "NORMAL projects and GIT without baseBranch: zero behavior change, cwd stays localPath"
metrics:
  duration: "120s"
  completed_date: "2026-03-31"
  tasks_completed: 2
  files_changed: 3
requirements: [WT-01, WT-02, WT-04]
---

# Phase 16 Plan 01: Worktree Execution Engine Summary

**One-liner:** Git worktree isolation per task using createWorktree() with reuse/branch-exists logic integrated into SSE execution pipeline.

## What Was Built

`src/lib/worktree.ts` — a focused utility that creates an isolated git worktree for each task execution:

- Computes paths: `{localPath}/.worktrees/task-{taskId}/` and branch `task/{taskId}`
- Checks `git worktree list --porcelain` for existing worktree (reuse on re-execution)
- Checks `git branch --list task/{taskId}` to attach existing branch vs. create new with `-b`
- Uses 30s timeout for `git worktree add` (slow disk tolerance)
- Propagates original git error messages unchanged

`src/app/api/tasks/[taskId]/stream/route.ts` — worktree integration before `adapter.execute()`:

- GIT projects with `baseBranch` set: calls `createWorktree()`, updates `TaskExecution.worktreePath/worktreeBranch`, sends SSE `status: "Worktree ready: {branch}"`
- Worktree failure: updates execution to `FAILED`, sends SSE `error` event, closes stream (no silent fallback)
- NORMAL projects or GIT without `baseBranch`: unchanged behavior, `cwd = localPath`

`tests/unit/lib/worktree.test.ts` — 4 unit tests (TDD RED → GREEN):
1. New worktree: creates with `-b` flag, correct mkdir call
2. Reuse: early return when path found in worktree list, no extra git calls
3. Branch exists: attaches without `-b`, preserves previous work
4. Error propagation: throws original git error message

## Commits

| Hash | Message |
|------|---------|
| d9bb965 | test(phase16-01): add failing tests for worktree utility |
| 13caeff | feat(phase16-01): implement createWorktree utility |
| c7010ef | feat(phase16-01): integrate worktree creation into execution pipeline |

## Verification Results

```
Test Files  1 passed (1)
      Tests  4 passed (4)
```

- `createWorktree` appears 2x in stream route (import + usage)
- `cwd: task.project!.localPath!` hardcoded line removed
- `data: { worktreePath, worktreeBranch }` present in db.taskExecution.update

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED
