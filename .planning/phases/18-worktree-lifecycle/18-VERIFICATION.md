---
phase: 18-worktree-lifecycle
verified: 2026-03-31T07:10:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 18: Worktree Lifecycle Verification Report

**Phase Goal:** Worktrees are automatically cleaned up when tasks are closed out, and stale worktrees from previous sessions are pruned at app startup
**Verified:** 2026-03-31T07:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                  | Status     | Evidence                                                                               |
| --- | -------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| 1   | Moving a task to DONE via merge automatically removes its worktree directory and branch | ✓ VERIFIED | `merge/route.ts` calls `removeWorktree(localPath, taskId)` inside try/catch after `db.task.update({ status: "DONE" })` |
| 2   | Cancelling a task automatically removes its worktree directory and branch              | ✓ VERIFIED | `updateTaskStatus` has `if (status === "CANCELLED")` guard calling `removeWorktree` with project localPath |
| 3   | Cancelling a task that was never executed (no worktree) does not throw an error        | ✓ VERIFIED | `removeWorktree` uses `existsSync` guard (D-11) and `git branch --list` guard (D-12) — both skip when absent |
| 4   | Cleanup failure does not block the DONE or CANCELLED status transition                 | ✓ VERIFIED | Both call sites wrap `removeWorktree` in an inner try/catch; status update always completes first |
| 5   | When the Next.js server starts, git worktree prune runs for every GIT-type project with a local path | ✓ VERIFIED | `src/instrumentation.ts` `register()` queries `type: "GIT", localPath: { not: null }` and runs `execSync("git worktree prune", ...)` for each |
| 6   | A prune failure for one project does not prevent other projects from being pruned      | ✓ VERIFIED | Per-project try/catch inside the for-loop in `pruneOrphanedWorktrees()` |
| 7   | A prune failure does not block server startup                                          | ✓ VERIFIED | Top-level try/catch in `pruneOrphanedWorktrees()` catches DB/connection failures; register() always resolves |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact                                              | Expected                             | Status     | Details                                               |
| ----------------------------------------------------- | ------------------------------------ | ---------- | ----------------------------------------------------- |
| `src/lib/worktree.ts`                                 | removeWorktree(localPath, taskId)    | ✓ VERIFIED | Exported function with existsSync guard, --force flag, branch --list check |
| `src/app/api/tasks/[taskId]/merge/route.ts`           | Worktree cleanup after squash merge  | ✓ VERIFIED | Imports `removeWorktree`, calls it post-DONE inside try/catch |
| `src/actions/task-actions.ts`                         | Worktree cleanup on CANCELLED transition | ✓ VERIFIED | Imports `removeWorktree`, gates on `status === "CANCELLED"`, checks localPath |
| `src/instrumentation.ts`                             | Next.js startup hook for worktree pruning | ✓ VERIFIED | Exports `register()`, NEXT_RUNTIME guard, initDb(), per-project prune loop |
| `tests/unit/lib/worktree.test.ts`                     | Unit tests for removeWorktree        | ✓ VERIFIED | 4 test cases in `describe("removeWorktree", ...)`, all passing |
| `tests/unit/actions/task-actions.test.ts`             | Unit tests for CANCELLED cleanup     | ✓ VERIFIED | 3 test cases in `describe("updateTaskStatus CANCELLED cleanup", ...)`, all passing |
| `tests/unit/lib/instrumentation.test.ts`             | Unit tests for startup prune logic   | ✓ VERIFIED | 5 test cases in `describe("register", ...)`, all passing |

### Key Link Verification

