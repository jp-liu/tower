---
phase: 14-search-quality-realtime-config
plan: 01
subsystem: search
tags: [search, prisma, sqlite, fts5, mcp, config, refactor]

# Dependency graph
requires:
  - phase: 13-configurable-system-parameters
    provides: search.* config keys in CONFIG_DEFAULTS + getConfigValues batch API + readConfigValue for non-Next.js contexts
provides:
  - src/lib/search.ts — single source of truth for all search logic with dependency-injected SearchConfig
  - Re-exported types (SearchResult, SearchCategory, SearchResultType, SearchConfig) from search-actions.ts for backward compat
  - MCP search tool now respects user-configured search limits via readConfigValue
affects: [15-race-condition-fix, any future search features]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Dependency-injected config pattern (SearchConfig struct passed as parameter)
    - Framework-agnostic shared module (no "use server", no Next.js imports)
    - Thin wrapper pattern (server action and MCP tool both delegate to shared lib)
    - Promise.all for parallel config reads in MCP tool

key-files:
  created:
    - src/lib/search.ts
    - tests/unit/lib/search.test.ts
  modified:
    - src/actions/search-actions.ts
    - src/mcp/tools/search-tools.ts

key-decisions:
  - "search.ts is framework-agnostic (no use server, no Next.js imports) — safe for MCP stdio context"
  - "SearchConfig injected as parameter (not fetched inside) — search.ts stays dependency-free"
  - "'all' category uses local recursive search() calls, not globalSearch — avoids re-fetching config 5x"
  - "search-tools.ts uses Promise.all for 3 parallel config reads — no sequential await overhead"
  - "Types re-exported from search-actions.ts for backward compatibility with existing consumers"

patterns-established:
  - "Shared lib pattern: extract framework-agnostic logic to src/lib/, inject config/deps as parameters"
  - "Thin wrapper pattern: server actions and MCP tools delegate to shared lib, handle only context bridging"

requirements-completed:
  - SRCH-06

# Metrics
duration: 15min
completed: 2026-03-30
---

# Phase 14 Plan 01: Search Deduplication Summary

**Extracted shared search SQL into framework-agnostic src/lib/search.ts with dependency-injected SearchConfig, making both search-actions.ts (24 lines) and search-tools.ts (32 lines) thin wrappers that delegate to it — MCP search now respects user-configured limits**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-30T11:46:00Z
- **Completed:** 2026-03-30T11:50:46Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 refactored)

## Accomplishments
- Created `src/lib/search.ts` — single source of truth for all search logic (task/project/repository/note/asset/all categories)
- Refactored `search-actions.ts` from 222 lines to 24 lines (thin wrapper)
- Refactored `search-tools.ts` from 222 lines to 32 lines (thin wrapper)
- MCP search tool now reads user-configured limits via `readConfigValue` with `Promise.all` — no more hardcoded `take: 20`
- MCP search tool gains snippet support (feature gain — was previously missing)
- All 38 tests pass across 3 test suites (10 new tests for search.ts)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/lib/search.ts shared module with tests** - `d72b91e` (feat)
2. **Task 2: Refactor search-actions.ts and search-tools.ts to thin wrappers** - `fb39a3d` (feat)

**Plan metadata:** (docs commit below)

_Note: Task 1 followed TDD workflow (RED: tests written first, confirmed failing; GREEN: implementation added, tests pass)_

## Files Created/Modified
- `src/lib/search.ts` — Framework-agnostic shared search module; exports search(), SearchConfig, SearchCategory, SearchResultType, SearchResult
- `tests/unit/lib/search.test.ts` — 10 unit tests covering all behavior requirements (empty, task shape, note FTS5, note LIKE fallback, all with cap, resultLimit, asset with snippet)
- `src/actions/search-actions.ts` — Thin wrapper (24 lines): fetches config via getConfigValues, delegates to search()
- `src/mcp/tools/search-tools.ts` — Thin wrapper (32 lines): reads config via readConfigValue (Promise.all), delegates to search()

## Decisions Made
- `search.ts` uses dependency injection for config (SearchConfig parameter) rather than reading config internally — keeps module framework-agnostic and testable
- `'all'` category in `search.ts` calls local `search(q, ...)` recursively (not globalSearch) to avoid re-fetching config 5 times
- Types re-exported from `search-actions.ts` so existing consumers (UI components) don't need import path changes

## Deviations from Plan

None - plan executed exactly as written.

The only minor deviation was a build environment issue (Prisma client not generated in worktree) resolved by running `npx prisma generate`. This is a standard worktree setup step, not a code deviation.

## Issues Encountered
- Worktree node_modules were missing (pnpm install required) and Prisma client wasn't generated — both resolved with standard setup commands before tests ran
- Tests initially pointed to worktree's dev.db which had outdated schema; resolved by using DATABASE_URL pointing to main project db

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Search deduplication complete (SRCH-06 satisfied)
- src/lib/search.ts ready as shared module for any future search enhancements
- Remaining Phase 14 work: search useEffect race condition fix (SRCH-07)

## Self-Check: PASSED

- FOUND: src/lib/search.ts
- FOUND: tests/unit/lib/search.test.ts
- FOUND: .planning/phases/14-search-quality-realtime-config/14-01-SUMMARY.md
- FOUND commit d72b91e (Task 1)
- FOUND commit fb39a3d (Task 2)

---
*Phase: 14-search-quality-realtime-config*
*Completed: 2026-03-30*
