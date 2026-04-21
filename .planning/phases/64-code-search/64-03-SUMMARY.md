---
phase: 64-code-search
plan: "03"
subsystem: ui
tags: [code-search, ripgrep, i18n, monaco, tabs, filetree]

requires:
  - phase: 64-01
    provides: [searchCode server action, SearchMatch, SearchResult types]
  - phase: 64-02
    provides: [CodeSearch component, CodeEditor selectedLine prop, codeSearch.* i18n keys]

provides:
  - "Files panel inner sub-tabs (文件树 / 搜索) in task-page-client.tsx"
  - "selectedLine state wired from CodeSearch to CodeEditor for Monaco scroll-to-line"
  - "taskPage.tabSearch and taskPage.tabFileTree i18n keys in zh.ts and en.ts"

affects: []

tech-stack:
  added: []
  patterns:
    - "Nested Tabs pattern: inner Tabs within outer TabsContent uses separate context — no value conflicts"
    - "Search-to-editor flow: onResultSelect sets selectedFilePath + selectedLine + switches to files tab"

key-files:
  created: []
  modified:
    - src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx
    - src/lib/i18n/zh.ts
    - src/lib/i18n/en.ts

key-decisions:
  - "Inner Tabs defaults to 'filetree' — user sees file tree by default, searches on demand"
  - "File-tree sub-tab clears selectedLine when selecting — avoids stale scroll on new file"
  - "onResultSelect calls setActiveTab('files') to ensure the files outer tab is visible when navigating from search"

requirements-completed: [SEARCH-01, SEARCH-02, SEARCH-03, SEARCH-04, SEARCH-05]

duration: ~5min
completed: "2026-04-21"
---

# Phase 64 Plan 03: Wire CodeSearch Sub-tabs into Task Page Summary

**Inner file-tree/search sub-tabs wired into task-page-client with selectedLine state, completing end-to-end ripgrep code search with Monaco scroll-to-line navigation.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-21T07:10:00Z
- **Completed:** 2026-04-21T07:13:43Z
- **Tasks:** 3 (Task 3 auto-approved checkpoint)
- **Files modified:** 3

## Accomplishments

- Added `taskPage.tabSearch` and `taskPage.tabFileTree` i18n keys to zh.ts and en.ts
- Replaced flat FileTree in files panel with nested Tabs (filetree / search sub-tabs)
- Added `selectedLine` state that flows from CodeSearch result click to CodeEditor scroll-to-line
- `Search` and `CodeSearch` imported and wired — CodeSearch receives `task.project.localPath`

## Task Commits

1. **Task 1: Add i18n keys for codeSearch** - `48a997c` (feat)
2. **Task 2: Wire search sub-tabs into task-page-client** - `6299a61` (feat)
3. **Task 3: Visual verification** - auto-approved (checkpoint)

## Files Created/Modified

- `src/lib/i18n/zh.ts` - Added taskPage.tabSearch ("搜索") and taskPage.tabFileTree ("文件树")
- `src/lib/i18n/en.ts` - Added taskPage.tabSearch ("Search") and taskPage.tabFileTree ("Files")
- `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` - Added Search icon import, CodeSearch import, selectedLine state, inner Tabs with filetree/search sub-tabs, CodeEditor selectedLine prop

## Decisions Made

- Inner Tabs defaults to `filetree` — existing users see no change to file tree UX
- File-tree `onFileSelect` clears `selectedLine` to prevent stale scroll target when opening different files
- `onResultSelect` calls `setActiveTab("files")` to guarantee the outer files tab is active when navigating from search results

## Deviations from Plan

None - plan executed exactly as written. The `codeSearch.*` i18n keys were already present from Plan 02 (as documented in STATE.md), so only `taskPage.tabSearch` and `taskPage.tabFileTree` were needed.

## Issues Encountered

None. Pre-existing TypeScript errors in test files (Prisma mock type incompatibility) and `task-overview-drawer.tsx` (`common.loading` missing key) were present before this plan and are out of scope.

## Known Stubs

None - full end-to-end flow is wired:
- ripgrep search runs via searchCode server action (Plan 01)
- Results display with highlighting in CodeSearch component (Plan 02)
- Clicking result opens file and scrolls Monaco to the matched line (Plan 03)

## Next Phase Readiness

Phase 64 complete — all SEARCH-01~05 requirements delivered across Plans 01-03.

---
*Phase: 64-code-search*
*Completed: 2026-04-21*
