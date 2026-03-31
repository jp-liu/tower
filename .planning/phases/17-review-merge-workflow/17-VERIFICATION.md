---
phase: 17-review-merge-workflow
verified: 2026-03-31T14:23:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 17: Review & Merge Workflow Verification Report

**Phase Goal:** After a task execution completes, users can inspect the diff, squash merge to the base branch when satisfied, or send the task back for more work
**Verified:** 2026-03-31T14:23:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Success Criteria from ROADMAP.md)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A completed task transitions to IN_REVIEW status and the task panel shows a diff of changes in the worktree branch vs the base branch | VERIFIED | `stream/route.ts` lines 146-151: `if (result.exitCode === 0) { await db.task.update({ data: { status: "IN_REVIEW" } }) }`. Task panel (`task-page-client.tsx`) auto-fetches `/api/tasks/${task.id}/diff` when `taskStatus === "IN_REVIEW"` |
| 2 | User can trigger a squash merge from the task panel; the worktree branch is squash-merged into the base branch and the task moves to DONE | VERIFIED | `merge/route.ts`: runs `git checkout`, `git merge --squash`, `git commit` sequentially, then `db.task.update({ data: { status: "DONE" } })`. Merge button wired through `TaskDiffView` → `TaskMergeConfirmDialog` → `POST /api/tasks/${taskId}/merge` |
| 3 | Before merging, the system checks for conflicts and shows a warning if any exist — merge is blocked until resolved | VERIFIED | `merge/route.ts` calls `checkConflicts()` before git commands; returns 409 on conflicts. `TaskDiffView` disables merge button when `hasConflicts` is true and shows `AlertTriangle` warning with conflict file list |
| 4 | User can click "Send Back" on an IN_REVIEW task; the task returns to IN_PROGRESS with a new TaskExecution record pointing to the same worktree and branch | VERIFIED | `stream/route.ts` lines 181-208: checks `task.status === "IN_REVIEW"`, transitions to `IN_PROGRESS`, then creates a new `TaskExecution` record via `db.taskExecution.create(...)` |
| 5 | After send-back, a subsequent execution resumes in the same task/{taskId} worktree without re-creating it | VERIFIED | `worktree.ts` lines 38-43: `createWorktree` checks if worktree already exists via `git worktree list --porcelain` and returns the same path if found. If branch exists but worktree is removed, re-attaches the existing branch without `-b` flag |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/diff-parser.ts` | Git diff parsing utility | VERIFIED | Exports `parseDiffOutput`, `checkConflicts`, `DiffFile`, `DiffResponse`. Handles binary files, 500KB truncation, and conflict detection via `git merge-tree --write-tree` |
| `src/app/api/tasks/[taskId]/diff/route.ts` | Diff API GET endpoint | VERIFIED | Returns `{ files, totalAdded, totalRemoved, hasConflicts, conflictFiles, commitCount }`. Uses Zod cuid validation, `parseDiffOutput`, `checkConflicts` |
| `src/app/api/tasks/[taskId]/merge/route.ts` | Merge API POST endpoint | VERIFIED | Guards on `IN_REVIEW` status, conflict pre-check, squash merge sequence, sets `DONE`, calls `revalidatePath` |
| `src/app/api/tasks/[taskId]/stream/route.ts` | Modified stream route | VERIFIED | IN_REVIEW auto-transition in `persistResult`, send-back transition, `status_changed` SSE event |
| `src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx` | Task detail page server component | VERIFIED | Queries `db.task.findUnique`, validates workspace ownership, renders `TaskPageClient` with serialized task |
| `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` | Task page client layout | VERIFIED | Split 40/60 layout, chat panel with SSE streaming, diff auto-fetch on IN_REVIEW, `status_changed` handler calls `router.refresh()` |
| `src/components/task/task-diff-view.tsx` | Per-file collapsible diff blocks | VERIFIED | Collapsible files with `+/-` counts, green/red line highlighting, conflict warning, merge button gated on `taskStatus === "IN_REVIEW"` and `!hasConflicts` |
| `src/components/task/task-merge-confirm-dialog.tsx` | Merge confirmation dialog | VERIFIED | Shows target branch, file count, commit count, `feat: ${taskTitle}` commit message, POSTs to `/api/tasks/${taskId}/merge`, handles 409 conflicts |
| `src/components/task/task-detail-panel.tsx` | Enhanced drawer | VERIFIED | `workspaceId` prop added, Conversation/Changes tab switcher, View Details button navigating to task page, diff fetch in Changes tab, `status_changed` SSE handling |
| `src/lib/i18n.tsx` | i18n keys for phase 17 | VERIFIED | `taskPage.*`, `diff.*`, `merge.*` sections added in both `zh` and `en` objects |
| `tests/unit/api/stream-persist-result.test.ts` | Test stub | VERIFIED | Contains `describe` block with 3 `it.todo` cases, passes vitest |
| `tests/unit/api/diff-route.test.ts` | Test stub | VERIFIED | Contains `describe` block with 5 `it.todo` cases, passes vitest |
| `tests/unit/api/merge-route.test.ts` | Test stub | VERIFIED | Contains `describe` block with 5 `it.todo` cases, passes vitest |
| `tests/unit/api/stream-send-back.test.ts` | Test stub | VERIFIED | Contains `describe` block with 3 `it.todo` cases, passes vitest |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `stream/route.ts` | `db.task.update` | `persistResult` sets `IN_REVIEW` on exitCode 0 | WIRED | Line 147: `data: { status: "IN_REVIEW" }` inside `if (result.exitCode === 0)` |
| `stream/route.ts` | `db.task.update` | send-back transitions `IN_REVIEW` to `IN_PROGRESS` | WIRED | Line 181-186: `if (task.status === "IN_REVIEW") { await db.task.update({ data: { status: "IN_PROGRESS" } }) }` |
| `diff/route.ts` | `diff-parser.ts` | `import parseDiffOutput` | WIRED | Line 5: `import { parseDiffOutput, checkConflicts } from "@/lib/diff-parser"` |
| `merge/route.ts` | `git merge --squash` | `execSync` in main repo | WIRED | Lines 79-88: `git checkout`, `git merge --squash`, `git commit` sequential executions |
| `task-page-client.tsx` | `/api/tasks/{taskId}/diff` | fetch in `useEffect` when `taskStatus === "IN_REVIEW"` | WIRED | Lines 104-122: `useEffect` on `taskStatus` change, fetches diff when status is `IN_REVIEW` |
| `task-page-client.tsx` | `/api/tasks/{taskId}/stream` | fetch POST for send-back messages | WIRED | Line 151: `fetch(\`/api/tasks/${task.id}/stream\`, { method: "POST" })` |
| `task-diff-view.tsx` | `task-merge-confirm-dialog.tsx` | state toggle on Merge button click | WIRED | Line 71: `onClick={() => setShowMergeDialog(true)}`, dialog rendered at line 173 |
| `task-merge-confirm-dialog.tsx` | `/api/tasks/{taskId}/merge` | fetch POST on confirm | WIRED | Line 44: `fetch(\`/api/tasks/${taskId}/merge\`, { method: "POST" })` |
| `task-detail-panel.tsx` | `/workspaces/${workspaceId}/tasks/${task.id}` | `router.push` on View Details click | WIRED | Line 247: `onClick={() => router.push(\`/workspaces/${workspaceId}/tasks/${task.id}\`)}` |
| `task-detail-panel.tsx` | `/api/tasks/${task.id}/diff` | fetch in Changes tab | WIRED | Line 81: `fetch(\`/api/tasks/${task.id}/diff\`)` inside `useEffect` |
| `board-page-client.tsx` | `TaskDetailPanel` | passes `workspaceId` prop | WIRED | Line 192: `workspaceId={workspaceId}` confirmed in rendered `<TaskDetailPanel>` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `task-page-client.tsx` | `diffData` | `fetch(/api/tasks/${task.id}/diff)` in `useEffect` | Yes — diff route runs `git diff --numstat` and `git diff --unified=3` against real repo | FLOWING |
| `diff/route.ts` | response body | `parseDiffOutput(numstat, unified)` + `checkConflicts()` | Yes — `execSync` git commands on `task.project.localPath` | FLOWING |
| `merge/route.ts` | side effect | `execSync` git commands + `db.task.update` | Yes — performs actual git squash merge | FLOWING |
| `task-detail-panel.tsx` | `diffData` | `fetch(/api/tasks/${task.id}/diff)` when Changes tab active + IN_REVIEW | Yes — same real diff endpoint | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Test stubs pass vitest | `npx vitest run tests/unit/api/*.test.ts --passWithNoTests` | 4 files skipped, 16 todo tests | PASS |
| TypeScript in phase 17 files compiles | `npx tsc --noEmit 2>&1 \| grep "src/app/api/tasks\|src/lib/diff-parser\|src/components/task/task-diff\|src/components/task/task-merge\|src/app/workspaces.*tasks"` | No output (no errors in phase 17 files) | PASS |
| Pre-existing TS errors are NOT in phase 17 files | `npx tsc --noEmit 2>&1 \| grep "^src/" \| sort -u` | Only `src/actions/agent-config-actions.ts` errors (pre-existing, unrelated to phase 17) | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MR-01 | 17-00, 17-01, 17-02, 17-03 | 任务完成后状态变为 IN_REVIEW，用户可在任务面板查看 diff | SATISFIED | `persistResult` auto-transitions to `IN_REVIEW`; diff view in both task page and drawer |
| MR-02 | 17-01, 17-02 | 用户可在任务面板 squash merge worktree 分支到任务的 base branch | SATISFIED | `merge/route.ts` performs `git merge --squash` + `git commit`; UI button wired through dialog |
| MR-03 | 17-01, 17-02 | 合并前自动检测冲突，有冲突时提示用户 | SATISFIED | `checkConflicts()` called in both diff route (for display) and merge route (for blocking); merge button disabled when `hasConflicts` |
| RV-01 | 17-00, 17-01, 17-03 | IN_REVIEW 状态的任务可退回 IN_PROGRESS，Claude 在同一 worktree 继续修改 | SATISFIED | `stream/route.ts` checks `task.status === "IN_REVIEW"` and transitions to `IN_PROGRESS`; `createWorktree` reuses existing worktree |
| RV-02 | 17-01 | 退回重做创建新的 TaskExecution 记录，复用同一 worktree 和分支 | SATISFIED | `db.taskExecution.create(...)` always called after status transition; `createWorktree` returns same path/branch if worktree already exists |

All 5 requirement IDs (MR-01, MR-02, MR-03, RV-01, RV-02) are covered. No orphaned requirements found — REQUIREMENTS.md maps all 5 to Phase 17 and marks them Complete.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `task-detail-panel.tsx` | 34 | `setDiffData(any)` — diffData typed as `any` | Info | Loses type safety for diff response; not a blocker since the shape is correctly consumed |
| `task-detail-panel.tsx` | 284 | `(task as any).baseBranch` — type cast to access baseBranch | Info | `Task` from `@prisma/client` has `baseBranch` field; the cast suggests the type import may not reflect schema additions, but runtime behavior is correct |

No blockers or warnings found. The two Info-level items are type-safety concerns but do not affect runtime behavior or goal achievement.

---

### Human Verification Required

#### 1. End-to-end review workflow

**Test:** On a GIT-type project task, trigger an execution, wait for it to complete, confirm status changes to IN_REVIEW, open the Changes tab, verify the diff loads and displays correctly.
**Expected:** Diff shows per-file collapsible blocks with green/red line highlighting; Merge button visible; conflict warning absent if no conflicts.
**Why human:** Requires a running Next.js dev server with an actual git repository and Claude execution.

#### 2. Squash merge completion

**Test:** With an IN_REVIEW task showing no conflicts, click Merge, confirm in the dialog.
**Expected:** Dialog closes, task status changes to DONE on both the board and task page, git log on base branch shows new squash commit with `feat: {taskTitle}` message.
**Why human:** Requires actual git state and running server.

#### 3. Send-back and worktree reuse

**Test:** Send a message to an IN_REVIEW task (triggering send-back). Confirm task moves to IN_PROGRESS. Confirm the new execution uses the same worktree path as the previous execution.
**Expected:** No new worktree directory created; execution continues in existing `task/{taskId}` branch.
**Why human:** Requires live execution and file system inspection.

#### 4. Conflict detection display

**Test:** Create a scenario where the task branch has a conflicting change vs the base branch. Open the Changes tab.
**Expected:** Red conflict warning appears with conflicting filenames listed; Merge button is disabled.
**Why human:** Requires setting up actual git conflict scenario.

---

## Gaps Summary

No gaps found. All five success criteria are verified through code inspection:

- The IN_REVIEW auto-transition is implemented in `persistResult` and the SSE `status_changed` event propagates the status change to the UI.
- The diff API returns structured JSON with per-file patches, conflict detection, and commit count.
- The merge API performs a real squash merge sequence with a pre-flight conflict check that blocks on 409.
- The send-back flow correctly transitions status before creating a new execution record.
- The worktree reuse is deterministic — `createWorktree` returns the same path/branch for the same taskId when the worktree already exists, and re-attaches the existing branch when the worktree was removed but the branch persists.

Pre-existing TypeScript errors in `src/actions/agent-config-actions.ts` are unrelated to phase 17 and were present before this phase.

---

_Verified: 2026-03-31T14:23:00Z_
_Verifier: Claude (gsd-verifier)_
