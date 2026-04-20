# Phase 18: Worktree Lifecycle - Research

**Researched:** 2026-03-31
**Domain:** Git worktree cleanup, Next.js instrumentation, TypeScript server actions
**Confidence:** HIGH

## Summary

Phase 18 adds automated lifecycle management for git worktrees: cleanup when tasks reach terminal states (DONE/CANCELLED), and a startup prune to recover from any missed cleanups. All decisions are locked in CONTEXT.md. The work is pure backend — no UI changes, no schema changes.

The `removeWorktree()` function follows the exact same `execSync` pattern already established in `src/lib/worktree.ts`. The startup prune uses Next.js `instrumentation.ts` at the project root (not inside `src/`), which is a stable API since Next.js v15. Integration points are precisely identified in CONTEXT.md: the merge route (line 93) and `updateTaskStatus()` in task-actions.

**Primary recommendation:** Implement `removeWorktree()` in `src/lib/worktree.ts`, wire it into the two cleanup trigger points, then create `instrumentation.ts` at the project root for startup prune.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** A new `removeWorktree(localPath, taskId)` function in `src/lib/worktree.ts` handles all cleanup (remove worktree directory + delete branch).
- **D-02:** The merge route (`src/app/api/tasks/[taskId]/merge/route.ts`) calls `removeWorktree()` after the squash merge succeeds and status is set to DONE.
- **D-03:** `updateTaskStatus()` in `src/actions/task-actions.ts` calls `removeWorktree()` when transitioning to CANCELLED. Must load the task's project.localPath and execution worktree data to do so.
- **D-04:** For tasks cancelled before any execution (no worktree created), cleanup is a no-op — check for existence before attempting removal.
- **D-05:** Cleanup failures are logged (`console.error`) but do NOT block the status transition. The task moves to DONE/CANCELLED regardless of whether the worktree was successfully removed.
- **D-06:** Rationale: cleanup is best-effort. The startup prune (LC-02) acts as a safety net for any missed cleanups.
- **D-07:** Use Next.js `instrumentation.ts` (`register()` export) to run prune logic once at server startup.
- **D-08:** On startup, query all GIT-type projects with non-null `localPath`, then run `git worktree prune` in each project's localPath directory.
- **D-09:** Prune failures for individual projects are logged and skipped — one broken project should not prevent others from being pruned or block server startup.
- **D-10:** Full cleanup: `git worktree remove <path> --force` to remove the worktree directory, then `git branch -D task/{taskId}` to delete the local branch.
- **D-11:** If the worktree directory doesn't exist (already manually deleted), skip `git worktree remove` and just run `git branch -D`.
- **D-12:** If the branch doesn't exist (already deleted), skip `git branch -D` — no error thrown.

### Claude's Discretion
- Error message format in console.error logs
- Whether to use `git worktree remove --force` vs plain `git worktree remove`
- Order of operations in removeWorktree (remove worktree first, then branch)
- Whether startup prune should also clean up branches for worktrees that no longer exist

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LC-01 | 任务 DONE 或 CANCELLED 后自动清理 worktree 目录和分支 | `removeWorktree()` in worktree.ts; wired into merge route (DONE) and updateTaskStatus (CANCELLED) |
| LC-02 | 应用启动时执行 `git worktree prune` 清理孤立 worktree | Next.js `instrumentation.ts` `register()` hook; query GIT projects from db; execSync git worktree prune |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `child_process` (execSync) | built-in | Git operations | Already used in `worktree.ts` — zero new dependency |
| Node.js `fs` (existsSync) | built-in | Check directory existence before `git worktree remove` | Already used via `fs/promises` elsewhere |
| Next.js `instrumentation.ts` | v15+ (stable) | Server startup hook for startup prune | Official stable API; no experimental flag needed |
| Prisma (`db`) | ^6.19.2 | Query GIT projects at startup | Already used throughout the codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `path` (Node.js built-in) | built-in | Derive worktree path from localPath + taskId | Same pattern as createWorktree |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `execSync` for git ops | `execa` or `simple-git` | execSync is already established in worktree.ts — don't introduce a new library for 3 additional git commands |
| `instrumentation.ts` | `next.config.ts` custom server | instrumentation.ts is the correct, official Next.js pattern for run-once server startup code |

**Installation:**
No new packages required — all dependencies are already present.

## Architecture Patterns

