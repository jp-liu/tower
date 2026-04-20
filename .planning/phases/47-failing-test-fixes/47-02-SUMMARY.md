---
phase: 47
plan: 02
subsystem: tests/components
tags: [test-fix, component-tests, mocks, i18n, routing]
dependency_graph:
  requires: []
  provides: [passing-component-tests]
  affects: [board-stats, create-task-dialog, prompts-config, asset-item]
tech_stack:
  added: []
  patterns: [vi.mock hoisting, I18nProvider wrapping, accessible button titles]
key_files:
  created: []
  modified:
    - tests/unit/components/board-stats.test.tsx
    - tests/unit/components/create-task-dialog.test.tsx
    - tests/unit/components/prompts-config.test.tsx
    - tests/unit/components/asset-item.test.tsx
    - src/components/settings/prompts-config.tsx
decisions:
  - "Used getAllByRole for setDefault button assertion since both prompts show the button"
  - "Added fetchRemoteBranches to git-actions mock since component calls it after initial load"
  - "Added title attributes to Edit/Delete icon buttons in prompts-config for accessibility and testability"
  - "Fixed dropdown interaction in create-task-dialog test — branches only visible after opening dropdown"
metrics:
  duration: 8m
  completed_date: "2026-04-20"
  tasks_completed: 2
  files_changed: 5
---

# Phase 47 Plan 02: Fix Component Test Failures Summary

Fixed all 4 component test files: board-stats (3 failures), create-task-dialog (2 failures), prompts-config (8 failures), asset-item (1 failure). All 14 tests now pass with `pnpm test:run`. Full suite: 46 passed, 7 skipped, 0 failed.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix board-stats, create-task-dialog, and prompts-config tests | c5b8a37 | 4 files |
| 2 | Fix asset-item test URL assertion | 8f69b1d | 1 file |

## What Was Done

### Task 1: Context providers and mock fixes (c5b8a37)

**board-stats.test.tsx** — Added `I18nProvider` wrapper around all 3 `render()` calls. The `BoardStats` component calls `useI18n()` which throws "useI18n must be used within I18nProvider" without the wrapper.

**create-task-dialog.test.tsx** — Added `getCurrentBranch` and `fetchRemoteBranches` to the `vi.mock("@/actions/git-actions")` factory. The component calls both. Also updated the "renders branch selector" test to open the dropdown before asserting "develop" is present (branches only appear in the dropdown list, while only the selected branch is shown in the trigger button).

**prompts-config.test.tsx** — Added `vi.mock("next/navigation", ...)` and `vi.mock("next/cache", ...)` before component imports. The `PromptsConfig` component calls `useRouter()` which throws "invariant expected app router to be mounted" without the mock. Also changed `getByRole` to `getAllByRole` for the "set default" button assertion since both prompts in the list show the star button.

**prompts-config.tsx** (Rule 2: missing accessible labels) — Added `title` attributes to the Edit and Delete icon-only buttons so they have accessible names required by `getByRole({ name: /编辑/i })` and `getByRole({ name: /删除/i })`.

### Task 2: Asset-item mock path and URL assertion (8f69b1d)

**asset-item.test.tsx** — Two fixes:
1. Changed mock target from `@/lib/file-serve` to `@/lib/file-serve-client` (the component imports from `file-serve-client`, not `file-serve`).
2. Updated mock implementation to extract `projectId/filename` from path (matching real `localPathToApiUrl` behavior) and changed assertion from `/api/files/data/assets/proj-1/photo.png` to `/api/files/assets/proj-1/photo.png`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Accessibility] Added title attributes to icon buttons in prompts-config**
- **Found during:** Task 1
- **Issue:** Edit and Delete buttons in `PromptsConfig` had no accessible name (icon-only, no title/aria-label). Tests could not find them by role+name.
- **Fix:** Added `title={t("settings.prompts.editPrompt")}` and `title={t("settings.prompts.delete")}` to both icon buttons.
- **Files modified:** `src/components/settings/prompts-config.tsx`
- **Commit:** c5b8a37

**2. [Rule 1 - Bug] Fixed create-task-dialog test to open dropdown before checking branch options**
- **Found during:** Task 1
- **Issue:** The test expected `develop` to be visible after branches load, but the component only shows the selected branch in the trigger button. Dropdown must be opened to see all branches.
- **Fix:** Added `fireEvent.click(branchTrigger)` before asserting `develop` is in the document.
- **Files modified:** `tests/unit/components/create-task-dialog.test.tsx`
- **Commit:** c5b8a37

## Known Stubs

None.

## Self-Check

### Files Created/Modified

- [x] tests/unit/components/board-stats.test.tsx — exists
- [x] tests/unit/components/create-task-dialog.test.tsx — exists
- [x] tests/unit/components/prompts-config.test.tsx — exists
- [x] tests/unit/components/asset-item.test.tsx — exists
- [x] src/components/settings/prompts-config.tsx — exists

### Commits

- c5b8a37 — fix(tower-47.02): fix context provider and mock issues in component tests
- 8f69b1d — fix(tower-47.02): fix asset-item mock path and URL assertion

## Self-Check: PASSED
