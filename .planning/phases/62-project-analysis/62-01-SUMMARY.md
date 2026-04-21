---
phase: 62-project-analysis
plan: 01
subsystem: api
tags: [server-actions, child_process, execFile, i18n, claude-cli, tdd]

# Dependency graph
requires:
  - phase: 61-form-ux
    provides: tilde path guard pattern (reused for localPath validation)
  - phase: 57-project-import-migration
    provides: project-actions.ts base file with checkMigrationSafety/migrateProjectPath
provides:
  - analyzeProjectDirectory server action in src/actions/project-actions.ts
  - 4 i18n keys for generate-description UI (project.genDesc, project.analyzing, project.analyzeError, project.genDescDisabledTooltip)
  - 7 unit tests covering all error branches and env isolation
affects: [62-project-analysis/62-02, ui-for-generate-description]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - vi.hoisted() for child_process mock in jsdom environment
    - execFile with minimal env object (PATH, HOME, USER, TMPDIR, TERM only)
    - Tilde/empty path guard before CLI invocation

key-files:
  created:
    - .planning/phases/62-project-analysis/62-01-SUMMARY.md
  modified:
    - src/actions/project-actions.ts
    - src/actions/__tests__/project-actions.test.ts
    - src/lib/i18n/zh.ts
    - src/lib/i18n/en.ts

key-decisions:
  - "vi.hoisted() required for child_process mock in jsdom environment — mock factory runs before const declarations"
  - "child_process mock needs explicit default export in jsdom environment (unlike node environment)"
  - "execFile env isolation: pass only 5 safe env vars (PATH/HOME/USER/TMPDIR/TERM), no DATABASE_URL/NODE_OPTIONS leak"
  - "execFile errors propagate as rejections (not silently swallowed) — caller handles via toast"

patterns-established:
  - "child_process mock pattern: vi.hoisted() + explicit default export for jsdom test environment"
  - "env isolation: always pass explicit env object to execFile with minimal set of vars"

requirements-completed: [ANALYZE-01, ANALYZE-02, ANALYZE-03, ANALYZE-04]

# Metrics
duration: 9min
completed: 2026-04-21
---

# Phase 62 Plan 01: Project Analysis — Server Action Summary

**`analyzeProjectDirectory` server action with Claude CLI one-shot invocation, env isolation, full input validation, and 7 unit tests; 4 i18n keys added to zh/en locales**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-21T14:13:19Z
- **Completed:** 2026-04-21T14:22:14Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `analyzeProjectDirectory(localPath)` exported from `src/actions/project-actions.ts` — calls `claude -p <prompt> --no-session-persistence --max-turns 1` with `cwd: localPath`
- Input validation: empty/non-string → `无效的本地路径`; tilde prefix → `不支持 ~ 别名，请提供绝对路径`
- Env isolation: only `PATH`, `HOME`, `USER`, `TMPDIR`, `TERM` passed to CLI — no `DATABASE_URL` or `NODE_OPTIONS` leak
- 7 unit tests passing (path validation, execFile call verification, stdout success, error propagation, env key check)
- 4 i18n keys in both `zh.ts` and `en.ts` for generate-description UI

## Task Commits

1. **Task 1 RED: failing tests** - `a01b283` (test)
2. **Task 1 GREEN: implementation** - `bb61ce4` (feat)
3. **Task 2: i18n keys** - `26851d7` (feat)

## Files Created/Modified
- `src/actions/project-actions.ts` - Added `analyzeProjectDirectory` function with `execFile` import
- `src/actions/__tests__/project-actions.test.ts` - Added 7 new tests in `describe("analyzeProjectDirectory")` block with `vi.hoisted()` mock
- `src/lib/i18n/zh.ts` - 4 new project.genDesc* keys
- `src/lib/i18n/en.ts` - 4 new project.genDesc* keys (English translations)

## Decisions Made
- `vi.hoisted()` is required to use a shared mock function reference inside a `vi.mock()` factory that runs before module-scope `const` declarations. This is the correct vitest pattern for jsdom environment.
- The `child_process` mock needs an explicit `default` key in jsdom environment because Node CJS modules expose a `default` property that vitest checks in browser-like environments.
- Error propagation pattern: `execFile` errors are rejected (not silently resolved with null like `generateSummaryFromLog`) — the caller handles toast display.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed child_process mock setup for jsdom environment**
- **Found during:** Task 1 RED phase (test run)
- **Issue:** `vi.mock("child_process", () => ({ execFile: vi.fn() }))` failed with "No default export" in jsdom. Then `vi.mock("child_process", async (importOriginal) => {...})` failed with "Cannot access 'mockExecFileFn' before initialization" because mock factory is hoisted before const declarations.
- **Fix:** Used `vi.hoisted(() => vi.fn())` for the shared fn reference, and added explicit `default: { execFile: mockExecFileFn }` in the mock factory.
- **Files modified:** `src/actions/__tests__/project-actions.test.ts`
- **Verification:** All 7 tests pass
- **Committed in:** a01b283 (RED commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug in mock setup pattern)
**Impact on plan:** Required to make child_process mock work correctly. Established the correct pattern for future tests using child_process in jsdom environment.

## Issues Encountered
- Mock hoisting with jsdom required two iterations: first attempt used `importOriginal` which works in node environment but not jsdom; second attempt with `vi.hoisted()` resolved both the initialization order and default export issues.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `analyzeProjectDirectory` ready for UI consumption in Phase 62 Plan 02
- i18n keys available for button/tooltip/loading state in generate-description UI
- No blockers

## Self-Check: PASSED

All artifacts verified:
- SUMMARY.md exists
- analyzeProjectDirectory exported from project-actions.ts
- 7 tests pass (plus 9 pre-existing = 16 total)
- i18n keys present in both zh.ts and en.ts
- All 3 task commits found: a01b283, bb61ce4, 26851d7

---
*Phase: 62-project-analysis*
*Completed: 2026-04-21*
