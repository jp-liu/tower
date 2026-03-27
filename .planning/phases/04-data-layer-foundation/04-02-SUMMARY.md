---
phase: 04-data-layer-foundation
plan: 02
subsystem: data-layer
tags: [fts5, sqlite, server-actions, zod, prisma, notes, assets]

# Dependency graph
requires:
  - 04-01 (ProjectNote and ProjectAsset models, notes_fts FTS5 table, file-utils.ts)
provides:
  - searchNotes/syncNoteToFts/deleteNoteFromFts functions in src/lib/fts.ts
  - Note CRUD server actions with Zod validation and FTS sync in src/actions/note-actions.ts
  - Asset CRUD server actions with Zod validation and ensureAssetsDir in src/actions/asset-actions.ts
affects:
  - phase 05 (MCP note/asset tools will import these actions)
  - phase 07 (notes UI will call these server actions)

# Tech tracking
tech-stack:
  added:
    - zod (schema validation for server action inputs)
  patterns:
    - Dependency injection: fts.ts accepts PrismaClient as parameter (safe for MCP stdio + Next.js)
    - TDD: RED test → GREEN implementation → verified all 33 tests pass
    - Server action pattern: "use server" + Zod parse at boundary + db operation + FTS sync + revalidatePath
    - delete-then-insert for FTS5 sync to avoid duplicate rows on update

key-files:
  created:
    - src/lib/fts.ts
    - src/actions/note-actions.ts
    - src/actions/asset-actions.ts
    - tests/unit/lib/fts.test.ts
    - tests/unit/lib/note-actions.test.ts
    - tests/unit/lib/asset-actions.test.ts
  modified: []

key-decisions:
  - "fts.ts uses dependency injection (PrismaClient parameter) so it works in both Next.js server actions and MCP stdio processes without Next.js imports"
  - "FTS sync uses delete-then-insert pattern to handle upsert cleanly since FTS5 does not support UPDATE"
  - "note-actions.ts calls deleteNoteFromFts BEFORE db.projectNote.delete so FTS row is removed even if delete cascades instantly"
  - "asset-actions.ts calls ensureAssetsDir BEFORE db.projectAsset.create to guarantee directory exists before record is committed"
  - "Tests use vi.mock('next/cache') to isolate server actions from Next.js runtime"

# Metrics
duration: 3min
completed: 2026-03-27
---

# Phase 4 Plan 2: Notes and Assets Server Actions Summary

**FTS5 search helper with dependency injection, Note CRUD server actions with Zod validation and FTS sync, Asset CRUD server actions with Zod validation and ensureAssetsDir — 33 integration tests all green**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-27T07:40:42Z
- **Completed:** 2026-03-27T07:44:00Z
- **Tasks:** 2 (both TDD)
- **Files created:** 6

## Accomplishments

- Created `src/lib/fts.ts` with `searchNotes` (FTS5 MATCH for 3+ chars, LIKE fallback for shorter), `syncNoteToFts` (delete+insert), and `deleteNoteFromFts` — no Next.js imports, dependency injection pattern
- Created `src/actions/note-actions.ts` with `createNote`, `updateNote`, `deleteNote`, `getNoteById`, `getProjectNotes` — Zod validation, FTS sync on every CUD, revalidatePath
- Created `src/actions/asset-actions.ts` with `createAsset`, `deleteAsset`, `getProjectAssets`, `getAssetById` — Zod validation, ensureAssetsDir before db insert
- 10 fts.ts tests: empty query, whitespace, 2-char LIKE fallback, 3+ char FTS5, Chinese characters, cross-project isolation, sync insert/replace, delete
- 13 note-actions tests: create with default/custom category, FTS sync verification, Zod validation, update with re-sync, delete with FTS cleanup, getById, getProjectNotes with/without filter
- 10 asset-actions tests: create with all/required fields only, ensureAssetsDir call verification, Zod validation, getProjectAssets, deleteAsset, getAssetById

## Task Commits

1. **Task 1: Create fts.ts search helper with sync functions and tests** - `b05db15` (feat)
2. **Task 2: Create note-actions.ts and asset-actions.ts server actions with tests** - `a663ac3` (feat)

## Files Created/Modified

- `src/lib/fts.ts` - New: FTS5 search, sync, and delete helpers; no Next.js imports
- `src/actions/note-actions.ts` - New: Note CRUD server actions with Zod and FTS sync
- `src/actions/asset-actions.ts` - New: Asset CRUD server actions with Zod and ensureAssetsDir
- `tests/unit/lib/fts.test.ts` - New: 10 integration tests against real SQLite
- `tests/unit/lib/note-actions.test.ts` - New: 13 integration tests with next/cache mocked
- `tests/unit/lib/asset-actions.test.ts` - New: 10 integration tests with ensureAssetsDir spied

## Decisions Made

- `fts.ts` uses dependency injection (accepts `PrismaClient` as parameter) so it is importable by both Next.js server actions and MCP stdio processes without pulling in Next.js modules
- FTS5 sync uses delete-then-insert: FTS5 does not support UPDATE, so we delete the row first then re-insert, guaranteeing no duplicate entries when a note is updated
- `deleteNote` removes from FTS before deleting from the DB to avoid a window where the FTS row references a deleted note

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all server actions are fully wired to the real database. No hardcoded/empty data flows to consumers.

---
*Phase: 04-data-layer-foundation*
*Completed: 2026-03-27*
