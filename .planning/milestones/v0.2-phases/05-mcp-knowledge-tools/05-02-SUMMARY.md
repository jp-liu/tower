---
phase: 05-mcp-knowledge-tools
plan: 02
subsystem: mcp
tags: [mcp, notes, assets, fts, action-dispatch, tdd]
dependency_graph:
  requires: [src/mcp/db.ts, src/lib/fts.ts, src/lib/file-utils.ts, src/mcp/tools/knowledge-tools.ts]
  provides: [src/mcp/tools/note-asset-tools.ts, noteAssetTools.manage_notes, noteAssetTools.manage_assets]
  affects: [src/mcp/server.ts (3 new tools registered)]
tech_stack:
  added: []
  patterns: [action-dispatch, dependency-injection, tdd, EXDEV-cross-device-fallback]
key_files:
  created:
    - src/mcp/tools/note-asset-tools.ts
    - tests/unit/mcp/manage-notes.test.ts
    - tests/unit/mcp/manage-assets.test.ts
  modified:
    - src/mcp/server.ts
decisions:
  - "manage_notes and manage_assets use action-dispatch pattern (single tool, enum action field) to keep tool count manageable"
  - "EXDEV fallback uses copy+unlink to handle cross-device file moves"
  - "Test timing: use 10ms delay between asset creates to ensure distinct createdAt timestamps in SQLite"
metrics:
  duration: 240s
  completed: 2026-03-27T08:35:00Z
  tasks: 2
  files_created: 3
  files_modified: 1
---

# Phase 05 Plan 02: manage_notes and manage_assets MCP Tools Summary

**One-liner:** Action-dispatch MCP tools for note CRUD with FTS sync and asset file management with cross-device fallback, registered in server.ts to bring total tool count to 21.

## What Was Built

Created `src/mcp/tools/note-asset-tools.ts` exporting `noteAssetTools` with two tools:

**manage_notes** — 6 actions:
- `create`: stores note with default category "备忘", calls syncNoteToFts after DB insert
- `update`: modifies title/content/category, calls syncNoteToFts after DB update
- `delete`: calls deleteNoteFromFts BEFORE db.projectNote.delete, returns {deleted, noteId}
- `get`: returns single note by ID
- `list`: returns notes for a project with optional category filter, ordered by updatedAt desc
- `search`: delegates to searchNotes(db, projectId, query) for FTS5 results

**manage_assets** — 4 actions:
- `add`: calls ensureAssetsDir, tries renameSync, falls back to copyFileSync+unlinkSync on EXDEV, calls statSync for size, creates DB record
- `delete`: removes DB record only (file remains on disk)
- `list`: returns assets ordered by createdAt desc
- `get`: returns single asset by ID

Updated `src/mcp/server.ts` to import and spread both `knowledgeTools` (from Plan 01) and `noteAssetTools`, bringing total MCP tool count to 21.

## Test Results

```
Test Files  3 passed (3)
     Tests  39 passed (39)
  Duration  330ms
```

All 22 manage_notes and manage_assets tests pass, plus 17 existing identify_project tests.

## Decisions Made

1. **Action-dispatch pattern** — both tools use a single enum `action` field; keeps total tool count low while providing full CRUD
2. **EXDEV cross-device fallback** — fs.renameSync can fail with EXDEV when source and dest are on different filesystems; copy+unlink ensures correct behavior
3. **Test timing fix** — SQLite's createdAt resolution requires a 10ms delay between creates to ensure deterministic ordering in list tests

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test timing issue in manage-assets list test**
- **Found during:** Task 1 (TDD GREEN)
- **Issue:** Two assets created in rapid succession had the same `createdAt` timestamp in SQLite, causing ordering assertion to fail non-deterministically
- **Fix:** Added 10ms `setTimeout` between asset creates in the list test to ensure distinct timestamps
- **Files modified:** `tests/unit/mcp/manage-assets.test.ts`
- **Commit:** a1bb7fc

**2. [Rule 2 - TypeScript] Fixed test handler type annotations**
- **Found during:** Task 2 (TypeScript check)
- **Issue:** Handler type `(args: Record<string, unknown>)` was incompatible with the more specific Zod-inferred type
- **Fix:** Used `any` with eslint-disable comment for test-only handler variables
- **Files modified:** `tests/unit/mcp/manage-notes.test.ts`, `tests/unit/mcp/manage-assets.test.ts`
- **Commit:** d9a370e

## Known Stubs

None — both tools use real DB operations, real FTS sync, and real file system calls (mocked only in tests).

## Self-Check: PASSED

Files exist:
- [x] `/Users/liujunping/project/i/ai-manager/src/mcp/tools/note-asset-tools.ts` — FOUND
- [x] `/Users/liujunping/project/i/ai-manager/tests/unit/mcp/manage-notes.test.ts` — FOUND
- [x] `/Users/liujunping/project/i/ai-manager/tests/unit/mcp/manage-assets.test.ts` — FOUND

Commits:
- [x] `a1bb7fc` — `feat(05-02): implement manage_notes and manage_assets MCP tools with tests`
- [x] `d9a370e` — `feat(05-02): register knowledgeTools and noteAssetTools in server.ts`