### Recommended Project Structure
No new directories needed. Changes are confined to:
```
src/
├── lib/
│   └── worktree.ts          # Add removeWorktree() here
├── app/
│   └── api/tasks/[taskId]/
│       └── merge/route.ts   # Wire removeWorktree() after status=DONE
├── actions/
│   └── task-actions.ts      # Wire removeWorktree() in updateTaskStatus for CANCELLED
instrumentation.ts           # NEW: at project root (alongside next.config.ts)
tests/
└── unit/
    └── lib/
        └── worktree.test.ts # Add removeWorktree tests here
```

### Pattern 1: removeWorktree() in worktree.ts

**What:** Synchronous (using execSync) cleanup function following the exact same style as `createWorktree()`. Takes `localPath` and `taskId`, derives paths internally.

**When to use:** Called after task reaches DONE (merge route) or CANCELLED (task-actions).

**Example (following established worktree.ts pattern):**
```typescript
// Source: src/lib/worktree.ts (established execSync pattern)
import { existsSync } from "fs";

export async function removeWorktree(
  localPath: string,
  taskId: string
): Promise<void> {
  const worktreePath = path.join(localPath, ".worktrees", "task-" + taskId);
  const worktreeBranch = "task/" + taskId;

  // D-11: Skip remove if directory doesn't exist
  if (existsSync(worktreePath)) {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: localPath,
      encoding: "utf-8",
      timeout: 30000,
    });
  }

  // D-12: Check if branch exists before deleting
  const branchExists = execSync(`git branch --list ${worktreeBranch}`, {
    cwd: localPath,
    encoding: "utf-8",
    timeout: 5000,
  }).trim();

  if (branchExists) {
    execSync(`git branch -D ${worktreeBranch}`, {
      cwd: localPath,
      encoding: "utf-8",
      timeout: 5000,
    });
  }
}
```

### Pattern 2: CANCELLED cleanup in updateTaskStatus

**What:** `updateTaskStatus()` currently does a simple `db.task.update`. When transitioning to CANCELLED it must load the task with its project and latest execution to know the localPath, then call removeWorktree.

**Key DB query pattern (from codebase):**
```typescript
// Load task with project — established pattern from merge/route.ts
const task = await db.task.findUnique({
  where: { id: taskId },
  include: { project: true },
});

// Get latest execution for worktreePath — established pattern
const latestExecution = await db.taskExecution.findFirst({
  where: { taskId },
  orderBy: { createdAt: "desc" },
});
```

**D-04 no-op logic:** If `task.project?.localPath` is null (NORMAL project) or `latestExecution?.worktreePath` is null (never executed), skip removeWorktree entirely.

**D-05 failure isolation:**
```typescript
// D-05: Cleanup is best-effort — don't block status transition
try {
  await removeWorktree(localPath, taskId);
} catch (error) {
  console.error("[updateTaskStatus] Worktree cleanup failed:", error);
}
// Status update already committed above; revalidatePath proceeds regardless
```

### Pattern 3: DONE cleanup in merge/route.ts

**What:** After `db.task.update({ data: { status: "DONE" } })` at line 93, add a best-effort removeWorktree call. The localPath and taskId are already loaded in scope.

**Integration point:** The merge route already has `localPath` and `taskId` in scope from earlier in the handler. The worktree branch is also already resolved as `worktreeBranch`. Call `removeWorktree(localPath, taskId)` after the status update inside the same try block, but wrap in its own try/catch per D-05.

### Pattern 4: instrumentation.ts startup prune

**What:** A new file at the project root (NOT inside `src/`) that exports `register()`. This runs once when the Next.js server starts. It queries all GIT projects with localPath and runs `git worktree prune` in each.

**Placement:** Per official Next.js 16 docs: the file must be at the project root or inside `src/`. This project uses `src/` for app code but `next.config.ts` is at the root. Since there is no `src/` wrapper for config files, place `instrumentation.ts` at the root alongside `next.config.ts`.

**Node.js runtime gate:** Because `execSync` and Prisma require Node.js (not Edge), gate the import:
```typescript
// Source: Next.js official instrumentation docs
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation.node')
  }
}
```

