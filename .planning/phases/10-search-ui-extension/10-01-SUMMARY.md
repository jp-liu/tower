---
phase: 10-search-ui-extension
plan: "01"
subsystem: search
tags: [search, i18n, snippet, data-contract]
dependency_graph:
  requires: []
  provides: [SearchResult.snippet, i18n-search-tabs]
  affects: [src/components/layout/search-dialog.tsx]
tech_stack:
  added: []
  patterns: [TDD, interface-extension]
key_files:
  created: []
  modified:
    - src/actions/search-actions.ts
    - src/lib/i18n.tsx
    - tests/unit/actions/search-actions.test.ts
decisions:
  - "Fixed plan test spec: empty-content note test requires syncNoteToFts before querying since FTS5 path is taken for long queries"
metrics:
  duration: ~5 minutes
  completed: "2026-03-30T06:50:15Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 10 Plan 01: Search Data Contract & i18n Keys Summary

**One-liner:** Added `snippet?: string` to SearchResult (note=first 80 chars of content, asset=description) and 6 new i18n keys for All/Note/Asset search tabs and updated placeholders.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Add snippet field to SearchResult; populate for note/asset results | 1896d76 | src/actions/search-actions.ts, tests/unit/actions/search-actions.test.ts |
| 2 | Add i18n translation keys for new search tabs and update placeholders | 488b57a | src/lib/i18n.tsx |

## What Was Built

**Task 1: SearchResult.snippet field (TDD)**

- Added `snippet?: string` to the `SearchResult` interface in `src/actions/search-actions.ts`
- `toNoteResult` now populates `snippet` with `row.content.slice(0, 80)` (undefined when content is empty string)
- Asset map now populates `snippet` with `a.description || undefined` (undefined when description is empty string)
- 4 new passing tests covering both note and asset snippet cases

**Task 2: i18n keys**

- Added 3 new keys to both `translations.zh` and `translations.en`:
  - `search.all`: "全部" / "All"
  - `search.note`: "笔记" / "Notes"
  - `search.asset`: "资源" / "Assets"
- Updated `search.placeholder` in both locales to mention notes and assets
- Updated `topbar.searchPlaceholder` in both locales to match

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test: empty-content note must be synced to FTS before FTS5 query**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** The plan's test comment said "Short query to use LIKE fallback" but the query "Empty Content Snippet" is 22 chars (> 3), so it takes the FTS5 path. The note was not synced to FTS, so it was never found (undefined), causing `expect(found).toBeDefined()` to fail.
- **Fix:** Added `await syncNoteToFts(testDb, ...)` before querying in the empty-content test — the FTS5 path then finds the note by title match, and snippet is correctly undefined since content is empty.
- **Files modified:** tests/unit/actions/search-actions.test.ts
- **Commit:** 1896d76

## Test Results

```
Test Files  1 passed (1)
Tests       16 passed (16)
```

All 16 tests pass including 4 new snippet tests.

## Known Stubs

None — all data flows are complete. The snippet field is populated from real data (note content, asset description).

## Self-Check: PASSED

- [x] src/actions/search-actions.ts exists and contains `snippet?: string`
- [x] src/lib/i18n.tsx exists and contains `search.all` in both locales
- [x] tests/unit/actions/search-actions.test.ts exists and all tests pass
- [x] Commit 1896d76 exists
- [x] Commit 488b57a exists
