---
phase: 12-git-path-mapping-rules
plan: "02"
subsystem: ui
tags: [react, i18n, settings, crud, system-config]

requires:
  - phase: 12-git-path-mapping-rules/12-01
    provides: GitPathRule type, getConfigValue/setConfigValue server actions, SystemConfig DB model
  - phase: 11
    provides: SystemConfig DB table and config-actions.ts server actions

provides:
  - Git Path Mapping Rules CRUD UI in Settings > Config
  - 23 bilingual i18n keys (settings.config.git.*)
  - Inline add form and inline row editing for GitPathRule
  - Delete confirmation Dialog
  - Input validation: host and localPathTemplate required
  - Smoke test for SystemConfig component

affects:
  - phase 13 (system params config UI — same settings page)
  - phase 14 (CFG-02 realtime config — consumers of SystemConfig)

tech-stack:
  added: []
  patterns:
    - Inline table row editing (no Dialog) for CRUD operations
    - Immutable array updates (spread/filter/map) for rule management
    - Server action as persistence layer with local state mirroring

key-files:
  created:
    - tests/unit/components/system-config.test.tsx
  modified:
    - src/lib/i18n.tsx
    - src/components/settings/system-config.tsx

key-decisions:
  - "Inline table row edit (not Dialog) per D-10 — less modal overhead for tabular data"
  - "Add form as an appended table row (not separate section) — consistent with row editing pattern"
  - "Empty state only when rules=0 AND showAddForm=false — table is immediately visible when adding"

patterns-established:
  - "RuleEditState type for form state — separates mutable draft from persisted GitPathRule"
  - "EMPTY_FORM constant for resetting form state — avoids object literal duplication"

requirements-completed: [GIT-01]

duration: 4min
completed: 2026-03-30
---

# Phase 12 Plan 02: Git Path Mapping Rules Settings UI Summary

**Inline CRUD table UI for GitPathRule in Settings > Config with bilingual i18n, input validation, persistence via setConfigValue, and a smoke test**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-30T10:05:58Z
- **Completed:** 2026-03-30T10:09:40Z
- **Tasks:** 2 (1 auto + 1 checkpoint auto-approved)
- **Files modified:** 3

## Accomplishments

- Replaced placeholder SystemConfig component with full inline CRUD UI for GitPathRule objects
- Added 23 bilingual i18n translation keys (settings.config.git.*) in both zh and en
- handleAddRule and handleEditSave validate that host and localPathTemplate are non-empty before saving
- Rules persist to SQLite via setConfigValue("git.pathMappingRules") and load on mount via getConfigValue
- Smoke test verifies component renders and shows git rules section heading

## Task Commits

Each task was committed atomically:

1. **Task 1: i18n keys, SystemConfig CRUD UI replacement, and smoke test** - `2c83944` (feat)
2. **Task 2: Visual verification** - auto-approved checkpoint (no code changes)

## Files Created/Modified

- `src/lib/i18n.tsx` - Added 23 bilingual keys for settings.config.git.* (zh + en)
- `src/components/settings/system-config.tsx` - Full CRUD component replacing placeholder (293 lines)
- `tests/unit/components/system-config.test.tsx` - Smoke test: renders + shows git rules heading

## Decisions Made

- Inline table row editing (not Dialog) per plan decision D-10 — reduces modal overhead for tabular data
- Add form appended as a table row — keeps add experience consistent with inline edit
- Empty state dashed div only shown when rules=0 AND showAddForm=false — table appears immediately on add

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed smoke test using getByText without cleanup between renders**
- **Found during:** Task 1 (smoke test creation)
- **Issue:** Second test re-rendered without cleanup, causing `getByText` to find 2 matches and throw
- **Fix:** Added `afterEach(() => cleanup())` to the test file
- **Files modified:** `tests/unit/components/system-config.test.tsx`
- **Verification:** `npx vitest run tests/unit/components/system-config.test.tsx` — 2 passed
- **Committed in:** 2c83944 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in test setup)
**Impact on plan:** Single minor fix, no scope creep, all plan goals achieved as specified.

## Issues Encountered

Pre-existing test failures in `board-stats.test.tsx` and `prompts-config.test.tsx` (11 tests) were present before this plan and are unrelated to changes made here. My new smoke test passes cleanly.

## Next Phase Readiness

- Settings > Config now shows Git Path Mapping Rules CRUD
- Users can add rules that will be consumed by resolveGitLocalPath (wired in Phase 12-01)
- Phase 13 (system params config UI) can use the same settings page pattern
- Phase 14 (CFG-02 realtime config) can wire reactivity on top of the existing setConfigValue calls

---
*Phase: 12-git-path-mapping-rules*
*Completed: 2026-03-30*
