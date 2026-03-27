---
phase: "03"
plan: "01"
subsystem: agent-prompt-management
tags: [server-actions, i18n, testing, prisma, transactions]
dependency_graph:
  requires: []
  provides: [setDefaultPrompt-server-action, prompt-crud-i18n-keys, prompts-config-test-scaffold]
  affects: [src/actions/prompt-actions.ts, src/lib/i18n.tsx, tests/unit/components/prompts-config.test.tsx]
tech_stack:
  added: []
  patterns: [db.$transaction for atomic isDefault exclusivity, vi.spyOn for server action mocking]
key_files:
  created:
    - tests/unit/components/prompts-config.test.tsx
  modified:
    - src/actions/prompt-actions.ts
    - src/lib/i18n.tsx
decisions:
  - "revalidatePath called inside db.$transaction return block to ensure only called on commit success"
  - "workspaceId scoping in setDefaultPrompt: when provided, only clears defaults in same workspace; when absent, clears all"
  - "Test scaffold uses vi.spyOn on imported promptActions module rather than vi.mock for easier targeted mocking"
metrics:
  duration: "3 minutes"
  completed_date: "2026-03-27"
  tasks_completed: 3
  files_modified: 3
---

# Phase 03 Plan 01: Backend Infrastructure for Prompt Management Summary

**One-liner:** Atomic setDefaultPrompt action via db.$transaction, 18 i18n CRUD keys per locale, and 8-case test scaffold for PromptsConfig component.

## What Was Built

### Task 1: setDefaultPrompt Server Action
Added `setDefaultPrompt(promptId, workspaceId?)` to `src/actions/prompt-actions.ts`. Uses `db.$transaction()` to atomically clear all existing `isDefault: true` records (optionally scoped to `workspaceId`) then set the new default. Revalidates `/workspaces` and `/settings` on commit.

### Task 2: i18n Translation Keys
Added 18 new `settings.prompts.*` keys to both `zh` and `en` translation objects in `src/lib/i18n.tsx`. Keys cover the full CRUD UI: title, newPrompt, editPrompt, promptName, promptDescription, promptContent, deleteConfirmTitle, deleteConfirmMessage, setDefault, default, empty, emptyHint, save, cancel, delete.

### Task 3: PromptsConfig Test Scaffold
Created `tests/unit/components/prompts-config.test.tsx` with 8 test cases covering:
- PMPT-01: create dialog opens
- PMPT-02: edit dialog opens with pre-filled data
- PMPT-03: delete confirmation dialog opens
- PMPT-04: `setDefaultPrompt` server action is called
- PMPT-05: list rendering with names, descriptions, default badge, empty state

Tests are RED until Plan 02 creates the `PromptsConfig` component.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 0006cef | feat(03-01): add setDefaultPrompt server action with db.$transaction |
| Task 2 | a0850a6 | feat(03-01): add i18n translation keys for prompt CRUD UI |
| Task 3 | 4c4c4ed | test(03-01): create PromptsConfig unit test scaffold |

## Decisions Made

1. **revalidatePath inside transaction**: Calling `revalidatePath` inside the `db.$transaction` callback ensures cache invalidation only fires on successful commit.
2. **workspaceId scoping**: The `setDefaultPrompt` function accepts optional `workspaceId`. When provided, only clears defaults in the same workspace. This matches D-02 from CONTEXT.md (global vs workspace-scoped defaults).
3. **vi.spyOn vs vi.mock**: Test scaffold uses `vi.spyOn(promptActions, "setDefaultPrompt")` rather than a module-level `vi.mock` call, allowing per-test control without affecting other tests.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. All files contain real implementation code or placeholder test stubs that are explicitly intended to be RED until Plan 02 provides the component.

## Self-Check: PASSED

- [x] `src/actions/prompt-actions.ts` exists and exports `setDefaultPrompt`
- [x] `src/lib/i18n.tsx` contains 40 `settings.prompts` keys (zh + en combined)
- [x] `tests/unit/components/prompts-config.test.tsx` exists with 8 test cases
- [x] Commits 0006cef, a0850a6, 4c4c4ed verified in git log
