---
phase: 61
plan: 01
subsystem: project-create-dialog
tags: [form-ux, i18n, tilde-warning, browse-button-removal]
dependency_graph:
  requires: []
  provides: [create-project-dialog-plain-input, tilde-warning-i18n]
  affects: [src/components/project/create-project-dialog.tsx, src/lib/i18n/zh.ts, src/lib/i18n/en.ts]
tech_stack:
  added: []
  patterns: [conditional-warning-label, i18n-key-addition]
key_files:
  created: []
  modified:
    - src/components/project/create-project-dialog.tsx
    - src/lib/i18n/zh.ts
    - src/lib/i18n/en.ts
decisions:
  - Removed FolderBrowserDialog entirely from create dialog — browse pattern belongs only in import flow
  - Tilde warning uses amber-400 text with AlertCircle icon consistent with existing error patterns in the file
metrics:
  duration_seconds: 100
  completed_date: "2026-04-21"
  tasks_completed: 2
  files_modified: 3
---

# Phase 61 Plan 01: Remove Browse Button & Add Tilde Warning Summary

Plain text localPath input in create-project-dialog with conditional tilde warning using AlertCircle + amber text.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Remove browse button and add tilde warning | a4b77d1 | src/components/project/create-project-dialog.tsx |
| 2 | Add i18n keys for tilde warning | 0069f8d | src/lib/i18n/zh.ts, src/lib/i18n/en.ts |

## What Was Built

- Removed `FolderBrowserDialog` import and `showFolderBrowser` state from `create-project-dialog.tsx`
- Replaced the `flex gap-2` div containing Input + Browse Button with a single full-width `Input` (`mt-1.5 font-mono text-xs w-full`)
- Added conditional tilde warning `<p>` below the Input, shown when `localPath.trim().startsWith("~")`
- Added `project.tildeWarning` key to both zh.ts and en.ts

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all functionality is wired.

## Self-Check: PASSED

- [x] `create-project-dialog.tsx` exists at `src/components/project/create-project-dialog.tsx`
- [x] `zh.ts` and `en.ts` contain `project.tildeWarning` key
- [x] Commits a4b77d1 and 0069f8d exist
- [x] No TypeScript errors in modified files
