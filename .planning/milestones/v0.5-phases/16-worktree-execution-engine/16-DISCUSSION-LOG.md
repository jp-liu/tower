# Phase 16: Worktree Execution Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-31
**Phase:** 16-worktree-execution-engine
**Areas discussed:** Branch Selector UI, Worktree Creation Timing, Non-GIT Project Handling, Worktree Creation Failure
**Mode:** Auto (--auto flag)

---

## Branch Selector UI

### Q1: Where should the base branch selector appear?

| Option | Description | Selected |
|--------|-------------|----------|
| In create-task-dialog, below priority | Consistent placement, only for GIT projects | [auto] |
| Separate dialog step | Additional step before task creation | |
| In task detail panel | Set branch later, before first execution | |

**User's choice:** [auto] In create-task-dialog, below priority selector, only for GIT-type projects
**Notes:** Follows existing dialog layout. Branch selector hidden for NORMAL projects.

### Q2: What should the default selected branch be?

| Option | Description | Selected |
|--------|-------------|----------|
| First branch from getProjectBranches | Typically main/master | [auto] |
| Detect HEAD and use current branch | More context-aware | |
| No default, require explicit selection | Forces intentional choice | |

**User's choice:** [auto] First branch returned by getProjectBranches (typically main/master)
**Notes:** Simple and predictable. getProjectBranches already returns branches sorted.

### Q3: How to handle branch loading?

| Option | Description | Selected |
|--------|-------------|----------|
| Async fetch on dialog open | Load when dialog opens, show spinner | [auto] |
| Pre-fetch when project is selected | Faster UX, more network calls | |
| Lazy fetch on selector focus | Delayed but minimal overhead | |

**User's choice:** [auto] Async fetch on dialog open when project has localPath; show loading state
**Notes:** Balance between UX and simplicity.

### Q4: Should editing a task allow changing baseBranch?

| Option | Description | Selected |
|--------|-------------|----------|
| No — locked after creation | Safe, prevents mid-execution confusion | [auto] |
| Yes — editable anytime | Flexible but risky | |
| Only when no executions exist | Compromise | |

**User's choice:** [auto] No — baseBranch is set at creation and locked afterward
**Notes:** Changing baseBranch mid-execution would be dangerous. Worktree already created based on original branch.

---

## Worktree Creation Timing

### Q1: When should the worktree be created?

| Option | Description | Selected |
|--------|-------------|----------|
| At execution start (lazy) | No orphaned worktrees, created only when needed | [auto] |
| At task creation (eager) | Worktree ready before execution, faster start | |
| First time task moves to IN_PROGRESS | Middle ground | |

**User's choice:** [auto] At execution start in stream route, before adapter.execute()
**Notes:** Lazy creation avoids orphaned worktrees for tasks that are never executed.

### Q2: Where to put the worktree creation logic?

| Option | Description | Selected |
|--------|-------------|----------|
| New src/lib/worktree.ts module | Testable, keeps stream route thin | [auto] |
| Inline in stream route | Simple but bloats the route | |
| In git-actions.ts | Groups git operations | |

**User's choice:** [auto] New utility module src/lib/worktree.ts
**Notes:** Keeps stream route thin and makes worktree logic independently testable.

---

## Non-GIT Project Handling

### Q1: How do NORMAL projects behave?

| Option | Description | Selected |
|--------|-------------|----------|
| Branch selector hidden, no worktree | Zero behavior change for non-GIT | [auto] |
| Show disabled branch selector | Visual hint that feature exists | |
| Block execution for non-GIT | Force all projects to use git | |

**User's choice:** [auto] Branch selector hidden, no worktree created, cwd uses project localPath as before
**Notes:** Non-GIT projects should work exactly as before — no regression.

---

## Worktree Creation Failure

### Q1: What happens when git worktree add fails?

| Option | Description | Selected |
|--------|-------------|----------|
| Fail with clear error message | Explicit, safe | [auto] |
| Fall back to project root | Silently degrade | |
| Retry once, then fail | Handles transient issues | |

**User's choice:** [auto] Fail the execution with clear error message sent as SSE error event
**Notes:** No silent fallback — running Claude in the wrong directory is worse than failing explicitly.

---

## Claude's Discretion

- Worktree path format: `{localPath}/.worktrees/task-{taskId}/` (pre-decided in v0.5 milestone)
- Branch name format: `task/{taskId}` (pre-decided in v0.5 milestone)
- Worktree reuse logic (if task was previously executed)
- i18n key naming for new branch selector UI strings

## Deferred Ideas

None — discussion stayed within phase scope
