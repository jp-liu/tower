---
phase: 20-file-tree-browser
plan: 03
subsystem: file-tree-ui
tags: [file-tree, react, i18n, lazy-loading, polling, context-menu]
dependency_graph:
  requires:
    - 20-01 (safeResolvePath utility)
    - 20-02 (file-actions server actions: listDirectory, getGitStatus, createFile, createDirectory, renameEntry, deleteEntry)
  provides:
    - FileTree component with lazy loading, auto-refresh, git status badges
    - FileTreeNode recursive component with icons, inline rename, ghost row create
    - FileTreeContextMenu portal with CRUD menu items
    - 15 taskPage.fileTree.* i18n keys in zh and en
    - Task page wired with worktreePath from latest TaskExecution
  affects:
    - src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx
    - src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx
tech_stack:
  added: []
  patterns:
    - Portal-based context menu via createPortal into document.body
    - Lazy-loaded children via childrenMap (Map<string, FileEntry[]>)
    - Auto-refresh interval (2s) only during RUNNING status; preserves expandedPaths Set
    - Inline rename input and ghost row create within FileTreeNode
    - shadcn Dialog for delete confirmation
key_files:
  created:
    - src/components/task/file-tree.tsx
    - src/components/task/file-tree-node.tsx
    - src/components/task/file-tree-context-menu.tsx
  modified:
    - src/lib/i18n.tsx (15 fileTree keys × 2 locales = 30 entries)
    - src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx (getTaskExecutions + serializedExecution)
    - src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx (latestExecution prop, FileTree wiring)
    - tests/unit/components/file-tree.test.tsx (6 real tests replacing it.todo stubs)
decisions:
  - Remove path module from client components; use string manipulation for path construction (browser-safe)
  - Use I18nProvider wrapper in tests to satisfy useI18n context requirement
  - common.cancel key reused in delete dialog cancel button
metrics:
  duration: ~15 minutes
  completed_date: "2026-03-31"
  tasks_completed: 2
  files_changed: 7
---

# Phase 20 Plan 03: FileTree UI Components and Task Page Integration Summary

**One-liner:** Recursive FileTree component with lazy-loaded children, 2s polling during execution, git status badges (M/A/D), portal context menu, inline rename/create, delete confirmation dialog — wired into task workbench Files tab via latestExecution prop from server.

## Tasks Completed

### Task 1: Add i18n keys and create FileTree + FileTreeNode components

**Commit:** f72e59b

Added 15 `taskPage.fileTree.*` keys to both zh and en locales in `src/lib/i18n.tsx`.

Created `src/components/task/file-tree-node.tsx` — recursive node component:
- 8px per-depth indentation using inline style
- File type icons: FileCode (.ts/.tsx), FileJson (.json), FileText (.md), Palette (.css/.scss/.sass), Folder/FolderOpen (dirs), File (default)
- ChevronRight/ChevronDown for expand/collapse
- Git status badge (M/A/D) with amber/emerald/red colors
- Inline rename input with Enter to submit, Escape to cancel
- Ghost row for inline file/folder creation inside directories

Created `src/components/task/file-tree-context-menu.tsx` — portal context menu:
- Uses `createPortal` into `document.body` at fixed position z-9999
- Items: New File, New Folder, Rename, Delete (destructive styling)
- Delete item omitted when `entry.name === ".git"` (D-10 protection)
- Dismiss via mousedown outside or Escape key

Created `src/components/task/file-tree.tsx` — root FileTree component:
- Empty state with FolderTree icon when worktreePath is null
- Load error state with AlertCircle icon + retry
- Empty directory state with Folder icon
- Lazy loads children on first expand via childrenMap
- Auto-refresh every 2s when executionStatus === "RUNNING"; preserves expandedPaths
- getGitStatus called on initial load when baseBranch and worktreeBranch are available
- Delete confirmation Dialog with different text for files vs folders
- All CRUD operations (rename, create, delete) call server actions then refresh

### Task 2: Wire FileTree into task page and fill component tests

**Commit:** de4e49f

Updated `page.tsx`:
- Imports `getTaskExecutions` from agent-actions
- Fetches latest execution and serializes worktreePath/worktreeBranch/status
- Passes `latestExecution` to TaskPageClient

Updated `task-page-client.tsx`:
- Added `latestExecution` to `TaskPageClientProps` interface
- Added `selectedFilePath` state (ready for Phase 21 Monaco editor wiring)
- Replaced Files tab placeholder with live `<FileTree>` component
- Changed Files tab `className` from `overflow-auto` to `overflow-hidden`

Updated `tests/unit/components/file-tree.test.tsx`:
- Replaced all 6 `it.todo` stubs in `describe("FileTree")` with real tests
- Tests wrapped in `I18nProvider` to satisfy i18n context requirement
- All 6 tests pass; 4 `it.todo` stubs in `describe("FileTreeNode")` remain for future

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] path module removed from client components**
- **Found during:** Task 1 implementation
- **Issue:** Node.js `path` module in client components would cause browser compatibility issues
- **Fix:** Replaced `path.join`, `path.relative`, `path.dirname` with string manipulation using template literals and `lastIndexOf("/")`
- **Files modified:** src/components/task/file-tree.tsx, src/components/task/file-tree-node.tsx
- **Commit:** f72e59b (included in Task 1 commit)

**2. [Rule 2 - Missing Critical Functionality] I18nProvider wrapper added to tests**
- **Found during:** Task 2 — test execution
- **Issue:** `useI18n` hook throws when rendered outside `I18nProvider`; tests were failing
- **Fix:** Added `renderWithI18n()` helper that wraps components in `I18nProvider`
- **Files modified:** tests/unit/components/file-tree.test.tsx
- **Commit:** de4e49f

**3. [Rule 2 - Missing Critical Functionality] cancel button in delete dialog uses common.cancel**
- **Found during:** Task 1 implementation
- **Issue:** Plan didn't specify a cancel button text for the delete dialog
- **Fix:** Used existing `common.cancel` ("取消") key instead of adding a new key
- **Files modified:** src/components/task/file-tree.tsx
- **Commit:** f72e59b

## Test Results

```
File-tree component tests: 6/6 passing, 4 todo
Full suite: 280 passing, 12 failing (pre-existing failures in board-stats and prompts-config — not caused by this plan)
```

Pre-existing failures confirmed pre-date this plan: board-stats.test.tsx (3 failures — useI18n without provider) and prompts-config.test.tsx (8 failures — useRouter without app router + useI18n). These were NOT introduced by this plan.

## Checkpoint Pending

Task 3 is a `checkpoint:human-verify` — the human must verify the file tree browser in the browser before this plan is marked complete.

## Self-Check: PASSED

Files verified:
- src/components/task/file-tree.tsx ✓
- src/components/task/file-tree-node.tsx ✓
- src/components/task/file-tree-context-menu.tsx ✓
- src/lib/i18n.tsx ✓
- src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx ✓
- src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx ✓
- tests/unit/components/file-tree.test.tsx ✓

Commits verified:
- f72e59b: feat(20-03): add FileTree components and i18n keys ✓
- de4e49f: feat(20-03): wire FileTree into task page and fill component tests ✓
