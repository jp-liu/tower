# Phase 16: Worktree Execution Engine - Research

**Researched:** 2026-03-31
**Domain:** Git worktree management, Next.js server actions, SSE stream route, React dialog UI
**Confidence:** HIGH

## Summary

Phase 16 wires three capabilities that all rest on Phase 15's data-model scaffolding (Task.baseBranch, TaskExecution.worktreePath/worktreeBranch). The schema, server actions, and execution adapter are already in place — this phase is purely **plumbing and UI integration**, not new infrastructure invention.

The core implementation is: (1) add a branch selector to `create-task-dialog.tsx` conditioned on `project.type === "GIT"`, (2) create `src/lib/worktree.ts` to isolate `git worktree add` logic, (3) update `stream/route.ts` to call the worktree utility before `adapter.execute()` and store the path on the `TaskExecution` record. No schema migrations, no new tables, no adapter interface changes — `ExecutionContext.cwd` already accepts any path.

The project already has working examples of every pattern needed: `execSync` for git operations (`git-actions.ts`), async branch fetching with loading state (`getProjectBranches`), SSE error event format, and conditional UI based on project type. The implementation surface is narrow and the risk is low.

**Primary recommendation:** Implement in two plans — Plan 01 covers `worktree.ts` utility + stream route integration (WT-01, WT-02, WT-04), Plan 02 covers the branch selector UI (BR-01).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Branch selector appears in `create-task-dialog.tsx`, below the priority button group, only when the current project is a GIT-type project with a non-null `localPath`.
**D-02:** Default selected branch is the first branch returned by `getProjectBranches()` (typically main/master). User can change it before creating the task.
**D-03:** Branch list is fetched async via `getProjectBranches(localPath)` when the dialog opens (or when project context is available). Show a loading indicator while fetching.
**D-04:** baseBranch is set at task creation and locked afterward. Editing a task does NOT allow changing baseBranch.
**D-05:** Worktree is created lazily at execution start (in stream route handler), not at task creation.
**D-06:** Worktree creation logic lives in a new utility module `src/lib/worktree.ts`.
**D-07:** The stream route creates the worktree, stores the path/branch on the TaskExecution record, then passes the worktree path as `cwd` to `adapter.execute()`.
**D-08:** For NORMAL projects: branch selector is hidden, no worktree created, cwd remains `project.localPath` as before.
**D-09:** If `git worktree add` fails, execution start fails immediately with a clear SSE error event. No silent fallback.

### Claude's Discretion

- Whether to reuse an existing worktree if task was previously executed (check logic)
- i18n key naming for new branch selector UI strings

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BR-01 | 创建任务时可从项目 git branches 列表选择 base branch | `getProjectBranches()` already implemented; `createTask()` already accepts `baseBranch`; dialog needs project context (type + localPath) threaded through |
| WT-01 | 任务执行前自动创建 worktree (`{localPath}/.worktrees/task-{taskId}`) + 独立分支 `task/{taskId}` | `git worktree add -b <branch> <path> <base>` is the command; implement in `src/lib/worktree.ts`; call from stream route before `adapter.execute()` |
| WT-02 | Claude CLI 在 worktree 目录中执行（cwd 切换到 worktree） | `ExecutionContext.cwd` already accepts any string; stream route line 277 is the only change point |
| WT-04 | 同项目多任务可并行执行，各自在独立 worktree 中工作 | Each worktree is a separate directory; git worktree design inherently isolates file system; no locking logic needed |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `child_process.execSync` | Built-in | `git worktree add`, `git worktree list` | Already used in `git-actions.ts` for all git ops — consistent pattern |
| Node.js `fs/promises` (`mkdir`) | Built-in | Ensure `.worktrees/` parent directory exists before git command | Already used in stream route for temp dir creation |
| `path` | Built-in | Construct worktree path from localPath + taskId | Standard |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | ^4.3.6 (already installed) | Validate worktree preconditions | Already used in stream route body parsing |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `execSync` for git ops | `simple-git` npm package | simple-git adds a dependency; execSync pattern is already established in git-actions.ts — stay consistent |
| Inline worktree logic in stream route | Dedicated `worktree.ts` module | D-06 locks this: module keeps route thin and unit-testable |

