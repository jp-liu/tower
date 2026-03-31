# Phase 17: Review & Merge Workflow - Research

**Researched:** 2026-03-31
**Domain:** Git diff display, squash merge, conflict detection, Next.js routing, React UI composition
**Confidence:** HIGH

## Summary

Phase 17 adds a full review-merge-revise cycle to the task workflow. When a task execution completes successfully, the task transitions to IN_REVIEW. Users can view a GitHub-style diff of changes, squash-merge to the base branch, or send the task back for more work by chatting in the panel.

The implementation is well-scoped. All core infrastructure exists: `worktree.ts` handles worktree creation/reuse, `git-actions.ts` establishes the `execSync` pattern for git operations, `task-detail-panel.tsx` provides the existing chat UI, and `updateTaskStatus` handles status transitions. The main work is wiring: a new dedicated task page, two new API routes (`/diff` and `/merge`), modifying `persistResult` in `stream/route.ts` to auto-transition to IN_REVIEW on success, and implementing the send-back flow.

**Primary recommendation:** Shell out to git for all diff and merge operations using the established `execSync` pattern. No additional npm packages are required — the existing stack handles everything.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** New route `/workspaces/[workspaceId]/tasks/[taskId]` — dedicated task page with full-width layout. Left side: chat/conversation panel. Right side: large container with tab switching.
- **D-02:** Right-side tabs: "Changes" (diff view with per-file collapsible sections). Future tabs (file browser, preview) deferred.
- **D-03:** In the existing drawer (task-detail-panel), add a "View Details" button that navigates to the task page. Also add a simplified "Conversation / Changes" tab in the drawer itself for quick diff viewing without leaving the board.
- **D-04:** Diff rendered as per-file collapsible blocks. Each block shows filename + lines added/removed count. Click to expand and see unified diff content. Similar to GitHub PR file diff.
- **D-05:** Diff data fetched via new API route (not server action). Server-side executes `git diff baseBranch...task/{taskId}` and returns JSON with file list and per-file diff content.
- **D-06:** When task is in IN_REVIEW, the diff/Changes tab auto-loads on page open.
- **D-07:** "Merge" and action buttons appear in the diff area header, only when task status is IN_REVIEW.
- **D-08:** Clicking "Merge" opens a confirmation dialog showing: target branch name, number of changed files, number of commits to squash.
- **D-09:** Squash merge commit message is auto-generated (format: `feat: {taskTitle}`) — no user editing required.
- **D-10:** Before merge, system checks for conflicts via `git merge-tree` or dry-run. If conflicts detected: Merge button is disabled/grayed out, conflict file list displayed. User must resolve conflicts before merging.
- **D-11:** After successful merge, task status automatically transitions to DONE.
- **D-12:** No separate "Send Back" button needed. When a task is in IN_REVIEW and the user sends a message in the chat panel, the task automatically transitions back to IN_PROGRESS and starts a new execution. The message becomes the new prompt context.
- **D-13:** The new execution reuses the existing worktree and branch (createWorktree handles this with its reuse logic from Phase 16).
- **D-14:** A new TaskExecution record is created pointing to the same worktree path and branch.
- **D-15:** Task automatically transitions from IN_PROGRESS to IN_REVIEW when execution completes successfully (exitCode === 0). Failed executions (exitCode !== 0) stay IN_PROGRESS.
- **D-16:** The transition happens in the stream route's persistResult helper, after marking the TaskExecution as COMPLETED.

### Claude's Discretion
- Exact layout proportions for left chat / right diff on the task page
- Diff syntax highlighting approach (CSS classes vs library)
- Loading states and skeleton screens for diff fetching
- i18n key naming for all new UI strings
- Git diff parsing logic (raw output → structured JSON)

