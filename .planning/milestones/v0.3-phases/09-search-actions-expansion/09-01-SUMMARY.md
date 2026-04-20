---
phase: 09-search-actions-expansion
plan: 01
subsystem: api
tags: [search, fts5, sqlite, prisma, mcp, globalSearch]

# Dependency graph
requires:
  - phase: 08-asset-description-schema
    provides: ProjectAsset.description field (used in asset LIKE search)
  - phase: 07-knowledge-base
    provides: notes_fts FTS5 virtual table and syncNoteToFts helper
provides:
  - globalSearch with note (FTS5+LIKE), asset (Prisma LIKE), and all (Promise.allSettled) categories
  - SearchCategory type expanded to 6 values including "all"
  - SearchResultType narrowed to 5 values excluding "all"
  - MCP search tool schema and handler extended to match all 6 categories
  - 24 integration tests covering SRCH-01 through SRCH-04
affects: [10-search-ui-extension, phase-10, mcp-clients]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FTS5 malformed query: try/catch around $queryRawUnsafe, LIKE fallback on any error"
    - "Global note search: inline raw SQL JOIN across notes_fts+ProjectNote+Project+Workspace without projectId filter"
    - "Promise.allSettled fan-out: 5 parallel category searches, collect fulfilled results, skip rejected"
    - "SearchCategory vs SearchResultType: query mode includes 'all', result type excludes 'all'"

key-files:
  created:
    - tests/unit/actions/search-actions.test.ts
    - tests/unit/mcp/search-tools.test.ts
  modified:
    - src/actions/search-actions.ts
    - src/mcp/tools/search-tools.ts

key-decisions:
  - "Inline raw SQL in search-actions.ts for global note search rather than adding helper to fts.ts — keeps fts.ts Next.js-free"
  - "SearchResultType = 'task' | 'project' | 'repository' | 'note' | 'asset' (excludes 'all') — 'all' is a query mode not a result discriminant"
  - "Both search-actions.ts and search-tools.ts updated in same commit — locked project decision for enum parity"

patterns-established:
  - "Pattern: FTS5 search with try/catch LIKE fallback for malformed queries (any error, not just short query)"
  - "Pattern: Promise.allSettled fan-out with per-type CAP=5 for all-mode search resilience"

requirements-completed: [SRCH-01, SRCH-02, SRCH-03, SRCH-04]

# Metrics
duration: 5min
completed: 2026-03-30
---

# Phase 09 Plan 01: Search Actions Expansion Summary

**globalSearch extended with note (FTS5+LIKE fallback), asset (Prisma LIKE), and all (Promise.allSettled fan-out) categories; MCP search tool mirrored; 24 new integration tests green**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-30T06:03:51Z
- **Completed:** 2026-03-30T06:09:45Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 4

## Accomplishments
- globalSearch now handles 6 search categories: task, project, repository, note, asset, all
- Note search uses FTS5 MATCH with automatic LIKE fallback for malformed queries (e.g., unmatched quotes)
- Asset search queries filename and description via Prisma LIKE
- All-mode uses Promise.allSettled across 5 categories in parallel, capped at 5 results per type
- MCP search tool schema and handler updated to match all 6 categories (no @/lib/db imports)
- SearchResult.type narrowed to exclude "all" — prevents Phase 10 grouping confusion
- 24 integration tests pass covering all SRCH requirements

## Task Commits

Each task was committed atomically:

1. **Task 1: Create test scaffolds (RED)** - `0f67429` (test)
2. **Task 2: Implement note/asset/all search (GREEN)** - `bb435ee` (feat)

## Files Created/Modified
- `src/actions/search-actions.ts` - Extended SearchCategory, SearchResultType, note/asset/all branches
- `src/mcp/tools/search-tools.ts` - Mirrored all changes, extended Zod enum to 6 values
- `tests/unit/actions/search-actions.test.ts` - 17 integration tests for globalSearch new categories
- `tests/unit/mcp/search-tools.test.ts` - 7 tests for MCP schema validation and handler

## Decisions Made

- Inline raw SQL in `search-actions.ts` for global note search (no projectId filter) rather than adding a helper to `fts.ts` — keeps `fts.ts` Next.js-free per the constraint that file-utils.ts and fts.ts must never import Next.js modules.
- `SearchResultType` introduced as separate type from `SearchCategory` — "all" is a query mode input, never a result type. Prevents Phase 10 grouping logic from seeing "all" as a result discriminant.
- Both `search-actions.ts` and `search-tools.ts` updated in the same commit — enforces the locked project decision that divergence between these files is silent and dangerous.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect ProjectAsset field name in test files (filepath → path)**
- **Found during:** Task 1 (test scaffold creation)
- **Issue:** Plan's interface documentation showed `filepath` but the actual Prisma schema uses `path`. Tests would fail with `PrismaClientValidationError: Argument 'path' is missing`.
- **Fix:** Replaced `filepath` with `path` in all `projectAsset.create()` calls in both test files.
- **Files modified:** tests/unit/actions/search-actions.test.ts, tests/unit/mcp/search-tools.test.ts
- **Verification:** Tests ran without PrismaClientValidationError; 10 tests passed in RED phase for schema/type tests.
- **Committed in:** 0f67429 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Field name fix was necessary for tests to run. No scope creep.

## Issues Encountered

- The plan's interface reference for `ProjectAsset` showed `filepath` but the live schema uses `path`. Corrected via Rule 1 auto-fix. No data issues.
- Pre-existing TypeScript errors in `src/actions/agent-config-actions.ts` and `src/app/api/tasks/[taskId]/stream/route.ts` are not caused by this plan's changes (verified by stash test).

## Known Stubs

None - all search branches are fully wired to the database and return real data.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 10 (Search UI Extension) can now use globalSearch with `category: "all"` to build the All tab
- Note results include `type: "note"` and `navigateTo: "/workspaces/{wsId}?projectId={pId}"` — Phase 10 UI tab param (`?tab=notes`) can be appended if needed
- Asset results include `type: "asset"` and `navigateTo: "/workspaces/{wsId}?projectId={pId}"` — Phase 10 UI tab param (`?tab=assets`) can be appended if needed
- MCP clients can now search notes and assets via the search tool

---
*Phase: 09-search-actions-expansion*
*Completed: 2026-03-30*
