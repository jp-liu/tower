---
phase: 04-data-layer-foundation
plan: 01
subsystem: database
tags: [prisma, sqlite, fts5, file-utils, node]

# Dependency graph
requires: []
provides:
  - ProjectNote and ProjectAsset Prisma models with cascade delete from Project
  - FTS5 virtual table notes_fts for full-text search on notes
  - initDb() with WAL + busy_timeout=5000 in src/lib/db.ts
  - busy_timeout=5000 in src/mcp/db.ts
  - file-utils.ts directory helpers for data/assets/ and data/cache/
  - NOTE_CATEGORIES_PRESET constants (账号/环境/需求/备忘)
  - /data/ directory gitignored
affects:
  - 04-02-notes-and-assets-actions
  - phase 05 (MCP tools)
  - phase 06 (smart project detection)
  - phase 07 (notes UI)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - FTS5 virtual table created via raw SQL AFTER prisma db push, not in schema
    - initDb() pattern for pragma setup on both PrismaClient instances
    - file-utils.ts has no Next.js imports — safe for MCP stdio process

key-files:
  created:
    - prisma/init-fts.ts
    - src/lib/file-utils.ts
    - tests/unit/lib/file-utils.test.ts
  modified:
    - prisma/schema.prisma
    - src/lib/db.ts
    - src/mcp/db.ts
    - src/lib/constants.ts
    - package.json
    - .gitignore

key-decisions:
  - "FTS5 virtual table created via raw SQL in prisma/init-fts.ts run after db:push — never in Prisma schema to avoid drift detection"
  - "DATA_ROOT = process.cwd() + /data in file-utils.ts — tests use vi.spyOn(process.cwd) to redirect to temp dir"
  - "Both PrismaClient instances (Next.js + MCP) now have PRAGMA busy_timeout=5000 to prevent database locked errors"

patterns-established:
  - "Pattern 1: initDb() function in both db.ts files sets WAL + busy_timeout pragmas before first use"
  - "Pattern 2: file-utils.ts uses pure node:fs and node:path — no framework imports, shareable between Next.js and MCP"

requirements-completed: [NOTE-01, NOTE-02, NOTE-03, ASST-01, ASST-02]

# Metrics
duration: 10min
completed: 2026-03-27
---

# Phase 4 Plan 1: Data Layer Foundation Summary

**ProjectNote and ProjectAsset Prisma models with FTS5 notes_fts virtual table, busy_timeout=5000 on both PrismaClient instances, and file-utils.ts for data/assets/ and data/cache/ directory management**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-27T07:35:00Z
- **Completed:** 2026-03-27T07:45:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Extended Prisma schema with ProjectNote and ProjectAsset models; pushed to SQLite successfully
- Created FTS5 virtual table notes_fts using trigram tokenizer via init-fts.ts script
- Added PRAGMA busy_timeout=5000 to both Next.js and MCP PrismaClient instances
- Created file-utils.ts with 5 directory helpers, all tested with 9 passing vitest tests
- Added NOTE_CATEGORIES_PRESET constants and /data/ to .gitignore

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend schema, update DB pragmas, add FTS5 init and constants** - `cfae1c5` (feat)
2. **Task 2: Create file-utils.ts and tests (TDD)** - `f08816b` (feat)

## Files Created/Modified
- `prisma/schema.prisma` - Added ProjectNote, ProjectAsset models and Project relation fields
- `src/lib/db.ts` - Added initDb() with WAL + busy_timeout=5000 pragma
- `src/mcp/db.ts` - Added busy_timeout=5000 pragma to existing initDb()
- `prisma/init-fts.ts` - New script for FTS5 virtual table creation (run after db:push)
- `src/lib/constants.ts` - Added NOTE_CATEGORIES_PRESET and NoteCategoryPreset type
- `package.json` - Added db:init-fts script
- `.gitignore` - Added /data/ entry
- `src/lib/file-utils.ts` - New: getAssetsDir, getCacheDir, ensureAssetsDir, ensureCacheDir, listAssetFiles
- `tests/unit/lib/file-utils.test.ts` - New: 9 tests using vi.spyOn(process.cwd) for isolation

## Decisions Made
- Used `vi.spyOn(process, 'cwd')` in tests to redirect DATA_ROOT to a temp dir — keeps production API clean (no root parameter needed)
- FTS5 uses `tokenize='trigram case_sensitive 0'` for substring matching on short Chinese text

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All data layer primitives are in place for Plan 04-02 (notes and assets server actions)
- ProjectNote and ProjectAsset are queryable in the DB
- FTS5 table notes_fts exists and is ready to be populated by triggers or sync logic
- file-utils.ts is importable by both Next.js server actions and MCP tools

---
*Phase: 04-data-layer-foundation*
*Completed: 2026-03-27*
