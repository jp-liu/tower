---
phase: 54-error-handling-refactoring
plan: 01
subsystem: ui
tags: [i18n, typescript, refactoring, error-handling, toast]

# Dependency graph
requires: []
provides:
  - src/lib/i18n/ directory with zh.ts, en.ts, types.ts language modules
  - i18n.tsx slimmed from 1192 lines to 64 lines, imports from submodules
  - TranslationKey type exported from i18n module
  - User-visible toast.error for diff load failures in task-page-client.tsx
  - "taskPage.loadDiffFailed" i18n key in both zh.ts and en.ts
affects: [task-page, i18n consumers, future translation additions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Language module split: translations in zh.ts/en.ts, types in types.ts, thin re-export in i18n.tsx"
    - "Translations type enforcement: en.ts typed as Translations (derived from zh keys) to enforce key parity at compile time"

key-files:
  created:
    - src/lib/i18n/zh.ts
    - src/lib/i18n/en.ts
    - src/lib/i18n/types.ts
  modified:
    - src/lib/i18n.tsx
    - src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx

key-decisions:
  - "zh.ts uses as const (source of truth for TranslationKey), en.ts uses Translations type (enforces key parity at compile time)"
  - "i18n.tsx kept to 64 lines — only React context, provider, hook, and imports"
  - "loadDiffFailed key added proactively during Task 1 to both language files, used in Task 2"

patterns-established:
  - "Language files: add new keys to both zh.ts and en.ts; en.ts type will catch missing keys at compile time"

requirements-completed: [ERR-01, REF-01]

# Metrics
duration: 15min
completed: 2026-04-20
---

# Phase 54 Plan 01: Error Handling Refactoring Summary

**i18n.tsx split from 1192 lines to 64 lines via zh.ts/en.ts language modules; silent diff-load catches replaced with user-visible toast.error notifications**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-20T09:50:00Z
- **Completed:** 2026-04-20T10:05:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Split monolithic i18n.tsx (1192 lines) into zh.ts (~574 lines), en.ts (~559 lines), types.ts (4 lines), and a 64-line thin wrapper
- TranslationKey type now derived from zh.ts keys; en.ts is typed as Translations (enforcing key parity at compile time)
- All existing imports of useI18n, I18nProvider, Locale, TranslationKey continue to work unchanged
- Replaced 2 silent `.catch(() => {})` patterns in task-page-client.tsx with `toast.error(t("taskPage.loadDiffFailed"))` calls
- Added "taskPage.loadDiffFailed" key to both language files

## Task Commits

1. **Task 1: Split i18n.tsx into language modules** - `bdb1ae3` (refactor)
2. **Task 2: Replace silent catches with toast.error** - `7541cb6` (fix)

## Files Created/Modified
- `src/lib/i18n/zh.ts` - Chinese translations object (574 lines, as const)
- `src/lib/i18n/en.ts` - English translations typed as Translations (559 lines)
- `src/lib/i18n/types.ts` - TranslationKey and Translations types (4 lines)
- `src/lib/i18n.tsx` - Thin wrapper: imports from submodules, re-exports types (64 lines, was 1192)
- `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` - Silent catches → toast.error

## Decisions Made
- zh.ts uses `as const` (source of truth for TranslationKey); en.ts uses `Translations` type — any missing en key is a TypeScript compile error
- i18n.tsx local `TranslationKey` type kept for internal use; external consumers get it via `export type { TranslationKey }` re-export
- The `loadDiffFailed` i18n key was added to both language files during Task 1 (when zh.ts/en.ts were written) and used in Task 2

## Deviations from Plan

None - plan executed exactly as written. The `loadDiffFailed` key was included in both language files upfront during Task 1 per the plan's instruction to add it to zh.ts and en.ts (mentioned in Task 2 action), which was a harmless ordering optimization.

## Issues Encountered
None - TypeScript check confirmed no production type errors. All 809 tests pass.

## Known Stubs
None.

## Next Phase Readiness
- Phase 54 Plan 02 can proceed (REF-02: `as any` type cast cleanup)
- Any future translation additions should add keys to both zh.ts and en.ts; the Translations type enforces parity

## Self-Check: PASSED
- All created files exist on disk
- Both task commits (bdb1ae3, 7541cb6) verified in git log

---
*Phase: 54-error-handling-refactoring*
*Completed: 2026-04-20*