### Deferred Ideas (OUT OF SCOPE)
- **File system browser** — Tab in task page to browse worktree file structure
- **Frontend iframe Preview** — Tab in task page with iframe pointing to local dev server
- **Conflict resolution UI** — Show conflicting files inline and offer to send to Claude for fixing (WT-F02 in REQUIREMENTS.md)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MR-01 | 任务完成后状态变为 IN_REVIEW，用户可在任务面板查看 diff | persistResult modification (D-15, D-16) + diff API route (D-05) + UI tab (D-04) |
| MR-02 | 用户可在任务面板 squash merge worktree 分支到任务的 base branch | New merge API route using `git merge --squash` + `git commit` (D-07 to D-11) |
| MR-03 | 合并前自动检测冲突，有冲突时提示用户 | `git merge-tree` conflict detection before merge button enables (D-10) |
| RV-01 | IN_REVIEW 状态的任务可退回 IN_PROGRESS，Claude 在同一 worktree 继续修改 | stream/route.ts: detect IN_REVIEW task on message send, auto-transition (D-12, D-13) |
| RV-02 | 退回重做创建新的 TaskExecution 记录，复用同一 worktree 和分支 | createWorktree reuse logic already handles this (D-14) + stream route creates new execution |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.2.1 | App Router routing, API routes | Already in use |
| React | 19.2.4 | UI composition | Already in use |
| Prisma | (current) | DB updates for status transitions | Already in use |
| execSync (Node built-in) | — | Git operations in API routes | Established pattern in git-actions.ts and api/git/route.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | (current) | Icons (GitMerge, AlertTriangle, etc.) | All icon needs |
| shadcn/ui components | (current) | Dialog, Button, Badge, Tabs, Collapsible | Confirmation dialog, tab container |
| Tailwind CSS | (current) | Styling the diff view, layout proportions | All styling |
| Zod | (current) | API route request validation | merge/diff API routes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| execSync for git | diff/parse npm library | No added value — git CLI output is stable and sufficient |
| CSS-only syntax highlight | Prism/Highlight.js | Adds 50KB+ bundle cost; CSS classes on `+`/`-` lines achieves ~80% value for zero cost |
| Server action for diff | API route | Diff content can be large; API route avoids server action size limits and aligns with D-05 decision |

**Installation:** No new packages required.

## Architecture Patterns

### New Files Overview
```
src/app/workspaces/[workspaceId]/tasks/[taskId]/
  page.tsx                         # New task detail page (server component)
  task-page-client.tsx             # Client component: left chat + right tabs

src/app/api/tasks/[taskId]/
  diff/route.ts                    # GET: returns structured diff JSON
  merge/route.ts                   # POST: squash merge + status → DONE

src/components/task/
  task-diff-view.tsx               # Per-file collapsible diff blocks
  task-diff-file-block.tsx         # Single file diff block (collapsible)
  task-merge-confirm-dialog.tsx    # Confirmation dialog for merge action
```

### Modified Files Overview
```
src/app/api/tasks/[taskId]/stream/route.ts   # persistResult: add IN_REVIEW on success
src/components/task/task-detail-panel.tsx    # Add "View Details" nav + Changes tab
src/lib/i18n.tsx                             # New i18n keys
```

### Pattern 1: IN_REVIEW Auto-Transition in persistResult
**What:** After marking execution COMPLETED, also update Task.status to IN_REVIEW.
**When to use:** exitCode === 0 only.
**Example:**
```typescript
// In persistResult, after updating TaskExecution:
if (result.exitCode === 0) {
  await db.task.update({
    where: { id: taskId },
    data: { status: "IN_REVIEW" },
  });
}
// Then revalidatePath:
// Note: stream route does not currently call revalidatePath.
// The task page client polling / router.refresh() handles board refresh.
```

### Pattern 2: Diff API Route
**What:** GET `/api/tasks/[taskId]/diff` runs `git diff baseBranch...worktreeBranch` and returns structured JSON.
**When to use:** Called client-side when task is IN_REVIEW and Changes tab is active.
**Example:**
```typescript
// route.ts GET handler
const task = await db.task.findUnique({ where: { id: taskId }, include: { project: true } });
// Get latest execution for worktreePath/worktreeBranch
const exec = await db.taskExecution.findFirst({
  where: { taskId, status: "COMPLETED" },
  orderBy: { createdAt: "desc" },
});
const localPath = task.project!.localPath!;
const baseBranch = task.baseBranch!;
const worktreeBranch = exec?.worktreeBranch ?? `task/${taskId}`;

// Get file list with +/- line counts
const numstat = execSync(
  `git diff --numstat ${baseBranch}...${worktreeBranch}`,
  { cwd: localPath, encoding: "utf-8", timeout: 10000 }
);

// Get per-file unified diff
const unifiedDiff = execSync(
  `git diff --unified=3 ${baseBranch}...${worktreeBranch}`,
  { cwd: localPath, encoding: "utf-8", timeout: 30000 }
);

// Parse and return structured JSON
return NextResponse.json({ files: parseDiffOutput(numstat, unifiedDiff) });
```

