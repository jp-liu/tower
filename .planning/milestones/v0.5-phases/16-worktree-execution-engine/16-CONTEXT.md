# Phase 16: Worktree Execution Engine - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver three capabilities: (1) a base branch selector in the create-task dialog for GIT-type projects, (2) automatic worktree + branch creation at execution start, and (3) cwd switching so the Claude CLI runs inside the worktree. The result is that multiple tasks in the same project can execute concurrently without file conflicts.

</domain>

<decisions>
## Implementation Decisions

### Branch Selector UI
- **D-01:** Branch selector appears in `create-task-dialog.tsx`, below the priority button group, only when the current project is a GIT-type project with a non-null `localPath`.
- **D-02:** Default selected branch is the first branch returned by `getProjectBranches()` (typically main/master). User can change it before creating the task.
- **D-03:** Branch list is fetched async via `getProjectBranches(localPath)` when the dialog opens (or when project context is available). Show a loading indicator while fetching.
- **D-04:** baseBranch is set at task creation and locked afterward. Editing a task does NOT allow changing baseBranch (changing mid-execution would be dangerous).

### Worktree Creation Timing
- **D-05:** Worktree is created lazily at execution start (in stream route handler), not at task creation. This avoids orphaned worktrees for tasks that are never executed.
- **D-06:** Worktree creation logic lives in a new utility module `src/lib/worktree.ts` — keeps the stream route thin and testable.
- **D-07:** The stream route creates the worktree, stores the path/branch on the TaskExecution record, then passes the worktree path as `cwd` to `adapter.execute()`.

### Non-GIT Project Handling
- **D-08:** For NORMAL projects (no git): branch selector is hidden in create-task-dialog, no worktree is created at execution start, and cwd remains `project.localPath` as before. Zero behavior change for non-GIT projects.

### Worktree Creation Failure
- **D-09:** If `git worktree add` fails (branch already exists, disk full, git not initialized, etc.), the execution start fails immediately with a clear error message sent as an SSE error event. No silent fallback to project root — explicit failure is safer than running in the wrong directory.

### Claude's Discretion
- Worktree path format is already decided: `{localPath}/.worktrees/task-{taskId}/`
- Branch name format is already decided: `task/{taskId}`
- Whether to reuse an existing worktree (if task was previously executed) — Claude can decide the check logic
- i18n key naming for new branch selector UI strings

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema & Data Model
- `prisma/schema.prisma` — Task.baseBranch, TaskExecution.worktreePath/worktreeBranch fields (added in Phase 15)
- `AGENTS.md` — Full data model reference, MCP tool specs, server action signatures

### Execution Pipeline
- `src/app/api/tasks/[taskId]/stream/route.ts` — Current execution flow; cwd is set at line 277 (`task.project!.localPath!`)
- `src/lib/adapters/types.ts` — ExecutionContext.cwd interface (no changes needed)
- `src/lib/adapters/claude-local/execute.ts` — How cwd is passed to runChildProcess
- `src/lib/adapters/process-manager.ts` — Concurrent execution management
- `src/actions/agent-actions.ts` — startTaskExecution already accepts worktreePath/worktreeBranch

### Branch & Git Operations
- `src/actions/git-actions.ts` — getProjectBranches(localPath) already implemented
- `src/app/api/git/route.ts` — Existing git API route for reference

### Task UI
- `src/components/board/create-task-dialog.tsx` — Where branch selector will be added
- `src/actions/task-actions.ts` — createTask server action (needs baseBranch param)
- `src/lib/i18n.tsx` — i18n translations for new UI strings

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getProjectBranches(localPath)` in `src/actions/git-actions.ts` — returns string[] of local branch names, handles errors gracefully
- `startTaskExecution(taskId, agent, worktreePath?, worktreeBranch?)` — already wired for worktree fields
- Priority button group pattern in `create-task-dialog.tsx` — branch selector can follow similar styling
- Zod validation pattern in stream route — can validate worktree preconditions

### Established Patterns
- Server actions for data mutations, API routes for streaming/long-running ops
- `execSync` for git operations (see git-actions.ts) — same pattern for `git worktree add`
- Error events sent as `{ type: "error", content: string }` SSE events in stream route
- Components conditionally rendered based on project type (GIT vs NORMAL)

### Integration Points
- `stream/route.ts` line 277: replace `task.project!.localPath!` with worktree path when available
- `stream/route.ts` line 180-187: TaskExecution creation — add worktreePath/worktreeBranch data
- `create-task-dialog.tsx` onSubmit callback — needs baseBranch in data payload
- `board-page-client.tsx` handleCreateTask — passes data to createTask server action
- `task-actions.ts` createTask — needs to accept and store baseBranch

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

*Phase: 16-worktree-execution-engine*
*Context gathered: 2026-03-31*