| From                                          | To                    | Via                               | Status     | Details                                                       |
| --------------------------------------------- | --------------------- | --------------------------------- | ---------- | ------------------------------------------------------------- |
| `src/app/api/tasks/[taskId]/merge/route.ts`   | `src/lib/worktree.ts` | `import { removeWorktree }`       | ✓ WIRED    | Line 7: `import { removeWorktree } from "@/lib/worktree"` + line 99: `await removeWorktree(localPath, taskId)` |
| `src/actions/task-actions.ts`                 | `src/lib/worktree.ts` | `import { removeWorktree }`       | ✓ WIRED    | Line 6: `import { removeWorktree } from "@/lib/worktree"` + line 53: `await removeWorktree(taskWithProject.project.localPath, taskId)` |
| `src/instrumentation.ts`                     | `src/lib/db.ts`       | `import { initDb, db }`           | ✓ WIRED    | Line 9: `const { initDb, db } = await import("@/lib/db")` + lines 12, 15: `await initDb()`, `db.project.findMany(...)` |
| `src/instrumentation.ts`                     | `child_process`       | `execSync`                        | ✓ WIRED    | Line 8: `const { execSync } = await import("child_process")` + line 26: `execSync("git worktree prune", ...)` |

### Data-Flow Trace (Level 4)

Not applicable — these are server-side lifecycle hooks and git CLI wrappers, not components that render dynamic data.

### Behavioral Spot-Checks

| Behavior                                    | Command                                                                                        | Result                             | Status  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------- | ------- |
| removeWorktree exported from worktree.ts    | `grep -n "export async function removeWorktree" src/lib/worktree.ts`                          | Line 85: function found            | ✓ PASS  |
| merge route imports and calls removeWorktree | `grep -n "removeWorktree" src/app/api/tasks/\\[taskId\\]/merge/route.ts`                      | Lines 7, 99: import + call found   | ✓ PASS  |
| updateTaskStatus CANCELLED gate             | `grep -n "CANCELLED" src/actions/task-actions.ts`                                             | Line 45: `if (status === "CANCELLED")` found | ✓ PASS  |
| instrumentation register() exported        | `grep -n "export async function register" src/instrumentation.ts`                             | Line 1: function found             | ✓ PASS  |
| worktree.test.ts removeWorktree tests pass  | `npx vitest run tests/unit/lib/worktree.test.ts`                                              | 8/8 passed                         | ✓ PASS  |
| instrumentation.test.ts tests pass         | `npx vitest run tests/unit/lib/instrumentation.test.ts`                                       | 5/5 passed                         | ✓ PASS  |
| task-actions.test.ts CANCELLED tests pass   | `npx vitest run tests/unit/actions/task-actions.test.ts`                                      | 6/6 passed                         | ✓ PASS  |

### Requirements Coverage

| Requirement | Source Plan | Description                                      | Status      | Evidence                                         |
| ----------- | ----------- | ------------------------------------------------ | ----------- | ------------------------------------------------ |
| LC-01       | 18-01-PLAN  | 任务 DONE 或 CANCELLED 后自动清理 worktree 目录和分支 | ✓ SATISFIED | `removeWorktree` wired into merge route (DONE) and `updateTaskStatus` (CANCELLED) with existsSync/branch-list guards |
| LC-02       | 18-02-PLAN  | 应用启动时执行 `git worktree prune` 清理孤立 worktree | ✓ SATISFIED | `src/instrumentation.ts` register() queries all GIT projects and runs `git worktree prune` per project at startup |

No orphaned requirements found. Both LC-01 and LC-02 are mapped to Phase 18 in the traceability table and both are fully implemented.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | None found | — | — |

No placeholder implementations, empty returns, or hardcoded stubs were detected in any phase 18 files. The `console.error` calls at both cleanup call sites are intentional best-effort logging per the plan (D-05), not dead implementations.

### Human Verification Required

None. All behaviors are verifiable programmatically: the logic is pure git CLI invocations and DB queries with deterministic control flow. No UI interactions, real-time behavior, or external service integrations introduced in this phase.

### Gaps Summary

No gaps. All 7 observable truths are verified. All 7 artifacts exist, are substantive, and are wired. Both requirements LC-01 and LC-02 are fully satisfied. All 19 targeted unit tests pass (8 worktree + 6 task-actions + 5 instrumentation). Commits 72bdb87, 7519e8e, and 5bb3057 exist in git history.

The pre-existing test failures (board-stats.test.tsx and prompts-config.test.tsx) are unrelated to phase 18 — they existed before this phase and are due to missing Next.js router context in those component tests.

---

_Verified: 2026-03-31T07:10:00Z_
_Verifier: Claude (gsd-verifier)_