### Pattern 3: Conflict Detection
**What:** Use `git merge-tree` (modern mode, Git 2.38+) to check conflicts before showing Merge button as enabled.
**When to use:** Called as part of the diff API response, or as a separate check endpoint.
**Verification:** Git 2.39.5 is installed on this machine — `git merge-tree` modern mode is supported.
**Example:**
```typescript
// Check conflicts: merge-tree returns non-zero if conflicts exist
// git merge-tree <base> <branch1> <branch2>
// Modern mode: git merge-tree --write-tree <branch1> <branch2>
// Check exit code — 0 = clean merge, 1 = conflicts
let hasConflicts = false;
let conflictFiles: string[] = [];
try {
  execSync(
    `git merge-tree --write-tree ${baseBranch} ${worktreeBranch}`,
    { cwd: localPath, encoding: "utf-8", timeout: 10000, stdio: "pipe" }
  );
} catch (err: any) {
  hasConflicts = true;
  // Parse conflict file list from stderr/stdout if needed
}
```

**Note:** `git merge-tree --write-tree branch1 branch2` performs a dry-run merge and exits 1 if there are conflicts. The output includes conflict markers. This does NOT modify the working tree.

### Pattern 4: Squash Merge API Route
**What:** POST `/api/tasks/[taskId]/merge` performs squash merge in the main repo (not worktree).
**When to use:** Called when user confirms merge dialog.
**Example:**
```typescript
// In the main repo (task.project.localPath), NOT in the worktree:
execSync(`git checkout ${baseBranch}`, { cwd: localPath, timeout: 10000 });
execSync(`git merge --squash ${worktreeBranch}`, { cwd: localPath, timeout: 30000 });
execSync(`git commit -m "feat: ${task.title}"`, { cwd: localPath, timeout: 10000 });

// Then update task status to DONE
await db.task.update({ where: { id: taskId }, data: { status: "DONE" } });
```

**CRITICAL PITFALL:** The main repo may be on a different branch than `baseBranch`. Must checkout baseBranch first. Also note: if the main repo HEAD has diverged from when the worktree was created, a squash merge may fail — handle gracefully.

### Pattern 5: Send-Back Flow (IN_REVIEW → IN_PROGRESS)
**What:** When user sends a message on an IN_REVIEW task, the stream route detects this and starts a new execution in the same worktree.
**When to use:** Message sent from TaskDetailPanel or task page chat when task.status === "IN_REVIEW".
**Implementation approach:**
- In `stream/route.ts`, before or at start of execution: if `task.status === "IN_REVIEW"`, update task status to `IN_PROGRESS`.
- `createWorktree` already handles reuse (idempotent — returns same path/branch if worktree exists).
- A new `TaskExecution` record is created with same `worktreePath` and `worktreeBranch` values.
- The board refreshes on next `router.refresh()` call.

```typescript
// In stream/route.ts, after successful worktree creation / start of execution:
if (task.status === "IN_REVIEW") {
  await db.task.update({
    where: { id: taskId },
    data: { status: "IN_PROGRESS" },
  });
}
```

### Pattern 6: Diff Parsing (raw git output → structured JSON)
**What:** Parse `git diff --numstat` and `git diff --unified=3` output into a JSON structure.
**Example output from `--numstat`:**
```
5   3   src/lib/worktree.ts
0   1   src/actions/agent-actions.ts
-   -   some/binary/file.png
```
**Example structure:**
```typescript
interface DiffFile {
  filename: string;
  added: number;
  removed: number;
  isBinary: boolean;
  patch: string;    // unified diff for this file only
}

interface DiffResponse {
  files: DiffFile[];
  totalAdded: number;
  totalRemoved: number;
  hasConflicts: boolean;
  conflictFiles: string[];
}
```
**Parsing unified diff per file:** Split on `diff --git a/... b/...` lines. Each split segment is one file's diff content.

