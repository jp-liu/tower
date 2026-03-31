---
phase: 15-schema-cleanup
plan: 01
subsystem: database-schema
tags: [prisma, schema, git-worktree, server-actions, unit-tests]
dependency_graph:
  requires: []
  provides: [baseBranch-on-Task, worktreePath-on-TaskExecution, worktreeBranch-on-TaskExecution, getProjectBranches-action]
  affects: [src/actions/task-actions.ts, src/actions/agent-actions.ts, prisma/schema.prisma]
tech_stack:
  added: [git-actions.ts]
  patterns: [vi.mock-next-cache-in-tests]
key_files:
  created:
    - src/actions/git-actions.ts
    - tests/unit/actions/task-actions.test.ts
    - tests/unit/actions/agent-actions.test.ts
    - tests/unit/actions/git-actions.test.ts
  modified:
    - prisma/schema.prisma
    - src/actions/task-actions.ts
    - src/actions/agent-actions.ts
decisions:
  - "Mock next/cache (vi.mock) in unit tests — revalidatePath fails outside Next.js runtime"
  - "db:push --accept-data-loss not needed — columns already existed in shared DB from worktree setup"
  - "Pre-existing TypeScript error in agent-config-actions.ts (InputJsonValue) deferred — out of scope"
metrics:
  duration: 344s
  completed: "2026-03-31"
  tasks: 2
  files: 7
---

# Phase 15 Plan 01: Schema Fields & Git Actions Summary

**One-liner:** Added nullable `baseBranch` to Task, `worktreePath`/`worktreeBranch` to TaskExecution, and a `getProjectBranches` server action for branch listing — the data foundation for Phase 16 worktree automation.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add schema fields and extend server actions | 9fdb41c | prisma/schema.prisma, task-actions.ts, agent-actions.ts, 2 test files |
| 2 | Create getProjectBranches server action | 49703db | src/actions/git-actions.ts, git-actions.test.ts |

## Decisions Made

1. **Mock `next/cache` in unit tests** — Server actions that call `revalidatePath` throw "static generation store missing" error in vitest node environment. Added `vi.mock("next/cache", ...)` to all new test files. The existing `config-actions.test.ts` pattern didn't have this issue because config-actions doesn't call `revalidatePath`.

2. **Schema columns already in DB** — Running `pnpm db:push` showed columns `baseBranch`, `worktreePath`, `worktreeBranch` already existed in the shared SQLite database (applied by the main project worktree previously). Only `pnpm db:generate` was needed to regenerate the Prisma client types.

3. **Pre-existing TypeScript build error deferred** — `agent-config-actions.ts` has a pre-existing `InputJsonValue` type error that predates this plan. Logged to `deferred-items.md` as out-of-scope.

## Verification Results

- `pnpm db:generate` — success
- `pnpm vitest run tests/unit/actions/task-actions.test.ts tests/unit/actions/agent-actions.test.ts tests/unit/actions/git-actions.test.ts` — 9/9 tests pass
- `pnpm vitest run` — 246/257 tests pass (11 pre-existing failures in `board-stats.test.tsx` and `prompts-config.test.tsx` due to `useRouter` not mounted — unrelated to this plan)
- `pnpm build` — fails on pre-existing `agent-config-actions.ts` TypeScript error (out of scope)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Mock next/cache in unit tests**
- **Found during:** Task 1
- **Issue:** `revalidatePath` from `next/cache` throws "Invariant: static generation store missing" error when called outside Next.js App Router context (i.e., in vitest node environment)
- **Fix:** Added `vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))` at the top of both `task-actions.test.ts` and `agent-actions.test.ts`
- **Files modified:** `tests/unit/actions/task-actions.test.ts`, `tests/unit/actions/agent-actions.test.ts`
- **Commits:** 9fdb41c

### Deferred Items

- Pre-existing TypeScript error in `src/actions/agent-config-actions.ts:25` — `Prisma.InputJsonValue` type incompatibility with SQLite string field. Logged to `.planning/phases/15-schema-cleanup/deferred-items.md`.
- Pre-existing test failures in `board-stats.test.tsx` (3 tests) and `prompts-config.test.tsx` (8 tests) due to `useRouter` needing App Router context — unrelated to this plan.

## Known Stubs

None. All new fields are properly wired through the Prisma schema to the server action parameters.
