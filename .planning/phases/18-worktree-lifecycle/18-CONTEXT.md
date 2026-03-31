# Phase 18: Worktree Lifecycle - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Automatic cleanup of worktree directories and task branches when tasks reach terminal states (DONE or CANCELLED), plus a startup prune that clears orphaned worktree entries from previous sessions. No UI changes — this is pure backend lifecycle management.

</domain>

<decisions>
## Implementation Decisions

### Cleanup Trigger Points
- **D-01:** A new `removeWorktree(localPath, taskId)` function in `src/lib/worktree.ts` handles all cleanup (remove worktree directory + delete branch).
- **D-02:** The merge route (`src/app/api/tasks/[taskId]/merge/route.ts`) calls `removeWorktree()` after the squash merge succeeds and status is set to DONE.
- **D-03:** `updateTaskStatus()` in `src/actions/task-actions.ts` calls `removeWorktree()` when transitioning to CANCELLED. Must load the task's project.localPath and execution worktree data to do so.
- **D-04:** For tasks cancelled before any execution (no worktree created), cleanup is a no-op — check for existence before attempting removal.

### Cleanup Failure Handling
- **D-05:** Cleanup failures are logged (`console.error`) but do NOT block the status transition. The task moves to DONE/CANCELLED regardless of whether the worktree was successfully removed.
- **D-06:** Rationale: cleanup is best-effort. The startup prune (LC-02) acts as a safety net for any missed cleanups.

### Startup Prune Mechanism
- **D-07:** Use Next.js `instrumentation.ts` (`register()` export) to run prune logic once at server startup.
- **D-08:** On startup, query all GIT-type projects with non-null `localPath`, then run `git worktree prune` in each project's localPath directory.
- **D-09:** Prune failures for individual projects are logged and skipped — one broken project should not prevent others from being pruned or block server startup.

### Branch Deletion Scope
- **D-10:** Full cleanup: `git worktree remove <path> --force` to remove the worktree directory, then `git branch -D task/{taskId}` to delete the local branch.
- **D-11:** If the worktree directory doesn't exist (already manually deleted), skip `git worktree remove` and just run `git branch -D`.
- **D-12:** If the branch doesn't exist (already deleted), skip `git branch -D` — no error thrown.

### Claude's Discretion
- Error message format in console.error logs
- Whether to use `git worktree remove --force` vs plain `git worktree remove`
- Order of operations in removeWorktree (remove worktree first, then branch)
- Whether startup prune should also clean up branches for worktrees that no longer exist

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Worktree Module
- `src/lib/worktree.ts` — Existing `createWorktree()` function; `removeWorktree()` goes here

### Status Transition Points
- `src/app/api/tasks/[taskId]/merge/route.ts` — Merge route sets status to DONE at line 93; add cleanup call after
- `src/actions/task-actions.ts` — `updateTaskStatus()` handles CANCELLED transitions; add cleanup call

### Execution Data
- `src/actions/agent-actions.ts` — `getTaskExecutions(taskId)` to find worktreePath/worktreeBranch
- `prisma/schema.prisma` — TaskExecution.worktreePath, TaskExecution.worktreeBranch, Task.baseBranch

### Project Data
- `src/lib/db.ts` — Prisma client for querying GIT-type projects at startup

### Data Model
- `AGENTS.md` — Full data model reference, cascade delete constraints

### Next.js Startup
- Next.js 16 instrumentation docs — `src/instrumentation.ts` with `register()` export

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `worktree.ts` `createWorktree()` — pattern for execSync git operations with timeout; `removeWorktree()` follows same style
- `execSync` with `{ cwd, encoding: "utf-8", timeout }` — established git operation pattern
- `db.task.findUnique({ include: { project: true } })` — pattern for loading task with project data
- `db.taskExecution.findFirst({ where: { taskId }, orderBy: { createdAt: "desc" } })` — pattern for getting latest execution

### Established Patterns
- Server actions for data mutations (`updateTaskStatus`)
- API routes for complex operations (merge route)
- `revalidatePath("/workspaces")` after mutations
- `console.error("[context] message:", error)` for error logging
- Zod validation at API boundaries

### Integration Points
- `merge/route.ts` line 93: after `db.task.update({ data: { status: "DONE" } })` — add removeWorktree call
- `task-actions.ts` `updateTaskStatus()`: when status is CANCELLED, load task+project+execution data, call removeWorktree
- New file: `src/instrumentation.ts` — Next.js startup hook for worktree prune

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-worktree-lifecycle*
*Context gathered: 2026-03-31*
