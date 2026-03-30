---
phase: 14-search-quality-realtime-config
plan: 02
subsystem: search-dialog
tags: [race-condition, debounce, realtime-config, useEffect, cancelled-flag]
dependency_graph:
  requires: [14-01]
  provides: [SRCH-07-race-condition-fix, CFG-02-realtime-config]
  affects: [src/components/layout/search-dialog.tsx]
tech_stack:
  added: []
  patterns: [cancelled-flag-pattern, merged-useEffect-open-config]
key_files:
  created: []
  modified:
    - src/components/layout/search-dialog.tsx
    - tests/unit/components/search-dialog.test.tsx
decisions:
  - Merged mount-only debounceMs fetch into open effect so config reloads on each dialog open
  - cancelled flag declared outside setTimeout at useEffect body level per established pattern
  - Redesigned race condition test to use query string dispatch (stale/fresh) rather than call count to reliably trigger the async race
metrics:
  duration: ~5 min
  completed: "2026-03-30T11:49:07Z"
  tasks: 2
  files_changed: 2
---

# Phase 14 Plan 02: Race Condition Fix + Realtime Config Summary

Cancelled-flag race condition fix and config re-fetch on dialog open for search-dialog.tsx.

## What Was Built

Two targeted changes to `src/components/layout/search-dialog.tsx`:

1. **Race condition fix (SRCH-07):** Added `let cancelled = false` at the useEffect body level, outside the setTimeout callback. Both `setResults(r)` and `setIsSearching(false)` are now guarded by `if (!cancelled)`. The cleanup function sets `cancelled = true` alongside the existing `clearTimeout`. This prevents stale async responses from overwriting more recent search results when the user types rapidly.

2. **Realtime config (CFG-02):** Removed the mount-only `useEffect(() => { getConfigValue(...) }, [])` for debounceMs. Merged the config fetch into the existing open effect — `getConfigValue("search.debounceMs", 250)` now fires every time `open` becomes `true`. This means debounceMs changes in settings take effect the next time the dialog opens, without app restart.

Additionally fixed `setIsSearching(false)` being absent from the early-return path for empty query (spinner stuck state).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix race condition and move config fetch to open effect | 628b902 | src/components/layout/search-dialog.tsx |
| 2 | Add test cases for race condition fix and config re-fetch | 2b1ed52 | tests/unit/components/search-dialog.test.tsx |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed spinner stuck state on empty query clear**
- **Found during:** Task 1
- **Issue:** Original early return for empty query called `setResults([])` but not `setIsSearching(false)`, leaving the spinner active when query was cleared
- **Fix:** Added `setIsSearching(false)` to the early return branch
- **Files modified:** src/components/layout/search-dialog.tsx
- **Commit:** 628b902

### Test Design Adjustment

**Race condition test (SRCH-07) — revised from plan spec**
- **Found during:** Task 2 TDD GREEN phase
- **Issue:** Plan spec used call-count-based dispatch (`callCount === 1 → slow`). When `user.clear()` prevents the "old" timer from firing at all, "new" becomes the first actual call (callCount=1) hitting the slow path — test never saw "New Result"
- **Fix:** Switched to query-string-based dispatch: `query === "stale"` → 800ms delay, anything else → immediate. Added explicit 300ms wait after typing "stale" to let the debounce fire before clearing. Both queries now reliably create the race condition scenario.
- **Commit:** 2b1ed52

## Known Stubs

None. Both changes are fully wired — `getConfigValue` is called from within the open effect and `cancelled` flag directly prevents state updates on stale responses.

## Self-Check: PASSED

- [x] src/components/layout/search-dialog.tsx exists and contains `let cancelled = false`
- [x] src/components/layout/search-dialog.tsx contains `cancelled = true` in cleanup
- [x] src/components/layout/search-dialog.tsx has getConfigValue only inside `if (open)` block (not in `[], []` mount-only effect)
- [x] tests/unit/components/search-dialog.test.tsx contains SRCH-07 describe block
- [x] tests/unit/components/search-dialog.test.tsx contains CFG-02 describe block
- [x] 7/7 tests pass
- [x] commit 628b902 exists
- [x] commit 2b1ed52 exists