### Pattern 7: New Task Page Route
**What:** `src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx` as a server component that fetches task data and passes to client component.
**Layout:** Client component splits into left (chat) and right (tab container) panels.
**Example:**
```typescript
// page.tsx (server)
export default async function TaskPage({ params }) {
  const { workspaceId, taskId } = await params;
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: true, labels: { include: { label: true } } },
  });
  if (!task) notFound();
  return <TaskPageClient task={task} workspaceId={workspaceId} />;
}
```

### Anti-Patterns to Avoid
- **Running git operations on the worktree path for merge:** Squash merge must happen in the main repo `localPath`, not in the worktree. The worktree is the feature branch; the main repo is where you checkout baseBranch and merge.
- **Using `git diff baseBranch worktreeBranch` (two dots):** Use three-dot notation `baseBranch...worktreeBranch` to get only commits on the task branch relative to the merge base. Two-dot compares tip-to-tip and can include unrelated commits on baseBranch.
- **Calling `execSync` without timeout:** Always pass `timeout` — git operations on large repos can hang.
- **Forgetting to revalidatePath after status transitions in API routes:** API routes don't auto-revalidate Next.js cache. Call `revalidatePath("/workspaces")` after DB updates in merge/route.ts. For stream route, the client calls `router.refresh()` after stream completes.
- **Assuming baseBranch is always set:** Some tasks may have `null` baseBranch (NORMAL projects). Diff and merge routes must guard against this.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Diff parsing | Custom diff parser | Shell out to `git diff --numstat` + `--unified=3` and split on `diff --git` headers | Git's diff output format is stable and handles all edge cases (binary files, renames, permissions) |
| Conflict detection | Custom merge logic | `git merge-tree --write-tree` | One command, zero working tree modification, handles all merge strategies |
| Squash commit | Custom git object manipulation | `git merge --squash` + `git commit` | Standard git workflow, handles all edge cases |
| Syntax highlighting | Custom regex | CSS classes on `+`/`-` line prefix | Sufficient visual differentiation with zero bundle cost |

**Key insight:** Every git operation needed for this phase is a standard two-line shell command. The complexity is in the UI and state management, not the git operations.

## Common Pitfalls

### Pitfall 1: Main Repo HEAD Branch Mismatch During Merge
**What goes wrong:** Squash merge is attempted while main repo HEAD is on a different branch than `baseBranch`. `git merge --squash` merges INTO the currently checked-out branch.
**Why it happens:** Main repo may have been left on a different branch from prior work.
**How to avoid:** Always explicitly checkout `baseBranch` before running `git merge --squash` in merge/route.ts.
**Warning signs:** Merge succeeds but commits land on the wrong branch.

### Pitfall 2: Three-Dot vs Two-Dot Diff
**What goes wrong:** `git diff main worktreeBranch` (two dots) includes all commits that diverge, including commits on main that happened after branch creation. Shows irrelevant changes.
**Why it happens:** Confusion between two-dot (diverge from each other) and three-dot (diverge from common ancestor).
**How to avoid:** Always use `git diff baseBranch...worktreeBranch` (three dots) for PR-style diffs.
**Warning signs:** Diff shows files that were not touched by the task.

### Pitfall 3: Stream Route Revalidation
**What goes wrong:** After persistResult transitions task to IN_REVIEW, the Kanban board does not update. Task still shows IN_PROGRESS.
**Why it happens:** Stream route never calls `revalidatePath`. Board refreshes only when the client calls `router.refresh()`.
**How to avoid:** The existing pattern relies on the client-side `handleSend` in `task-detail-panel.tsx` completing the stream and then the user refreshing. For the board to show IN_REVIEW immediately, either (a) the client should call `router.refresh()` after the stream completes, or (b) add an SSE event `{ type: "status_changed", status: "IN_REVIEW" }` so the board can trigger refresh.
**Recommended approach:** Emit `{ type: "status_changed", status: "IN_REVIEW" }` SSE event in persistResult when transitioning, and have the client listen and call `router.refresh()` on receipt.