**Installation:**
No new dependencies needed — all standard library.

---

## Architecture Patterns

### Recommended Project Structure

```
src/lib/
└── worktree.ts          # New: createWorktree(), getWorktreePath()

src/app/api/tasks/[taskId]/stream/
└── route.ts             # Modify: worktree creation between TaskExecution.create and adapter.execute()

src/components/board/
└── create-task-dialog.tsx  # Modify: add branch selector + accept project prop

src/app/workspaces/[workspaceId]/
└── board-page-client.tsx   # Modify: thread project type+localPath into dialog, forward baseBranch

src/lib/i18n.tsx         # Modify: add branch selector translation keys

tests/unit/lib/
└── worktree.test.ts     # New: unit tests for worktree.ts
```

### Pattern 1: worktree.ts Utility Module

**What:** Pure function that shells out to `git worktree add` and returns the path/branch.
**When to use:** Called from stream route exactly once per execution start for GIT-type projects.

```typescript
// src/lib/worktree.ts
import { execSync } from "child_process";
import { mkdir } from "fs/promises";
import path from "path";

export interface WorktreeResult {
  worktreePath: string;
  worktreeBranch: string;
}

export async function createWorktree(
  localPath: string,
  taskId: string,
  baseBranch: string
): Promise<WorktreeResult> {
  const worktreePath = path.join(localPath, ".worktrees", `task-${taskId}`);
  const worktreeBranch = `task/${taskId}`;

  // Ensure parent .worktrees/ directory exists (git worktree add creates the leaf)
  await mkdir(path.join(localPath, ".worktrees"), { recursive: true });

  // Check if worktree already exists (reuse for re-execution)
  const existingList = execSync("git worktree list --porcelain", {
    cwd: localPath,
    encoding: "utf-8",
    timeout: 10000,
  });
  if (existingList.includes(worktreePath)) {
    return { worktreePath, worktreeBranch };
  }

  // Create new worktree + branch based on baseBranch
  execSync(
    `git worktree add -b ${worktreeBranch} "${worktreePath}" ${baseBranch}`,
    { cwd: localPath, encoding: "utf-8", timeout: 10000 }
  );

  return { worktreePath, worktreeBranch };
}
```

### Pattern 2: Stream Route Integration Point

**What:** Insert worktree creation between `db.taskExecution.create` and `adapter.execute()`. Store the result on the execution record.
**When to use:** Only when `task.project.type === "GIT"` and `task.baseBranch` is set.

```typescript
// In stream/route.ts — inside the ReadableStream start() callback
// After: const execution = await db.taskExecution.create(...)
// Before: const result = await adapter.execute(...)

let cwd = task.project!.localPath!;

if (task.project!.type === "GIT" && task.baseBranch) {
  try {
    const { worktreePath, worktreeBranch } = await createWorktree(
      task.project!.localPath!,
      taskId,
      task.baseBranch
    );
    // Persist on execution record
    await db.taskExecution.update({
      where: { id: execution.id },
      data: { worktreePath, worktreeBranch },
    });
    cwd = worktreePath;
    sendEvent({ type: "status", content: `Worktree ready: ${worktreeBranch}` });
  } catch (err) {
    await db.taskExecution.update({
      where: { id: execution.id },
      data: { status: "FAILED", endedAt: new Date() },
    });
    sendEvent({ type: "error", content: `Worktree creation failed: ${String(err)}` });
    controller.close();
    return;
  }
}

const result = await adapter.execute({
  runId: execution.id,
  prompt: fullPrompt,
  cwd,   // <-- worktree path for GIT projects, localPath for NORMAL
  ...
});
```

### Pattern 3: Branch Selector in Create Task Dialog

**What:** Async branch fetch on dialog open; Select dropdown rendered only for GIT projects.
**When to use:** Dialog receives `project` prop; renders selector when `project.type === "GIT" && project.localPath`.

```typescript
// New state in create-task-dialog.tsx
const [branches, setBranches] = useState<string[]>([]);
const [branchesLoading, setBranchesLoading] = useState(false);
const [selectedBranch, setSelectedBranch] = useState<string>("");

// Fetch branches when dialog opens for a GIT project
useEffect(() => {
  if (!open || !isGitProject || !localPath || isEditing) return;
  setBranchesLoading(true);
  getProjectBranches(localPath).then((list) => {
    setBranches(list);
    setSelectedBranch(list[0] ?? "");
    setBranchesLoading(false);
  });
}, [open, isGitProject, localPath, isEditing]);
```

