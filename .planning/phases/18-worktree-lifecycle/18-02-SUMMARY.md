---
phase: 18-worktree-lifecycle
plan: "02"
subsystem: instrumentation
tags: [worktree, startup, pruning, next.js, instrumentation]
dependency_graph:
  requires: []
  provides: [LC-02]
  affects: [server-startup]
tech_stack:
  added: []
  patterns: [Next.js instrumentation.ts, execSync git ops, dynamic imports for Edge safety]
key_files:
  created:
    - src/instrumentation.ts
    - tests/unit/lib/instrumentation.test.ts
  modified: []
decisions:
  - "Dynamic imports inside register() prevent Edge runtime import errors"
  - "initDb() called before DB query to ensure WAL/busy_timeout PRAGMAs are set"
  - "Per-project try/catch isolates failures so one broken project doesn't block others"
  - "Top-level try/catch ensures DB connection failures never block server startup"
  - "src/instrumentation.ts chosen over root-level — consistent with project src/ convention"
metrics:
  duration: 246s
  completed: "2026-03-31T06:55:44Z"
  tasks_completed: 1
  files_changed: 2
---

# Phase 18 Plan 02: Startup Worktree Prune Summary

**One-liner:** Next.js instrumentation.ts register() that runs `git worktree prune` for all GIT projects at server startup using dynamic imports, initDb(), and per-project error isolation.

## What Was Built

Added `src/instrumentation.ts` with a `register()` export that hooks into the Next.js server startup lifecycle to prune orphaned worktree metadata entries. This acts as a safety net for any worktrees missed during normal task lifecycle cleanup (crashes, force-killed servers).

The implementation:
- Gates execution to `NEXT_RUNTIME === "nodejs"` to skip Edge runtime
- Calls `initDb()` before querying to ensure SQLite WAL/busy_timeout PRAGMAs are set
- Queries all GIT-type projects with non-null `localPath`
- Runs `git worktree prune` in each project's directory via `execSync`
- Wraps each project in its own try/catch — one failure does not block others
- Wraps the entire function in a top-level try/catch — DB failures do not block startup

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create instrumentation.ts with startup prune and unit tests | 5bb3057 | src/instrumentation.ts, tests/unit/lib/instrumentation.test.ts |

## Verification

- [x] `src/instrumentation.ts` exists with `export async function register()`
- [x] Contains `process.env.NEXT_RUNTIME === "nodejs"` guard
- [x] Contains `await initDb()` before DB query
- [x] Contains `db.project.findMany` with `type: "GIT"` and `localPath: { not: null }`
- [x] Contains `execSync("git worktree prune", ...)` call
- [x] Contains per-project try/catch (inner) and top-level try/catch (outer)
- [x] 5 unit tests all pass: startup query, edge skip, failure isolation, DB error, no projects

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- `src/instrumentation.ts`: FOUND
- `tests/unit/lib/instrumentation.test.ts`: FOUND
- Commit `5bb3057`: FOUND
- 5 instrumentation tests passing (248 total passed vs 243 before)