### Pitfall 4: Worktree Not Found on Send-Back
**What goes wrong:** User sends back for revision but the worktree directory was removed (e.g., manually by user or by Phase 18's cleanup logic).
**Why it happens:** Phase 18 lifecycle cleanup runs after DONE/CANCELLED; but on send-back the task goes back to IN_PROGRESS from IN_REVIEW (not DONE).
**How to avoid:** Phase 17 send-back re-runs `createWorktree`, which handles recreation if the directory is gone but the git branch exists. No explicit worktree-exists check needed.

### Pitfall 5: NULL baseBranch on NORMAL Projects
**What goes wrong:** Diff and merge endpoints crash when `task.baseBranch` is null.
**Why it happens:** NORMAL-type projects have no git configuration.
**How to avoid:** Diff and merge API routes must return a meaningful error (400 + message "Task has no base branch configured") when `task.baseBranch` is null. Client shows a graceful disabled state.

### Pitfall 6: Large Diff Payloads
**What goes wrong:** Very large repos with many changes cause the diff API to time out or return multi-MB responses.
**Why it happens:** `git diff --unified=3` on a large changeset can be enormous.
**How to avoid:** Add a size cap: if patch exceeds 500KB, truncate and add a `truncated: true` flag. The diff view renders truncated notice. The timeout should be at least 30s for large repos.

### Pitfall 7: git merge-tree version compatibility
**What goes wrong:** `git merge-tree --write-tree` was introduced in Git 2.38. Older systems may only have the deprecated three-argument form.
**Why it happens:** The modern form that avoids writing to the index was added in 2.38.
**How to avoid:** Git 2.39.5 is installed on this machine (verified). This is a single-user local tool. Document the Git ≥ 2.38 requirement. If needed, fallback to `git merge --no-commit --no-ff` in a temp branch, check for conflicts, then `git merge --abort`.

## Code Examples

Verified patterns from existing codebase:

### Git execSync Pattern (from git-actions.ts)
```typescript
// Source: src/actions/git-actions.ts
const raw = execSync(
  "git branch --format='%(refname:short)'",
  { cwd: resolved, encoding: "utf-8", timeout: 5000 }
).trim();
```

### API Route Pattern (from api/git/route.ts)
```typescript
// Source: src/app/api/git/route.ts
const opts = { cwd: resolved, encoding: "utf-8" as const, timeout: 5000 };
const raw = execSync("git status --porcelain", opts).trim();
return NextResponse.json({ data });
```

### Worktree Reuse Check (from worktree.ts)
```typescript
// Source: src/lib/worktree.ts
const worktreeList = execSync("git worktree list --porcelain", {
  cwd: localPath, encoding: "utf-8", timeout: 10000,
});
const alreadyExists = worktreeLines.some(
  (line) => line === `worktree ${worktreePath}`
);
if (alreadyExists) {
  return { worktreePath, worktreeBranch };
}
```

### TaskStatus Transition (from task-actions.ts)
```typescript
// Source: src/actions/task-actions.ts
export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const task = await db.task.update({
    where: { id: taskId },
    data: { status },
  });
  revalidatePath("/workspaces");
  return task;
}
```

### Diff Output Structure (git commands to use)
```bash
# File list with +/- line counts
git diff --numstat baseBranch...worktreeBranch

# Full unified diff
git diff --unified=3 baseBranch...worktreeBranch

# Conflict detection (exit code 1 = conflicts)
git merge-tree --write-tree baseBranch worktreeBranch
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Two-dot diff (`git diff A B`) | Three-dot diff (`git diff A...B`) | Standard practice | Shows only task-specific changes |
| git merge-tree (deprecated 3-arg form) | git merge-tree --write-tree (2-arg modern) | Git 2.38 | Cleaner dry-run, no index contamination |

## Open Questions

1. **Board refresh after IN_REVIEW transition**
   - What we know: stream/route.ts doesn't call revalidatePath; client calls router.refresh() after the stream finishes
   - What's unclear: Does the existing `task-detail-panel.tsx` call router.refresh() after stream completes? Looking at the code — it does not.
   - Recommendation: Emit `{ type: "status_changed", status: "IN_REVIEW" }` SSE event in persistResult and have the client-side handleSend in task-detail-panel.tsx trigger `router.refresh()` on receipt. This is the minimum-touch fix.

2. **Task page layout and the task-detail-panel drawer coexistence**
   - What we know: D-03 says add "View Details" button to existing drawer to navigate to task page
   - What's unclear: When user is on the task page and sends a message to trigger send-back, should navigating back to the board show the panel still open?
   - Recommendation: Independent UX concern — the task page is a full route, so navigating back to the board resets panel state naturally. No special handling needed.

3. **Main repo HEAD after merge**
   - What we know: After squash merge, main repo is on baseBranch with the squash commit
   - What's unclear: Should we reset it back to the original HEAD branch after merge? This could break the user's working state.
   - Recommendation: Do NOT reset HEAD. The squash merge happens on baseBranch — if the main repo was already on baseBranch, it's fine. If it wasn't, we checkout baseBranch, merge, and leave it there. Document this behavior.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| git | Diff, conflict detection, squash merge | Yes | 2.39.5 | — |
| Node.js child_process | execSync for git ops | Yes | Built-in | — |
| Next.js App Router dynamic routes | Task page `/tasks/[taskId]` | Yes | 16.2.1 | — |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/unit` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MR-01 | persistResult transitions task to IN_REVIEW on exitCode=0 | unit | `npx vitest run tests/unit/api/stream-persist-result.test.ts -x` | No — Wave 0 |
| MR-01 | Diff API returns structured file list | unit | `npx vitest run tests/unit/api/diff-route.test.ts -x` | No — Wave 0 |
| MR-02 | Merge API performs squash merge + status DONE | unit | `npx vitest run tests/unit/api/merge-route.test.ts -x` | No — Wave 0 |
| MR-03 | Conflict detection returns hasConflicts=true | unit | `npx vitest run tests/unit/api/merge-route.test.ts -x` | No — Wave 0 |
| RV-01 | Sending message on IN_REVIEW task transitions to IN_PROGRESS | unit | `npx vitest run tests/unit/api/stream-send-back.test.ts -x` | No — Wave 0 |
| RV-02 | createWorktree reuses existing worktree on send-back | unit | `npx vitest run tests/unit/lib/worktree.test.ts -x` | Yes — existing |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/unit`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/api/stream-persist-result.test.ts` — covers MR-01 (IN_REVIEW transition in persistResult)
- [ ] `tests/unit/api/diff-route.test.ts` — covers MR-01 (diff API response shape)
- [ ] `tests/unit/api/merge-route.test.ts` — covers MR-02, MR-03
- [ ] `tests/unit/api/stream-send-back.test.ts` — covers RV-01 (send-back transition)

Note: `tests/unit/lib/worktree.test.ts` already exists and covers the createWorktree reuse logic (RV-02).

## Project Constraints (from CLAUDE.md)

From `AGENTS.md` (included via `@AGENTS.md` in CLAUDE.md):
- This is Next.js 16.2.1 — read `node_modules/next/dist/docs/` before writing routing or API code
- Task.baseBranch is on Task (not TaskExecution) — branch choice is per-task
- Cascade deletes are defined — Task deletion cascades to Executions and Messages
- Label replacement is full-replace, not merge
- TaskStatus enum includes IN_REVIEW already — no schema migration needed

From `rules/typescript/`:
- Use Zod for all API route request validation
- No `console.log` in production code — use no logging or a logger
- Immutable patterns: spread operator for updates, never mutate
- Functions under 50 lines, files under 800 lines
- Error handling: explicit try/catch at every level, never swallow errors

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `src/app/api/tasks/[taskId]/stream/route.ts` — persistResult function, worktree integration
- Direct codebase inspection: `src/lib/worktree.ts` — createWorktree with reuse logic
- Direct codebase inspection: `src/actions/git-actions.ts` — execSync pattern
- Direct codebase inspection: `src/app/api/git/route.ts` — API route pattern
- Direct codebase inspection: `prisma/schema.prisma` — TaskStatus.IN_REVIEW already exists, Task.baseBranch exists
- Direct codebase inspection: `tests/unit/lib/worktree.test.ts` — test pattern for git mocking
- Shell verification: `git --version` = 2.39.5, `git merge-tree --help` confirms modern mode available
- Shell verification: `git diff --numstat HEAD~2...HEAD` confirmed working output format

### Secondary (MEDIUM confidence)
- Git documentation: `git merge-tree --write-tree` modern mode introduced Git 2.38 (verified machine has 2.39.5)
- Git documentation: Three-dot diff notation behavior verified with local git command

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in project, no new packages needed
- Architecture: HIGH — patterns derived directly from existing codebase
- Pitfalls: HIGH — derived from codebase analysis and git command verification
- Git operations: HIGH — commands tested in shell

**Research date:** 2026-03-31
**Valid until:** 2026-04-30 (stable stack, git behavior)
