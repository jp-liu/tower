---
phase: 61
plan: 03
subsystem: git-api-backend, create-project-dialog, import-project-dialog
tags: [form-ux, backend-validation, tilde-rejection, textarea-overflow]
dependency_graph:
  requires: [61-01, 61-02]
  provides: [tilde-backend-guard, create-dialog-textarea-maxheight, form-02-03-verified]
  affects:
    - src/app/api/git/route.ts
    - src/components/project/create-project-dialog.tsx
tech_stack:
  added: []
  patterns: [early-return-validation, tailwind-max-height]
key_files:
  created: []
  modified:
    - src/app/api/git/route.ts
    - src/components/project/create-project-dialog.tsx
decisions:
  - Tilde check placed after url/path presence guard and before expandHome call — ensures backend rejects ~ before any filesystem resolution
  - FORM-02 and FORM-03 confirmed already correct in import-project-dialog — no changes needed
metrics:
  duration_seconds: 180
  completed_date: "2026-04-21"
  tasks_completed: 2
  files_modified: 2
---

# Phase 61 Plan 03: Backend Tilde Guard + Textarea Max-Height + FORM-02/03 Verification Summary

Backend clone handler rejects ~ paths with HTTP 400, create-project description textarea constrained to 200px max-height, and import-project-dialog FORM-02/03 confirmed correct with no regression.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add tilde rejection to /api/git clone handler and max-height to create-project textarea | 332af41 | src/app/api/git/route.ts, src/components/project/create-project-dialog.tsx |
| 2 | Verify FORM-02 and FORM-03 — no regression in import-project-dialog | c29409a | (verification only, no file changes) |

## What Was Built

- Added `clonePath.startsWith("~")` guard in the POST clone action of `/api/git/route.ts`, returning HTTP 400 with `"请输入绝对路径，不支持 ~ 别名"` before `expandHome` is called (FORM-05)
- Appended `max-h-[200px] overflow-y-auto` to the description `<textarea>` className in `create-project-dialog.tsx` (FORM-04)
- Confirmed `import-project-dialog.tsx` localPath Input has `readOnly` prop (FORM-02) and targetPath Input has `onChange` with no `readOnly`/`disabled` (FORM-03)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all functionality is wired.

## Self-Check: PASSED

- [x] `src/app/api/git/route.ts` exists and contains `clonePath.startsWith("~")` at line 122
- [x] `src/components/project/create-project-dialog.tsx` exists and contains `max-h-[200px]` at line 242
- [x] `import-project-dialog.tsx` has exactly 1 `readOnly` match (line 215 — localPath Input)
- [x] targetPath Input has no `readOnly` or `disabled` prop
- [x] Commits 332af41 and c29409a exist
- [x] All 846 tests pass (73 test files, 7 skipped)
