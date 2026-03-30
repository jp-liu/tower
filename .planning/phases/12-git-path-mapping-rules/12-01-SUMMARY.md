---
phase: 12-git-path-mapping-rules
plan: "01"
subsystem: api
tags: [git, config, server-actions, typescript, vitest]

# Dependency graph
requires:
  - phase: 11-system-config
    provides: "getConfigValue/setConfigValue server actions and SystemConfig DB model"
provides:
  - "GitPathRule interface exported from git-url.ts"
  - "matchGitPathRule pure function (priority sort, exact/wildcard owner, {owner}/{repo} interpolation, SSH URL support)"
  - "resolveGitLocalPath server action in config-actions.ts"
  - "git.pathMappingRules registered in CONFIG_DEFAULTS with defaultValue: []"
  - "Async handleGitUrlChange in top-bar.tsx using resolveGitLocalPath"
affects: [12-02-settings-ui, 13-system-params, 14-realtime-config]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure matching function takes rules as a parameter — no DB access in git-url.ts (clean layer separation)"
    - "resolveGitLocalPath server action wraps DB read + pure function + sync fallback (D-13 bridge pattern)"
    - "Async handler: sync state updates first, only async operation sets derived field (no input lag)"

key-files:
  created:
    - tests/unit/lib/git-url.test.ts
  modified:
    - src/lib/git-url.ts
    - src/lib/config-defaults.ts
    - src/actions/config-actions.ts
    - src/components/layout/top-bar.tsx
    - tests/unit/actions/config-actions.test.ts

key-decisions:
  - "D-13 bridge pattern: resolveGitLocalPath server action wraps DB lookup + matchGitPathRule + gitUrlToLocalPath fallback — keeps git-url.ts free of Next.js/server imports"
  - "matchGitPathRule sorts rules by priority (lower = higher priority) using [...rules].sort() to avoid array mutation"
  - "handleGitUrlChange made async: setGitUrl/setCloneStatus/setCloneError fire synchronously first — only setLocalPath awaits resolveGitLocalPath (no input lag)"
  - "Pre-existing test failures in board-stats.test.tsx and prompts-config.test.tsx are out of scope (I18nProvider/router context issues predating this phase)"

patterns-established:
  - "Layer separation: pure lib functions take data as parameters, server actions own DB reads"
  - "Config defaults registry: entries added per phase as parameters are wired (git.pathMappingRules is first entry)"

requirements-completed: [GIT-02]

# Metrics
duration: 4min
completed: 2026-03-30
---

# Phase 12 Plan 01: Git Path Mapping Rules — Logic Foundation Summary

**GitPathRule type, matchGitPathRule pure function, resolveGitLocalPath server action, and async top-bar integration wiring DB-stored rules into project-creation auto-path logic**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-30T09:59:21Z
- **Completed:** 2026-03-30T10:03:06Z
- **Tasks:** 2 (Task 1 TDD, Task 2 standard)
- **Files modified:** 5 (3 modified, 1 new test file)

## Accomplishments

- GitPathRule interface and matchGitPathRule pure function in git-url.ts — handles exact owner, wildcard *, priority sorting, {owner}/{repo} interpolation, SSH URLs, empty/invalid input
- resolveGitLocalPath server action reads rules from DB via getConfigValue, tries matchGitPathRule, falls back to hardcoded gitUrlToLocalPath on no match or DB error
- handleGitUrlChange in top-bar.tsx is now async — sync state updates fire immediately (no input lag), only setLocalPath awaits the server action
- git.pathMappingRules registered in CONFIG_DEFAULTS with defaultValue: [] — first entry in the registry
- 27 tests pass (13 unit tests for matchGitPathRule + 14 integration tests including 5 new resolveGitLocalPath tests)

## Task Commits

1. **Task 1: GitPathRule type, export helpers, matchGitPathRule, config default, and unit tests** - `ded9b2b` (feat)
2. **Task 2: resolveGitLocalPath server action and top-bar async migration** - `0d85218` (feat)

## Files Created/Modified

- `src/lib/git-url.ts` - Added GitPathRule interface, matchGitPathRule function; exported parseGitUrl, expandHome, ParsedUrl
- `src/lib/config-defaults.ts` - Added git.pathMappingRules entry with defaultValue: []
- `src/actions/config-actions.ts` - Added resolveGitLocalPath server action
- `src/components/layout/top-bar.tsx` - Replaced gitUrlToLocalPath with async resolveGitLocalPath call
- `tests/unit/lib/git-url.test.ts` - Created: 13 unit tests for matchGitPathRule
- `tests/unit/actions/config-actions.test.ts` - Extended: 5 new resolveGitLocalPath tests; updated cleanup to delete git.pathMappingRules rows

## Decisions Made

- D-13 bridge pattern chosen: resolveGitLocalPath server action bridges client → DB lookup → pure function → fallback. Keeps git-url.ts free of Next.js/server imports (project constraint).
- matchGitPathRule uses [...rules].sort() to sort by priority without mutating the input array (immutability rule).
- handleGitUrlChange async migration: sync state updates (setGitUrl, setCloneStatus, setCloneError) fire first before await, preventing input lag.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

Pre-existing test failures in `tests/unit/components/board-stats.test.tsx` and `tests/unit/components/prompts-config.test.tsx` (11 tests failing due to missing I18nProvider context and app router mount). These failures predate this phase — confirmed by reverting changes and re-running the same tests. Deferred to separate fix effort per scope boundary rules.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- GitPathRule interface is exported and ready for Plan 02 (system-config.tsx UI)
- resolveGitLocalPath is live — project creation auto-populates localPath using DB rules as soon as rules are saved from the settings UI
- CONFIG_DEFAULTS registry has its first entry — ready for Phase 13 to add system params

## Self-Check

- [x] `src/lib/git-url.ts` exists and exports GitPathRule, matchGitPathRule, parseGitUrl, expandHome, ParsedUrl
- [x] `src/lib/config-defaults.ts` contains git.pathMappingRules with defaultValue: []
- [x] `src/actions/config-actions.ts` exports resolveGitLocalPath
- [x] `src/components/layout/top-bar.tsx` uses resolveGitLocalPath with async handleGitUrlChange
- [x] `tests/unit/lib/git-url.test.ts` created with 13 tests (all passing)
- [x] `tests/unit/actions/config-actions.test.ts` extended with resolveGitLocalPath tests
- [x] Commits ded9b2b and 0d85218 exist

---
*Phase: 12-git-path-mapping-rules*
*Completed: 2026-03-30*
