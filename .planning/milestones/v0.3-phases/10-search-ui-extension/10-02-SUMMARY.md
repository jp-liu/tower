---
phase: 10-search-ui-extension
plan: "02"
subsystem: search-ui
tags: [search, ui, tabs, i18n, snippet, component-tests]
dependency_graph:
  requires: [SearchResult.snippet, i18n-search-tabs]
  provides: [six-tab-search-dialog, grouped-all-rendering, snippet-display]
  affects: [src/components/layout/search-dialog.tsx]
tech_stack:
  added: []
  patterns: [ResultRow sub-component, grouped reduce pattern, IIFE rendering]
key_files:
  created:
    - tests/unit/components/search-dialog.test.tsx
  modified:
    - src/components/layout/search-dialog.tsx
decisions:
  - "Used IIFE pattern for grouped All rendering to avoid intermediate variable in JSX"
  - "ResultRow extracted as module-level component to avoid recreation on each render"
  - "SECTION_ORDER controls display order of type groups independently of data order"
metrics:
  duration: ~8 minutes
  completed: "2026-03-30T06:58:00Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 10 Plan 02: Search Dialog Six-Tab UI Summary

**One-liner:** Extended search-dialog.tsx with six tabs (All, Task, Project, Repository, Note, Asset), grouped result sections in All mode with section headers, and snippet display beneath result rows for note and asset types.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Extend search-dialog.tsx with six tabs, grouped All rendering, and snippet display | 965610c | src/components/layout/search-dialog.tsx |
| 2 | Create component tests for search dialog six-tab UI | 27b43a8 | tests/unit/components/search-dialog.test.tsx |
| 3 | Visual verification of search dialog | (auto-approved) | — |

## What Was Built

**Task 1: Six-tab search dialog**

- Added `StickyNote`, `Package2` icons from lucide-react; imported `SearchResultType`
- Replaced 3-entry `CATEGORY_DEFS` with 6-entry array: all, task, project, repository, note, asset
- Changed default category state from `"task"` to `"all"`
- Added `SECTION_ORDER: SearchResultType[]` to control group display order in All mode
- Added `SECTION_KEY_MAP` mapping result types to i18n keys for section header translation
- Extracted `ResultRow` module-level component with snippet display (`result.snippet && <div>...`)
- All tab: grouped rendering via `reduce` + `SECTION_ORDER.filter` with section header divs
- Other tabs: flat rendering using `results.map(result => <ResultRow ...>)`
- Removed old `getCategoryIcon` function (now handled by `ResultRow` internally)
- File: 181 lines (down from potential 250 due to clean extraction)

**Task 2: Component tests (5 tests)**

- `renders six category tabs` — verifies all 6 zh locale labels appear in DOM
- `All tab is selected by default` — verifies amber active styling on 全部 button
- `renders section headers when All tab has grouped results` — mocks globalSearch, types query, waits for section header duplication (tab + header)
- `renders snippet text beneath result subtitle when present` — verifies snippet text in DOM
- `does not render snippet line when snippet is undefined` — verifies exactly 2 child divs (title + subtitle only)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all UI changes are fully wired. Tabs call `globalSearch` with the selected category. Grouped rendering uses live data from `results`. Snippets render the `snippet` field from `SearchResult` provided by Plan 01's data contract.

## Self-Check: PASSED

- [x] src/components/layout/search-dialog.tsx exists and contains `search.all`
- [x] src/components/layout/search-dialog.tsx contains `StickyNote`, `Package2`
- [x] src/components/layout/search-dialog.tsx contains `SECTION_ORDER`
- [x] src/components/layout/search-dialog.tsx contains `useState<SearchCategory>("all")`
- [x] src/components/layout/search-dialog.tsx contains `result.snippet`
- [x] tests/unit/components/search-dialog.test.tsx exists and contains `renders six category tabs`
- [x] All 5 tests in search-dialog.test.tsx pass (exit 0)
- [x] All 16 Plan 01 tests still pass
- [x] Commit 965610c exists
- [x] Commit 27b43a8 exists
