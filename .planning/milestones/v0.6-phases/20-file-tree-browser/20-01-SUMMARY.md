---
phase: 20-file-tree-browser
plan: 01
subsystem: testing
tags: [vitest, path-security, ignore, fs-security, file-tree]

requires:
  - phase: 19-workbench-entry-layout
    provides: Task workbench layout with resizable panels — foundation for file tree integration

provides:
  - safeResolvePath security utility in src/lib/fs-security.ts for path traversal prevention
  - ignore npm package (v7.0.5) as direct dependency
  - Wave 0 test scaffolds for file-actions and FileTree (it.todo stubs)
  - 6 passing unit tests for safeResolvePath covering all traversal attack vectors

affects:
  - 20-file-tree-browser (Plan 02 and 03 fill these test stubs)
  - 21-monaco-editor (imports safeResolvePath from src/lib/fs-security.ts)

tech-stack:
  added: [ignore@7.0.5]
  patterns:
    - "TDD Red-Green: test file written before implementation, run to fail, then implement"
    - "Path safety pattern: normalizedBase + path.sep prefix check prevents traversal"
    - "Wave 0 stub pattern: it.todo() scaffolds all behaviors before implementation"

key-files:
  created:
    - src/lib/fs-security.ts
    - tests/unit/lib/fs-security.test.ts
    - tests/unit/actions/file-actions.test.ts
    - tests/unit/components/file-tree.test.tsx
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "normalizedBase strategy: strip trailing sep before check, re-add it for prefix comparison — handles /base/ edge case cleanly"
  - "it.todo() stubs for Wave 0: test runner exits 0, Plan 02/03 can immediately add implementations"

patterns-established:
  - "safeResolvePath(base, relative): normalizes base, resolves, checks prefix — throws on escape"
  - "Wave 0 test scaffold: declare all describe blocks with it.todo() stubs matching plan behaviors"

requirements-completed: [FT-01, FT-02, FT-03, FT-05]

duration: 3min
completed: 2026-03-31
---

# Phase 20 Plan 01: File Tree Foundation — Security Utility and Test Scaffolds

**safeResolvePath path-traversal security utility (src/lib/fs-security.ts) with 6 passing tests, ignore@7.0.5 installed, and Wave 0 it.todo test scaffolds for file-actions and FileTree**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-31T11:07:00Z
- **Completed:** 2026-03-31T11:10:45Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Installed `ignore@7.0.5` as a direct dependency (required by Plan 02 for gitignore filtering)
- Created `src/lib/fs-security.ts` with `safeResolvePath` — prevents path traversal attacks via normalized base + path.sep prefix check
- All 6 unit tests pass GREEN (valid subpath, base match, traversal with ../, nested traversal, trailing-slash base, sibling directory)
- Scaffolded `tests/unit/actions/file-actions.test.ts` with 13 `it.todo()` stubs across 6 describe blocks
- Scaffolded `tests/unit/components/file-tree.test.tsx` with 10 `it.todo()` stubs across 2 describe blocks
- All 24 scaffold stubs exit 0 (no failures)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install ignore dependency and create safeResolvePath utility** - `8e8bc15` (feat)
2. **Task 2: Scaffold Wave 0 test files for file-actions and FileTree** - `aaf86ab` (feat)

## Files Created/Modified

- `src/lib/fs-security.ts` - safeResolvePath export: validates relative path stays within base directory
- `tests/unit/lib/fs-security.test.ts` - 6 unit tests covering valid paths and all path traversal vectors
- `tests/unit/actions/file-actions.test.ts` - Wave 0 stubs for listDirectory, createFile, createDirectory, renameEntry, deleteEntry, getGitStatus
- `tests/unit/components/file-tree.test.tsx` - Wave 0 stubs for FileTree and FileTreeNode component behaviors
- `package.json` - ignore@7.0.5 added as direct dependency
- `pnpm-lock.yaml` - lockfile updated

## Decisions Made

- **normalizedBase strategy:** Strip trailing path.sep before resolving, re-add it for prefix comparison. This cleanly handles `/base/` with trailing slash — resolves to `/base` for equality check, then `/base/` prefix for subdirectory check.
- **it.todo() for Wave 0 scaffolds:** All describe/it blocks use `.todo()` so test runner exits 0 without implementations. Plan 02 and Plan 03 convert these to real tests when filling implementations.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The plan suggested running `pnpm test:run -- tests/unit/lib/fs-security.test.ts` with `--` double dash separator, but vitest required running tests without the `--` separator to avoid picking up unrelated test files. Used `pnpm test:run tests/unit/lib/fs-security.test.ts` directly for accurate per-file results.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 (file-actions.ts implementation) can immediately use `safeResolvePath` and fill the it.todo stubs
- Plan 03 (FileTree component) test stubs are ready for implementation
- `ignore` package ready for gitignore filtering in listDirectory action
- safeResolvePath will be reused in Phase 21 monaco editor file operations

## Self-Check: PASSED

- [x] src/lib/fs-security.ts exists and exports safeResolvePath
- [x] tests/unit/lib/fs-security.test.ts exists with 6 passing tests
- [x] tests/unit/actions/file-actions.test.ts exists with it.todo stubs
- [x] tests/unit/components/file-tree.test.tsx exists with it.todo stubs
- [x] Task 1 commit 8e8bc15 exists
- [x] Task 2 commit aaf86ab exists
- [x] ignore@7.0.5 in node_modules

---
*Phase: 20-file-tree-browser*
*Completed: 2026-03-31*
