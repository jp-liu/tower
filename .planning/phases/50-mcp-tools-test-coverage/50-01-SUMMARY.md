---
phase: 50-mcp-tools-test-coverage
plan: 01
subsystem: testing
tags: [vitest, mcp, task-tools, project-tools, unit-tests, mocking]

requires:
  - phase: 49-server-actions-test-coverage
    provides: vi.mock hoisting pattern, mockTx defined before vi.mock, db mock structure

provides:
  - Unit tests for task-tools.ts MCP handlers (14 tests)
  - Unit tests for project-tools.ts MCP handlers (6 tests)
  - Pattern for mocking Node.js built-in modules (fs, child_process) in Vitest with node environment

affects: [51-core-lib-test-coverage, 52-hooks-logic-extraction]

tech-stack:
  added: []
  patterns:
    - "Use // @vitest-environment node for MCP tool tests (avoids jsdom interference with node built-in mocks)"
    - "vi.mock('../../db') from tools/__tests__/ resolves to src/mcp/db.ts — two levels up from __tests__"
    - "Node built-in mocks (fs, child_process) require simple factory without importOriginal when using node environment"

key-files:
  created:
    - src/mcp/tools/__tests__/task-tools.test.ts
    - src/mcp/tools/__tests__/project-tools.test.ts
  modified: []

key-decisions:
  - "// @vitest-environment node required for tests in src/**/__tests__/ that mock Node.js built-ins (fs, child_process) — jsdom environment prevents mock interception"
  - "vi.mock path from tools/__tests__/ must be ../../db (not ../db) to resolve to src/mcp/db.ts"
  - "Simple factory mock for fs/child_process (no importOriginal) works correctly in node environment"

patterns-established:
  - "MCP tool test pattern: // @vitest-environment node + vi.mock('../../db') + vi.mock('fs'/'child_process') with simple factory"

requirements-completed: [COV-08, COV-09]

duration: 10min
completed: 2026-04-20
---

# Phase 50 Plan 01: MCP Tools Test Coverage Summary

**Unit tests for task-tools and project-tools MCP handlers: 20 tests covering CRUD, reference file copy with UUID stripping, worktree git detection, autoStart fetch, label transactions, and type derivation from gitUrl**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-20T07:15:19Z
- **Completed:** 2026-04-20T07:25:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- task-tools.ts: 14 tests covering list (label flattening, status filter), create (defaults, labelIds, reference copy with UUID stripping, collision counter, worktree git detection, autoStart fetch), update (label replacement transaction order), move, delete
- project-tools.ts: 6 tests covering list (taskCount/repositoryCount from array lengths), create (type=GIT/NORMAL derived from gitUrl, alias passthrough), update (projectId excluded from data), delete
- Established MCP tool test pattern using `// @vitest-environment node` to enable Node.js built-in module mocking

## Task Commits

1. **Task 1: task-tools.ts unit tests** - `f90102d` (test)
2. **Task 2: project-tools.ts unit tests** - `46f5d41` (test)

## Files Created/Modified

- `src/mcp/tools/__tests__/task-tools.test.ts` - 14 unit tests for task CRUD MCP handlers (411 lines)
- `src/mcp/tools/__tests__/project-tools.test.ts` - 6 unit tests for project CRUD MCP handlers (182 lines)

## Decisions Made

- `// @vitest-environment node` directive required at top of test files in `src/**/__tests__/` that mock Node.js built-ins — the default jsdom environment prevents `vi.mock("fs")` and `vi.mock("child_process")` from intercepting imports in the module under test
- `vi.mock("../../db")` (two levels up from `__tests__/`) correctly resolves to `src/mcp/db.ts` even though `task-tools.ts` uses `"../db"` — both resolve to the same absolute path
- Simple factory mock (`vi.mock("fs", () => ({ existsSync: vi.fn() }))`) without `importOriginal` is sufficient and correct in node environment

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Discovered existing workspace-tools.test.ts in __tests__/ also failed**
- **Found during:** Task 1 (initial test run)
- **Issue:** All tests in `src/mcp/tools/__tests__/` fail because they use `vi.mock("../db")` from the `__tests__/` subdirectory, which resolves to `src/mcp/tools/db` (non-existent). The correct path is `../../db`. The existing workspace-tools/report-tools/label-tools tests in that directory also have this bug.
- **Fix:** Used `../../db` in new test files; did not modify existing test files (out of scope)
- **Files modified:** Both new test files use `../../db`
- **Verification:** Tests pass with correct path
- **Committed in:** f90102d, 46f5d41

**2. [Rule 1 - Bug] Node built-in mock interception requires node environment**
- **Found during:** Task 1 (reference file and execFileSync tests failing)
- **Issue:** With jsdom environment (default), `vi.mock("fs")` and `vi.mock("child_process")` are set up in the test context but the module under test (`task-tools.ts`) still receives the real Node.js module implementations — mock interception fails silently
- **Fix:** Added `// @vitest-environment node` at top of test file
- **Files modified:** src/mcp/tools/__tests__/task-tools.test.ts
- **Verification:** 14/14 tests pass after adding directive
- **Committed in:** f90102d

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both fixes necessary for test correctness. No scope creep.

## Issues Encountered

- Existing test files in `src/mcp/tools/__tests__/` (workspace-tools, report-tools, label-tools) have the same `../db` path bug and will fail when run. These are pre-existing issues out of scope for this plan.

## Next Phase Readiness

- task-tools and project-tools MCP handlers now have full unit test coverage (COV-08, COV-09)
- Node environment + `../../db` pattern established for remaining MCP tool tests in Phase 50 plans 02-03
- Pre-existing failing tests in workspace-tools/report-tools/label-tools need path fix (deferred to Phase 50 plan 02 or 03)

---
*Phase: 50-mcp-tools-test-coverage*
*Completed: 2026-04-20*
