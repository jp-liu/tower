# Phase 18: Worktree Lifecycle - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-31
**Phase:** 18-worktree-lifecycle
**Areas discussed:** Cleanup trigger, Failure handling, Startup mechanism, Branch deletion scope
**Mode:** Auto (--auto flag — recommended defaults selected)

---

## Cleanup Trigger Point

| Option | Description | Selected |
|--------|-------------|----------|
| In removeWorktree() called from merge route + updateTaskStatus | Dedicated function called at both transition points (DONE via merge, CANCELLED via status update) | ✓ |
| Post-transition async job | Queue cleanup as a background job after status change | |
| Database trigger / Prisma middleware | Intercept status changes at ORM level | |

**User's choice:** [auto] In removeWorktree() called from merge route + updateTaskStatus (recommended default)
**Notes:** Covers both DONE (merge route) and CANCELLED (updateTaskStatus) paths. Direct call is simpler than async job for a local tool.

---

## Failure Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Log and continue | Log error, don't block status transition | ✓ |
| Block transition | Fail the status change if cleanup fails | |
| Retry with backoff | Attempt cleanup multiple times before giving up | |

**User's choice:** [auto] Log and continue (recommended default)
**Notes:** Cleanup is best-effort. Startup prune (LC-02) acts as safety net. Blocking a DONE/CANCELLED transition for a filesystem error would be a worse UX than leaving an orphaned directory.

---

## Startup Prune Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| instrumentation.ts register() | Next.js official server startup hook, runs once | ✓ |
| Root layout first render | Run in server component on first request | |
| Separate CLI script | Run via package.json prestart script | |

**User's choice:** [auto] instrumentation.ts register() (recommended default)
**Notes:** Official Next.js mechanism for server-startup side effects. No repeated execution, no race conditions with requests.

---

## Branch Deletion Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full cleanup (worktree + branch) | git worktree remove + git branch -D | ✓ |
| Worktree only | Remove directory, keep branch for reference | |
| Prune only | Just git worktree prune, leave directories | |

**User's choice:** [auto] Full cleanup — worktree directory + branch (recommended default)
**Notes:** Task-specific branches have no value after DONE/CANCELLED. Full cleanup avoids branch accumulation.

---

## Claude's Discretion

- Error logging format and detail level
- git worktree remove --force vs plain remove
- Operation ordering in removeWorktree
- Whether startup prune also cleans orphaned branches

## Deferred Ideas

None — discussion stayed within phase scope