The `onSubmit` callback shape gains `baseBranch?: string` — only set when `isGitProject && !isEditing`.

### Pattern 4: Worktree Reuse on Re-execution

**What:** If a task was previously executed (worktree already exists), reuse it rather than failing.
**Detection:** `git worktree list --porcelain` output contains the target path.
**Result:** Idempotent — `createWorktree()` is safe to call multiple times for the same taskId.

### Anti-Patterns to Avoid

- **Creating worktree inside `validateAndParseRequest`:** Worktree creation is a side effect — keep it inside the SSE stream, after the `TaskExecution` record exists.
- **Passing baseBranch through session resume:** Session resume (`resumeSessionId`) is separate from worktree — don't conflate them. Worktree path is read from the DB for re-executions.
- **Failing silently when worktree exists:** `git worktree add` errors with "already exists" if the branch is checked out elsewhere. The reuse-check prevents this.
- **Using `execSync` without timeout in the stream callback:** The stream route is async — use timeout on all git shell calls to prevent indefinite hangs.
- **Mutating the `execution` record multiple times:** Create the execution once, update worktree fields once. Don't sprinkle multiple `db.taskExecution.update` calls.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Git worktree management | Custom file-copy isolation | `git worktree add` | Native git isolation — branches track history, conflict detection works, Claude's git tools work correctly |
| Branch listing | Custom branch parser | `getProjectBranches()` already in `git-actions.ts` | Already handles tilde expansion, error gracefully returns `[]` |
| Worktree path conflict detection | Custom lock file | `git worktree list --porcelain` | Git itself tracks worktree registrations |
| Concurrent execution gating | Custom semaphore | `canStartExecution()` in `process-manager.ts` | Already reads configurable max from DB |

**Key insight:** The hardest part of worktree isolation (file system independence between branches) is provided entirely by git. The implementation is thin glue code, not a new system.

---

## Runtime State Inventory

> Included because this phase touches execution state.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | TaskExecution rows with `worktreePath=null` for all existing executions | None — null is valid for NORMAL projects and pre-worktree executions |
| Live service config | None | None |
| OS-registered state | Existing `.claude/worktrees/` worktrees in project (agent worktrees, not task worktrees) | None — these are agent worktrees, separate from task worktrees at `.worktrees/` |
| Secrets/env vars | None | None |
| Build artifacts | None | None |

**Note on worktree directory naming:** Agent worktrees live at `.claude/worktrees/`. Task worktrees will live at `.worktrees/` (sibling of `.claude/`). No collision.

---

## Common Pitfalls

### Pitfall 1: Branch Already Exists in Another Worktree

**What goes wrong:** `git worktree add -b task/abc123` fails with "fatal: A branch named 'task/abc123' already exists" if a previous execution created it and the worktree was removed without removing the branch.
**Why it happens:** `git worktree remove` removes the directory but does NOT automatically delete the branch.
**How to avoid:** In `createWorktree()`, before attempting `add`, check if branch already exists. If it does AND the worktree path doesn't exist, use `git worktree add --force` or re-create with `-B` (create-or-reset).
**Warning signs:** Stream shows error event immediately at execution start before any Claude output.

### Pitfall 2: baseBranch Null for GIT Project

**What goes wrong:** A GIT project task created before Phase 16 has `baseBranch = null`. The stream route would skip worktree creation (correct per D-08 fallback), but Claude runs in the project root — potentially conflicting with other tasks.
**Why it happens:** Phase 15 added the field but didn't backfill it for existing tasks.
**How to avoid:** The worktree creation condition should be `type === "GIT" && baseBranch !== null`. Document this as expected behavior — existing tasks without baseBranch continue to run in project root.
**Warning signs:** No worktree status event in the SSE stream for a GIT project.

### Pitfall 3: Dialog Receives No Project Context