Or simply check at runtime inside `register()` without a separate file (simpler for this use case since the project doesn't use Edge runtime).

**D-09 isolation pattern:**
```typescript
// Process each project independently — one failure doesn't block others
for (const project of gitProjects) {
  try {
    execSync("git worktree prune", {
      cwd: project.localPath!,
      encoding: "utf-8",
      timeout: 10000,
    });
  } catch (error) {
    console.error(`[instrumentation] git worktree prune failed for ${project.localPath}:`, error);
  }
}
```

### Anti-Patterns to Avoid
- **Importing from `src/actions/` in instrumentation.ts:** Server actions use `"use server"` directive which works in Next.js request context. At startup, call `db` directly (import from `src/lib/db`), not via server actions.
- **Making removeWorktree async with file system operations first:** `existsSync` is synchronous — consistent with the execSync pattern already in createWorktree. Don't mix async fs/promises with sync execSync unless necessary.
- **Blocking server startup:** instrumentation.ts `register()` "must complete before the server is ready to handle requests" — keep prune operations fast. `git worktree prune` is typically sub-second. Failures must not throw.
- **Using `rm -rf` directly instead of `git worktree remove`:** Git worktree remove also cleans up git's internal worktree metadata. `rm -rf` would leave stale entries in `.git/worktrees/`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Directory existence check | Custom fs stat wrapper | `existsSync` from `fs` (sync, built-in) | One line, already imported pattern |
| Branch existence check | Parse git output manually | `git branch --list <branch>` returns empty string if not found | Already used in createWorktree |
| Startup hook | Custom server.js | Next.js `instrumentation.ts` | Official stable API since v15 |

**Key insight:** Every tool needed already exists in the codebase. This phase is about wiring, not new infrastructure.

## Common Pitfalls

### Pitfall 1: instrumentation.ts location
**What goes wrong:** File placed inside `src/app/` or `src/` instead of at project root.
**Why it happens:** Developer follows the "put things in src/" habit.
**How to avoid:** Per official docs: place alongside `next.config.ts` at project root. The `src/` folder option for instrumentation is for when you have `src/app/` and `src/pages/` — it means put it in `src/`, not deeper. This project uses `src/app/` so instrumentation goes in `src/instrumentation.ts` OR at root.
**Warning signs:** `register()` never fires.

**Clarification:** The docs say "root of your project or inside a `src` folder if using one." Since this project has `src/app/`, `src/actions/`, etc., `src/instrumentation.ts` is the correct location. Root also works. The planner should choose `src/instrumentation.ts` for consistency with where all other source files live.

### Pitfall 2: updateTaskStatus modifies signature behavior
**What goes wrong:** The existing `updateTaskStatus()` simple db.update is wrapped in additional DB queries that slow every status transition, not just CANCELLED.
**Why it happens:** Naively moving the worktree query outside the conditional.
**How to avoid:** Only load task+project+execution when `status === "CANCELLED"`.

### Pitfall 3: git worktree remove fails because worktree is "dirty"
**What goes wrong:** `git worktree remove` without `--force` fails if the worktree has uncommitted changes.
**Why it happens:** Task was cancelled mid-execution.
**How to avoid:** Always use `--force` per D-10 discretion — cancelled work is intentionally discarded.

### Pitfall 4: Prisma client in instrumentation.ts cold start
**What goes wrong:** Importing `db` from `src/lib/db.ts` at instrumentation startup before the Prisma client is initialized triggers a connection before the server is fully ready.
**Why it happens:** `db.ts` uses a `globalThis` singleton pattern, but `initDb()` (which sets WAL/busy_timeout) may not have been called yet.
**How to avoid:** Call `initDb()` before querying in instrumentation, or call `db.$connect()` explicitly. The existing `initDb()` function handles this — import and call it.

### Pitfall 5: CANCELLED path in updateTaskStatus — task doesn't always have a worktree
**What goes wrong:** Calling removeWorktree when a task was moved to CANCELLED directly from TODO (never executed) — `localPath` may be null (NORMAL project) or execution may be null.
**Why it happens:** Any task can be cancelled regardless of whether execution happened.
**How to avoid:** Per D-04 — guard with null checks:
```typescript
if (status === "CANCELLED" && task.project?.localPath) {
  // only proceed if project has a localPath (GIT project)
  // worktreePath derived from taskId, existence check inside removeWorktree handles the rest
}
```
Note: `worktreePath` is deterministic from `localPath` + `taskId` — no need to query `latestExecution` to find it. `removeWorktree(localPath, taskId)` derives the path internally.

## Code Examples

Verified patterns from official sources and existing codebase:

### execSync git operation pattern (from src/lib/worktree.ts)
```typescript
// Source: src/lib/worktree.ts lines 31-35
execSync("git worktree list --porcelain", {
  cwd: localPath,
  encoding: "utf-8",
  timeout: 10000,
});
```

### git worktree remove --force
```bash
git worktree remove "/path/to/worktree" --force
# Removes worktree directory AND cleans .git/worktrees/ metadata
# --force required when worktree has uncommitted changes
```

### git branch -D (force delete)
```bash
git branch -D task/abc123
# Force delete branch (non-ff-merge safe)
# Returns non-zero exit if branch doesn't exist — catch or pre-check
```

### git worktree prune
```bash
git worktree prune
# Removes stale entries from .git/worktrees/ where the worktree directory no longer exists
# Safe to run at any time; no-op if nothing is stale
```

### Next.js instrumentation.ts (from official docs at node_modules/next/dist/docs/)
```typescript
// Source: node_modules/next/dist/docs/01-app/02-guides/instrumentation.md
// src/instrumentation.ts (or project root instrumentation.ts)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Node.js-only code here (execSync, Prisma)
  }
}
```

### updateTaskStatus — current pattern
```typescript
// Source: src/actions/task-actions.ts lines 37-44
export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const task = await db.task.update({
    where: { id: taskId },
    data: { status },
  });
  revalidatePath("/workspaces");
  return task;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `instrumentation` experimental | `instrumentation` stable | Next.js v15.0.0 | No `experimental.instrumentationHook` config needed |
| `git worktree remove` (may fail on dirty) | `git worktree remove --force` | Always correct for cleanup | Ensures cleanup doesn't fail on in-progress work |

**Deprecated/outdated:**
- `experimental.instrumentationHook: true` in `next.config.js`: Removed in v15 — instrumentation is now stable and requires no opt-in config.

## Open Questions

1. **instrumentation.ts in `src/` vs project root**
   - What we know: Docs say "root of project or inside src folder." This project uses `src/` for all source files.
   - What's unclear: Minor — both locations work.
   - Recommendation: Use `src/instrumentation.ts` for consistency with project structure. Docs confirm both are valid.

2. **Should startup prune also attempt branch deletion for orphaned branches?**
   - What we know: This is listed under Claude's Discretion.
   - What's unclear: Would add complexity; branches from orphaned worktrees may already be merged.
   - Recommendation: Keep startup prune to `git worktree prune` only (D-08). Branch cleanup is handled per-task at cleanup time. Startup prune is for recovering orphaned worktree metadata entries, not for exhaustive branch cleanup.

## Environment Availability

Step 2.6: SKIPPED — this phase uses only git (already required for the entire worktree feature set) and Node.js built-ins. No new external dependencies.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `pnpm test:run -- tests/unit/lib/worktree.test.ts` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LC-01 (DONE path) | removeWorktree called after merge; worktree dir + branch removed | unit | `pnpm test:run -- tests/unit/lib/worktree.test.ts` | ✅ (add new describe block) |
| LC-01 (CANCELLED path) | updateTaskStatus calls removeWorktree for CANCELLED; no-op for NORMAL projects or no-execution tasks | unit | `pnpm test:run -- tests/unit/actions/task-actions.test.ts` | ✅ (add new describe block) |
| LC-01 no-op | removeWorktree is no-op when dir/branch don't exist; no error thrown | unit | `pnpm test:run -- tests/unit/lib/worktree.test.ts` | ✅ (add new describe block) |
| LC-02 | register() queries GIT projects and runs git worktree prune | unit | `pnpm test:run -- tests/unit/lib/instrumentation.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test:run -- tests/unit/lib/worktree.test.ts`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/lib/instrumentation.test.ts` — covers LC-02 (new file, mock db and execSync)

## Sources

### Primary (HIGH confidence)
- `src/lib/worktree.ts` — Existing execSync git operation patterns; removeWorktree follows identical style
- `src/app/api/tasks/[taskId]/merge/route.ts` — Integration point for DONE cleanup; line 93 confirmed
- `src/actions/task-actions.ts` — Integration point for CANCELLED cleanup; updateTaskStatus pattern confirmed
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md` — Official Next.js instrumentation API (register(), placement, runtime)
- `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md` — Official guide: src/ placement, NEXT_RUNTIME guard

### Secondary (MEDIUM confidence)
- `tests/unit/lib/worktree.test.ts` — Test patterns (vi.mock child_process, @vitest-environment node) verified in codebase
- `src/lib/db.ts` — initDb() pattern for Prisma initialization in instrumentation context

### Tertiary (LOW confidence)
None — all critical claims verified against official docs or existing codebase code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools already in use; no new packages
- Architecture: HIGH — integration points precisely identified in CONTEXT.md and confirmed by reading actual files
- Pitfalls: HIGH — verified against official Next.js docs and existing codebase patterns

**Research date:** 2026-03-31
**Valid until:** 2026-04-30 (stable APIs; Next.js instrumentation has been stable since v15)
