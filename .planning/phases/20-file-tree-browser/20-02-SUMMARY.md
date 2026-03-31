---
phase: 20-file-tree-browser
plan: "02"
subsystem: file-actions
tags: [server-actions, file-system, security, git-status]
dependency_graph:
  requires:
    - 20-01  # fs-security.ts (safeResolvePath) and test scaffold
  provides:
    - src/actions/file-actions.ts with 6 exported functions + FileEntry type
  affects:
    - 20-03  # FileTree UI will call listDirectory, getGitStatus, createFile, createDirectory, renameEntry, deleteEntry
tech_stack:
  added:
    - ignore@7.0.5 (gitignore pattern matching)
  patterns:
    - "use server" directive on all file operations
    - Zod schema validation at action entry points
    - safeResolvePath guard on every fs path operation
    - execFileSync with args array (never execSync with template string)
    - path.relative(worktreePath, ...) before ig.ignores() call
key_files:
  created:
    - src/actions/file-actions.ts
  modified:
    - tests/unit/actions/file-actions.test.ts
decisions:
  - ".git guard in deleteEntry fires BEFORE safeResolvePath to ensure unconditional protection (D-10)"
  - "listDirectory uses path.relative(worktreePath, absolutePath) before ig.ignores() — ignore package requires worktree-relative paths, not absolute"
  - "getGitStatus returns empty {} on any error — callers degrade gracefully rather than surfacing git errors to UI"
  - "createFile uses wx flag (fail if exists) to prevent accidental overwrites"
metrics:
  duration: 180s
  completed_date: "2026-03-31"
  tasks_completed: 2
  files_changed: 2
---

# Phase 20 Plan 02: File Server Actions Summary

File operation server actions with full unit test coverage — 6 functions guarded by safeResolvePath, gitignore filtering via ignore package, execFileSync for git status parsing.

## What Was Built

`src/actions/file-actions.ts` exports the complete server-side API layer for file operations:

- **FileEntry** interface: `{ name, relativePath, isDirectory, gitStatus? }`
- **listDirectory(worktreePath, relativePath)**: Sorted entries (dirs first, then alpha), gitignore-filtered, .git always hidden
- **getGitStatus(worktreePath, baseBranch, taskBranch)**: Parses `git diff --name-status` output to `Record<string, "M"|"A"|"D">`, returns `{}` on error
- **createFile(worktreePath, relativePath)**: `writeFile` with `wx` flag (fail-if-exists)
- **createDirectory(worktreePath, relativePath)**: `mkdir({ recursive: true })`
- **renameEntry(worktreePath, old, new)**: Validates both paths via safeResolvePath, calls `rename()`
- **deleteEntry(worktreePath, relativePath)**: `.git` guard before path resolution, `stat()` to choose `rm({ recursive, force })` vs `unlink()`

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | listDirectory + getGitStatus with tests | 9b64908 | src/actions/file-actions.ts, tests/unit/actions/file-actions.test.ts |
| 2 | CRUD server actions (createFile/createDirectory/renameEntry/deleteEntry) with tests | 9b64908 | src/actions/file-actions.ts, tests/unit/actions/file-actions.test.ts |

## Test Results

All 14 tests passing, 0 todo stubs remaining:

- `listDirectory` — 4 tests: sort order, gitignore filtering, .git always filtered, dirs-first-then-alpha
- `createFile` — 2 tests: file creation with wx flag, path traversal rejection
- `createDirectory` — 1 test: recursive mkdir
- `renameEntry` — 1 test: both paths validated via safeResolvePath
- `deleteEntry` — 3 tests: file deletion, .git guard, recursive directory deletion
- `getGitStatus` — 3 tests: M/A/D parsing, empty map on error, unrecognized status letters ignored

## Deviations from Plan

None — plan executed exactly as written. Both tasks implemented and committed atomically.

## Known Stubs

None. All functions fully implemented with real logic.

## Self-Check: PASSED

- [x] `src/actions/file-actions.ts` exists and exports FileEntry + 6 functions
- [x] `tests/unit/actions/file-actions.test.ts` has 14 passing tests (0 todo)
- [x] Commit 9b64908 exists
- [x] No `execSync` in file-actions.ts (only `execFileSync` with args array)
- [x] `ig.ignores()` called after `path.relative(worktreePath, ...)`
- [x] No `console.log` in file-actions.ts