**What goes wrong:** `create-task-dialog.tsx` currently receives no `project` prop — it doesn't know if the current project is GIT type or what its localPath is.
**Why it happens:** The dialog was designed before worktree features existed; project context wasn't needed.
**How to avoid:** Thread `project` (or at minimum `{ type, localPath }`) from `board-page-client.tsx` into `CreateTaskDialog`. `board-page-client.tsx` already has `project: ProjectInfo` with `type` and `localPath` fields.
**Warning signs:** Branch selector never renders even on GIT projects.

### Pitfall 4: execSync in ReadableStream start()

**What goes wrong:** The `start()` callback of `ReadableStream` is async but `execSync` is synchronous and blocking. Long `git worktree add` operations (slow disk) block the Node.js event loop.
**Why it happens:** `execSync` is blocking by design.
**How to avoid:** The existing pattern in `git-actions.ts` uses `execSync` with a timeout parameter. For the stream route, a 30-second timeout is appropriate. Alternatively, `execFileAsync` (promisified `execFile`) is fully async — acceptable tradeoff given the existing codebase pattern prefers `execSync`.
**Warning signs:** Server becomes unresponsive during worktree creation on slow disk.

### Pitfall 5: onSubmit Type Mismatch After Adding baseBranch

**What goes wrong:** `board-page-client.tsx`'s `handleCreateTask` passes data to `createTask()`; if the dialog adds `baseBranch` to the onSubmit payload but the handler doesn't forward it, baseBranch is silently dropped.
**Why it happens:** The call chain has three layers: dialog → handleCreateTask → createTask server action.
**How to avoid:** Update all three layers together in the same plan: dialog prop types, handleCreateTask signature, and createTask call. `createTask` in `task-actions.ts` already accepts `baseBranch` — just wire it through.
**Warning signs:** Tasks created with branch selector visible but `baseBranch` remains null in DB.

---

## Code Examples

Verified patterns from existing codebase:

### execSync for git operations (from git-actions.ts)

```typescript
// Source: src/actions/git-actions.ts:18-25
const raw = execSync(
  "git branch --format='%(refname:short)'",
  { cwd: resolved, encoding: "utf-8", timeout: 5000 }
).trim();
```

### SSE error event format (from stream/route.ts)

```typescript
// Source: src/app/api/tasks/[taskId]/stream/route.ts:306-309
sendEvent({
  type: "error",
  content: "Agent execution failed",
});
```

### Conditional project type rendering (project.type === "GIT")

The existing `board-page-client.tsx` already uses `project.type` for conditional logic (e.g., RepoSidebar git section). The same pattern applies to the branch selector.

### Creating TaskExecution and updating it (from stream/route.ts:180-187)

```typescript
// Source: src/app/api/tasks/[taskId]/stream/route.ts:180-187
const execution = await db.taskExecution.create({
  data: {
    taskId,
    agent: agent ?? "CLAUDE_CODE",
    status: "RUNNING",
    startedAt: new Date(),
  },
});
```

Update pattern (for storing worktreePath/worktreeBranch after creation):

```typescript
await db.taskExecution.update({
  where: { id: execution.id },
  data: { worktreePath, worktreeBranch },
});
```

### git worktree add command syntax (verified against git 2.39.5)

```bash
# Create worktree + new branch based on base branch
git worktree add -b task/{taskId} "{localPath}/.worktrees/task-{taskId}/" {baseBranch}

# List worktrees (machine-readable)
git worktree list --porcelain
```

