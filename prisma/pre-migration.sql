-- Run before `prisma db push --accept-data-loss` to neutralize FTS5 state.
--
-- Two reasons for the checkpoint + DROPs:
--
--   1. `notes_fts` is a virtual table not declared in `schema.prisma`. Prisma's
--      schema engine sees its shadow tables (`notes_fts_config`, `_data`,
--      `_idx`, `_docsize`, `_content`) as untracked and tries to drop them
--      individually — and crashes mid-migration with "no such table" when the
--      shadows have been partially removed or live in stale WAL pages.
--
--   2. A virtual-table DROP cleans up *all* of its shadow tables atomically
--      via FTS5's xDestroy. After this script runs Prisma sees no notes_fts*
--      tables at all, the migration applies cleanly, and `init-fts.ts`
--      recreates the index + repopulates it from ProjectNote.

PRAGMA wal_checkpoint(TRUNCATE);

DROP TABLE IF EXISTS notes_fts;
DROP TABLE IF EXISTS notes_fts_config;
DROP TABLE IF EXISTS notes_fts_data;
DROP TABLE IF EXISTS notes_fts_idx;
DROP TABLE IF EXISTS notes_fts_docsize;
DROP TABLE IF EXISTS notes_fts_content;
