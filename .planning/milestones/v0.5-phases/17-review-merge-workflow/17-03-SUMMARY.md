---
phase: 17-review-merge-workflow
plan: "03"
subsystem: ui-drawer
tags: [ui, i18n, task-detail, diff-view, navigation]
dependency_graph:
  requires: ["17-01", "17-02"]
  provides: ["enhanced-drawer", "phase17-i18n"]
  affects: ["task-detail-panel", "board-page-client", "i18n"]
tech_stack:
  added: []
  patterns: ["tab-switcher", "sse-status-change-handler", "diff-fetch-on-demand"]
key_files:
  created: []
  modified:
    - src/components/task/task-detail-panel.tsx
    - src/app/workspaces/[workspaceId]/board-page-client.tsx
    - src/lib/i18n.tsx
decisions:
  - "workspaceId passed from BoardPageClient into TaskDetailPanel for navigation"
  - "Diff fetch is lazy (only when Changes tab active + IN_REVIEW status)"
  - "status_changed SSE event triggers both local state update and router.refresh()"
  - "i18n keys use {count} interpolation placeholders for numeric values"
metrics:
  duration: "~3min"
  completed: "2026-03-31"
  tasks_completed: 2
  files_modified: 3
---

# Phase 17 Plan 03: Drawer Enhancements + i18n Summary

**One-liner:** Enhanced task detail drawer with View Details navigation, Conversation/Changes tabs, diff loading in Changes tab, SSE status_changed handling, and full Phase 17 bilingual i18n keys.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Drawer enhancements — View Details button, tab switcher, status_changed handling | 6eb764d | task-detail-panel.tsx, board-page-client.tsx |
| 2 | i18n keys for all Phase 17 UI strings | 4c93154 | i18n.tsx |

## What Was Built

### Task 1: Drawer Enhancements

**`src/components/task/task-detail-panel.tsx`** — Enhanced with:
- `workspaceId: string` added to `TaskDetailPanelProps`
- `useRouter` for navigation
- `activeTab` state (`"conversation" | "changes"`)
- `diffData` and `isLoadingDiff` state for diff API response
- `taskStatus` local state (initially from `task.status`, updated by SSE)
- Lazy diff fetch: useEffect fires when `activeTab === "changes"` AND `taskStatus === "IN_REVIEW"`
- SSE `status_changed` event handling: updates `taskStatus` state + calls `router.refresh()`
- Tab bar JSX: two buttons for Conversation/Changes tabs
- View Details button: navigates to `/workspaces/${workspaceId}/tasks/${task.id}`
- Conditional content: conversation view OR diff view (loading skeleton / TaskDiffView / "no changes" message)

**`src/app/workspaces/[workspaceId]/board-page-client.tsx`** — Updated `<TaskDetailPanel>` to pass `workspaceId={workspaceId}`.

### Task 2: i18n Keys

**`src/lib/i18n.tsx`** — Added 3 new sections to both `zh` and `en` objects:
- `taskPage.*` (8 keys): title, backToBoard, conversation, changes, viewDetails, noChanges, startExecution, loadingDiff
- `diff.*` (7 keys): filesChanged, additions, deletions, binary, truncated, conflictWarning, conflictFiles
- `merge.*` (12 keys): button, confirmTitle, targetBranch, changedFiles, commitsToSquash, commitMessage, confirm, cancel, merging, success, conflictError, failed

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all UI strings are wired and the diff view renders real data from the diff API.

## Self-Check: PASSED

- [x] `src/components/task/task-detail-panel.tsx` exists and contains `workspaceId: string`, `useRouter`, `activeTab`, `"conversation"`, `"changes"`, `ExternalLink`, `viewDetails`, `api/tasks/${task.id}/diff`, `status_changed`, `TaskDiffView`, `router.push`
- [x] `src/app/workspaces/[workspaceId]/board-page-client.tsx` contains `workspaceId={workspaceId}` passed to TaskDetailPanel
- [x] `src/lib/i18n.tsx` contains `"taskPage.title"`, `"taskPage.conversation"`, `"taskPage.changes"`, `"taskPage.viewDetails"`, `"diff.filesChanged"`, `"merge.button"`, `"merge.confirmTitle"`, `"merge.success"` in both zh and en sections
- [x] `npx tsc --noEmit` exits with only 2 pre-existing errors in agent-config-actions.ts (unrelated to this phase)
- [x] Commits 6eb764d and 4c93154 exist
