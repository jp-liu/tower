---
phase: 17-review-merge-workflow
plan: "01"
subsystem: api
tags: [diff, merge, worktree, git, sse, review-workflow]
dependency_graph:
  requires: ["16-worktree-execution-engine"]
  provides: ["diff-api", "merge-api", "in-review-transitions"]
  affects: ["stream-route", "task-status-flow"]
tech_stack:
  added: ["git merge-tree --write-tree conflict detection", "git diff --numstat unified parsing"]
  patterns: ["Zod taskId validation", "SSE status_changed event", "squash merge workflow"]
key_files:
  created:
    - src/lib/diff-parser.ts
    - src/app/api/tasks/[taskId]/diff/route.ts
    - src/app/api/tasks/[taskId]/merge/route.ts
  modified:
    - src/app/api/tasks/[taskId]/stream/route.ts
decisions:
  - "git merge-tree --write-tree used for conflict pre-check (dry-run, no index modification)"
  - "parseDiffOutput truncates individual file patches at 200 lines when total diff >500KB"
  - "status_changed SSE event emitted on exitCode 0 so client can refresh without polling"
  - "send-back: IN_REVIEW→IN_PROGRESS transition happens before TaskExecution creation in stream POST"
metrics:
  duration: "~217s"
  completed_date: "2026-03-31"
  tasks_completed: 2
  files_changed: 4
---

# Phase 17 Plan 01: Backend Diff/Merge API and IN_REVIEW Transitions Summary

Diff parser utility, diff GET API, squash merge POST API, and stream route auto-transitions to/from IN_REVIEW status — providing the server-side foundation for the review-merge workflow.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Diff parser utility and diff API route | a0577e2 | src/lib/diff-parser.ts, src/app/api/tasks/[taskId]/diff/route.ts |
| 2 | Merge API route and stream route modifications | 50c788d | src/app/api/tasks/[taskId]/merge/route.ts, src/app/api/tasks/[taskId]/stream/route.ts |

## What Was Built

### src/lib/diff-parser.ts

Pure utility with no Next.js imports:
- `parseDiffOutput(numstat, unifiedDiff)` — parses `git diff --numstat` and `git diff --unified=3` output into `DiffFile[]` with per-file added/removed/patch/isBinary; truncates patches at 200 lines when total diff exceeds 500KB
- `checkConflicts(localPath, baseBranch, worktreeBranch)` — uses `git merge-tree --write-tree` for a dry-run conflict check without modifying the working tree

### src/app/api/tasks/[taskId]/diff/route.ts

GET handler returning `DiffResponse`:
- Zod `z.string().cuid()` validation on taskId
- Loads latest COMPLETED execution for `worktreeBranch` (fallback `task/{taskId}`)
- Runs `git diff --numstat` and `git diff --unified=3` with `baseBranch...worktreeBranch`
- Returns `{ files, totalAdded, totalRemoved, hasConflicts, conflictFiles, commitCount }`

### src/app/api/tasks/[taskId]/merge/route.ts

POST handler for squash merge:
- Guards: task must be IN_REVIEW, must have baseBranch and localPath
- Pre-merge conflict check via `checkConflicts` — returns 409 with `conflictFiles` if conflicts exist
- Squash merge sequence: `git checkout baseBranch` → `git merge --squash worktreeBranch` → `git commit -m "feat: {title}"`
- Updates task status to DONE, calls `revalidatePath("/workspaces")`

### src/app/api/tasks/[taskId]/stream/route.ts (modified)

Three changes:
1. **persistResult**: After execution update, auto-transitions task to `IN_REVIEW` when `exitCode === 0`
2. **Send-back check**: Before creating TaskExecution, if `task.status === "IN_REVIEW"`, transitions to `IN_PROGRESS`
3. **SSE event**: Emits `{ type: "status_changed", status: "IN_REVIEW" }` after `persistResult` on `exitCode === 0` for client-side refresh

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all functionality is fully wired.

## Self-Check: PASSED

Files exist:
- FOUND: src/lib/diff-parser.ts
- FOUND: src/app/api/tasks/[taskId]/diff/route.ts
- FOUND: src/app/api/tasks/[taskId]/merge/route.ts
- FOUND: src/app/api/tasks/[taskId]/stream/route.ts

Commits exist:
- a0577e2 — feat(17-01): diff parser utility and diff API route
- 50c788d — feat(17-01): merge API route and stream route IN_REVIEW transitions

TypeScript: no new errors introduced (2 pre-existing errors in agent-config-actions.ts unrelated to this plan)
