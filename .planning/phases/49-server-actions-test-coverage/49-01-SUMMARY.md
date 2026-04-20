---
phase: 49-server-actions-test-coverage
plan: 01
subsystem: testing
tags: [vitest, unit-tests, server-actions, prisma, zod, fts]

# Dependency graph
requires: []
provides:
  - workspace-actions unit tests (CRUD, type derivation, getWorkspacesWithProjects)
  - label-actions unit tests (builtin protection, setTaskLabels full-replace)
  - note-actions unit tests (FTS sync/cleanup, category default, query filters)
affects: [phase-50-mcp-tools-test-coverage, phase-51-core-lib-test-coverage]

# Tech tracking
tech-stack:
  added: []
  patterns: [vi.mock hoisting before imports, transaction fn mock via mockImplementation, call-order tracking with array push]

key-files:
  created:
    - src/actions/__tests__/workspace-actions.test.ts
    - src/actions/__tests__/label-actions.test.ts
    - src/actions/__tests__/note-actions.test.ts
  modified: []

key-decisions:
  - "Mock db at module boundary with vi.mock before imports — ensures all action imports see mocked db"
  - "Track deleteNoteFromFts call order via array push in mockImplementation to verify FTS cleanup happens before DB delete"
  - "Cast db mock to typed object to avoid TypeScript any complaints in tests"

patterns-established:
  - "vi.mock('@/lib/db') pattern: declare all needed Prisma model methods as vi.fn() in factory"
  - "Transaction mock pattern: mockDb.$transaction.mockImplementation(async (fn) => fn(mockTx)) with local mockTx"
  - "Call-order verification: use callOrder array with push in mockImplementation, assert order afterward"

requirements-completed: [COV-01, COV-02, COV-03]

# Metrics
duration: 6min
completed: 2026-04-20
---

# Phase 49 Plan 01: Server Actions Test Coverage (workspace, label, note) Summary

**37 unit tests across 3 server action modules — CRUD, builtin label protection, setTaskLabels full-replace, FTS sync order verification**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-20T07:00:00Z
- **Completed:** 2026-04-20T07:04:03Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- workspace-actions: 12 tests covering getWorkspacesWithProjects (orderBy), getWorkspaceById (nested shape), createWorkspace (Zod validation), updateWorkspace (partial), deleteWorkspace, createProject (GIT/NORMAL type derivation), getWorkspacesWithRecentTasks (tasks+executions shape)
- label-actions: 10 tests covering getLabelsForWorkspace (OR query), createLabel (hex color validation), deleteLabel (happy path, builtin protection, not found), setTaskLabels (full-replace with non-empty, deleteMany-only with empty), getTaskLabels (label mapping)
- note-actions: 15 tests covering createNote (syncNoteToFts called after, category default "备忘", Zod validation), updateNote (syncNoteToFts with updated data), deleteNote (deleteNoteFromFts BEFORE db.delete verified via call-order tracking), getNoteById, getProjectNotes (taskId:null, category filter), getTaskNotes

## Task Commits

1. **Task 1: workspace-actions and label-actions tests** - `a80309e` (test)
2. **Task 2: note-actions tests** - `eabaa49` (test)

## Files Created/Modified

- `src/actions/__tests__/workspace-actions.test.ts` - 12 unit tests for workspace and project CRUD actions
- `src/actions/__tests__/label-actions.test.ts` - 10 unit tests for label CRUD including builtin protection and setTaskLabels
- `src/actions/__tests__/note-actions.test.ts` - 15 unit tests for note CRUD with FTS sync/cleanup verification

## Decisions Made

- Used `vi.mock` hoisting pattern (declare before imports) to ensure db mock is in scope when action modules are loaded
- Transaction mocking: `mockDb.$transaction.mockImplementation(async (fn) => fn(mockTx))` with a local `mockTx` object that has its own vi.fn() for each Prisma model method
- For `deleteNote` call-order verification: injected array push into both mocks and asserted the resulting array equals `["deleteNoteFromFts", "db.delete"]`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- COV-01, COV-02, COV-03 requirements complete
- Pattern established for mocking Prisma db in server action tests — reuse in Phase 49 plans 02 and 03 (task-actions, prompt-actions, agent-actions)
- No blockers

## Self-Check: PASSED

- FOUND: src/actions/__tests__/workspace-actions.test.ts
- FOUND: src/actions/__tests__/label-actions.test.ts
- FOUND: src/actions/__tests__/note-actions.test.ts
- FOUND commit: a80309e (workspace-actions and label-actions tests)
- FOUND commit: eabaa49 (note-actions tests)

---
*Phase: 49-server-actions-test-coverage*
*Completed: 2026-04-20*