Output format of `--porcelain`:
```
worktree /path/to/main
HEAD abc1234...
branch refs/heads/main

worktree /path/to/.worktrees/task-xyz
HEAD def5678...
branch refs/heads/task/xyz
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single project root as cwd | Per-task worktree as cwd | Phase 16 | Multiple tasks in same project no longer conflict on file writes |
| baseBranch: null for all tasks | baseBranch set at creation for GIT projects | Phase 15 (schema) → Phase 16 (UI) | Tasks know which branch to base their work on |

**Schema already migrated (Phase 15):**
- `Task.baseBranch String?` — exists, not null constraint
- `TaskExecution.worktreePath String?` — exists
- `TaskExecution.worktreeBranch String?` — exists
- `startTaskExecution()` already accepts worktreePath/worktreeBranch params

---

## Open Questions

1. **Worktree reuse when branch exists but worktree directory was deleted**
   - What we know: `git worktree add -b branch path base` fails if `branch` already exists
   - What's unclear: Should we use `-B` (force reset) or `--force` to re-attach?
   - Recommendation: Check `git branch --list task/{taskId}` before add. If branch exists but worktree dir doesn't, use `git worktree add --force task/{taskId} .worktrees/task-{taskId}/` (reuses existing branch without `-b`). This preserves previous work.

2. **What happens when cwd is set to a worktree path that doesn't exist**
   - What we know: If worktree creation fails and we still call adapter.execute() with the dead path, Claude will fail with a cwd error
   - What's unclear: Whether the current error path in stream route handles this gracefully
   - Recommendation: The D-09 decision (explicit failure, no fallback) means: on worktree creation failure, send error event and close the stream immediately, before calling adapter.execute().

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| git | WT-01, WT-02 | Yes | 2.39.5 (Apple Git-154) | None — required |
| Node.js | All | Yes | v22.17.0 | None — required |
| git worktree subcommand | WT-01 | Yes | Available in git 2.5+ | None — 2.39.5 satisfies |

**Missing dependencies with no fallback:** None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/unit/lib/worktree.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BR-01 | `createTask` called with baseBranch from dialog | unit (task-actions.test.ts) | `npx vitest run tests/unit/actions/task-actions.test.ts` | Yes (existing tests cover baseBranch) |
| WT-01 | `createWorktree()` creates directory + branch | unit | `npx vitest run tests/unit/lib/worktree.test.ts` | No — Wave 0 |
| WT-01 | `createWorktree()` reuses existing worktree | unit | `npx vitest run tests/unit/lib/worktree.test.ts` | No — Wave 0 |
| WT-01 | `createWorktree()` throws on git failure | unit | `npx vitest run tests/unit/lib/worktree.test.ts` | No — Wave 0 |
| WT-02 | `TaskExecution.worktreePath` stored after creation | unit (agent-actions.test.ts) | `npx vitest run tests/unit/actions/agent-actions.test.ts` | Yes (existing tests cover worktreePath storage) |
| WT-04 | Two tasks with different worktrees don't conflict | integration (implicit via separate dirs) | N/A — structural guarantee from git worktree design | N/A |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/unit/lib/worktree.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/lib/worktree.test.ts` — covers WT-01 (create, reuse, error)
  - Must mock `child_process.execSync` and `fs/promises.mkdir`
  - Follow pattern from `tests/unit/lib/process-manager.test.ts` (vi.mock at top, clear in beforeEach)

*(All other test infrastructure exists — no framework setup needed)*

---

## Sources

### Primary (HIGH confidence)

- `src/app/api/tasks/[taskId]/stream/route.ts` — execution pipeline, SSE event format, cwd setting at line 277
- `src/actions/git-actions.ts` — `getProjectBranches()` implementation and execSync pattern
- `src/components/board/create-task-dialog.tsx` — current dialog structure; priority button group pattern to follow
- `src/app/workspaces/[workspaceId]/board-page-client.tsx` — project context available (`project.type`, `project.localPath`)
- `prisma/schema.prisma` — confirmed Task.baseBranch, TaskExecution.worktreePath/worktreeBranch all present
- `src/actions/task-actions.ts` — createTask already accepts baseBranch
- `src/actions/agent-actions.ts` — startTaskExecution already accepts worktreePath/worktreeBranch
- `src/lib/adapters/types.ts` — ExecutionContext.cwd is a plain string; no changes needed
- `git --version` — 2.39.5, worktree subcommand confirmed available
- `tests/unit/actions/task-actions.test.ts` — confirms test pattern for baseBranch persistence
- `tests/unit/actions/agent-actions.test.ts` — confirms test pattern for worktree field persistence

### Secondary (MEDIUM confidence)

- `git worktree add --help` output — verified exact flag syntax (`-b`, `--force`, `--porcelain`) on the target machine

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are built-in Node.js, already used in codebase
- Architecture: HIGH — all integration points identified by reading actual source; no inference
- Pitfalls: HIGH — each pitfall derived from reading the actual code and git behavior, not from training data assumptions
- Test map: HIGH — existing test infrastructure confirmed; only `worktree.test.ts` is new

**Research date:** 2026-03-31
**Valid until:** 2026-05-01 (stable domain — git worktree API won't change)
