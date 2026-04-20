---
phase: 47-failing-test-fixes
plan: 01
subsystem: testing
tags: [vitest, pty-session, preview-process, instrumentation, unit-tests]

# Dependency graph
requires: []
provides:
  - pty-session unit tests passing with setExitListener API
  - preview-process-manager unit tests passing with .on() mock
  - preview-actions unit tests passing (unref test removed)
  - instrumentation unit tests passing with new module structure mocks
affects: [48-security-hardening, 49-server-actions-coverage]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mock at module boundary (instrumentation-tasks) not at transitive dependency level"
    - "vi.resetModules() + dynamic import for fresh module state per test"

key-files:
  created: []
  modified:
    - tests/unit/lib/pty-session.test.ts
    - tests/unit/lib/preview-process-manager.test.ts
    - tests/unit/actions/preview-actions.test.ts
    - tests/unit/lib/instrumentation.test.ts

key-decisions:
  - "Use setExitListener (not addExitListener) in pty-session test — API changed to replace semantics"
  - "instrumentation.test.ts mocks @/lib/instrumentation-tasks module boundary directly, not child_process/db"
  - "Removed unref test since startPreview no longer calls child.unref() — intentional behavior removal"
  - "instrumentation error handling tests verify propagation since register() has no try/catch"

patterns-established:
  - "When mocking refactored modules, mock the new abstraction layer, not old internal dependencies"
  - "setExitListener replaces previous exit listeners — tests should only assert on the last-set listener"

requirements-completed: [TEST-01, TEST-02, TEST-03]

# Metrics
duration: 5min
completed: 2026-04-20
---

# Phase 47 Plan 01: Failing Test Fixes Summary

**Fixed 11 test failures across 4 files by aligning tests with API changes: setExitListener, .on() mock, unref removal, and instrumentation module refactoring**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-20T06:28:00Z
- **Completed:** 2026-04-20T06:33:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Fixed pty-session.test.ts: replaced addExitListener with setExitListener, updated test semantics
- Fixed preview-process-manager.test.ts: added `on: vi.fn()` to makeFakeChild helper (5 tests were failing)
- Fixed preview-actions.test.ts: removed unref test since startPreview no longer calls child.unref()
- Rewrote instrumentation.test.ts: now mocks @/lib/instrumentation-tasks, @/lib/pty/ws-server, and @/lib/init-tower matching refactored module structure

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix pty-session and preview-process-manager tests** - `c69d996` (fix)
2. **Task 2: Fix preview-actions and instrumentation tests** - `4169a7a` (fix)

## Files Created/Modified
- `tests/unit/lib/pty-session.test.ts` - Updated exit listener test to use setExitListener API
- `tests/unit/lib/preview-process-manager.test.ts` - Added `on: vi.fn()` to makeFakeChild
- `tests/unit/actions/preview-actions.test.ts` - Removed unref test and unref from fake child helper
- `tests/unit/lib/instrumentation.test.ts` - Fully rewritten to mock new module-level abstraction

## Decisions Made
- instrumentation.test.ts error tests verify that errors propagate (register() has no try/catch), not that they resolve gracefully — the internal try/catch is inside instrumentation-tasks.ts functions, not in register() itself
- Removed both "continues to next project" and "completes without error when no GIT projects" tests — these tested internal implementation details now encapsulated in instrumentation-tasks.ts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 4 target test files now pass
- 11 test failures resolved (27 → 16 remaining failing tests)
- Ready for Phase 47 Plan 02 (remaining failing test files)

## Self-Check: PASSED

All files exist and commits verified.

---
*Phase: 47-failing-test-fixes*
*Completed: 2026-04-20*
