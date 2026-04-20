---
phase: 17-review-merge-workflow
plan: "02"
subsystem: review-ui
tags: [task-page, diff-view, merge-dialog, sse, review-workflow]
dependency_graph:
  requires: ["17-01"]
  provides: ["task-page-route", "diff-view-component", "merge-confirm-dialog"]
  affects: ["board-navigation", "task-status-flow"]
tech_stack:
  added: []
  patterns: ["server-component-data-fetch", "sse-status-update", "collapsible-diff-blocks"]
key_files:
  created:
    - src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx
    - src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx
    - src/components/task/task-diff-view.tsx
    - src/components/task/task-merge-confirm-dialog.tsx
  modified: []
decisions:
  - "TaskPage serializes Date fields to ISO strings before passing to client component"
  - "Diff auto-fetched via useEffect when taskStatus === IN_REVIEW; refetches on status change"
  - "SSE status_changed event triggers both local state update and router.refresh()"
  - "Conflict warning rendered inline above file list (not toast) for persistent visibility"
  - "Dialog uses base-ui Dialog.Root open/onOpenChange pattern matching existing component API"
metrics:
  duration: "164s"
  completed_date: "2026-03-31"
  tasks_completed: 2
  files_created: 4
  files_modified: 0
---

# Phase 17 Plan 02: Task Page UI with Diff View and Merge Dialog Summary

**One-liner:** Dedicated task review page with 40/60 split layout — left SSE chat panel, right collapsible diff view with GitHub-style line highlighting and squash merge confirmation dialog.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Task page route and client layout with chat panel | 7657dca | page.tsx, task-page-client.tsx |
| 2 | Diff view component and merge confirmation dialog | e5a8cd2 | task-diff-view.tsx, task-merge-confirm-dialog.tsx |

## What Was Built

### Task 1: Task Page Route and Client Layout

**`src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx`** — Server component that:
- Queries task with project include, validates workspaceId ownership
- Serializes Date fields to ISO strings to prevent client hydration errors
- Renders `<TaskPageClient>` with serialized task data

**`src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx`** — Client component with:
- 40/60 flex layout: left chat panel, right tab container
- Left panel: task title, status badge, branch badge, back link to workspace board
- SSE streaming via `POST /api/tasks/{taskId}/stream` — reuses task-detail-panel.tsx logic
- `status_changed` SSE event: updates local `taskStatus` state + calls `router.refresh()`
- Diff auto-fetch via `GET /api/tasks/{taskId}/diff` when `taskStatus === "IN_REVIEW"`
- Loading skeleton (Loader2 spinner) while diff is fetching
- Empty state "Start an execution to see changes" when not IN_REVIEW

### Task 2: Diff View Component and Merge Dialog

**`src/components/task/task-diff-view.tsx`** — Diff display component with:
- Header bar: file count, total +/- line counts, Merge button (only when IN_REVIEW)
- Merge button disabled when `hasConflicts === true`
- Amber conflict warning banner listing conflicting files when blocked
- Per-file collapsible rows: ChevronRight/Down toggle, filename (mono), +/- counts
- Binary files show "Binary" badge instead of line counts
- Expanded view: `<pre>` with per-line color coding:
  - `+` lines: `bg-green-500/10 text-green-400`
  - `-` lines: `bg-red-500/10 text-red-400`
  - `@@` lines: `bg-blue-500/10 text-blue-300`

**`src/components/task/task-merge-confirm-dialog.tsx`** — Squash merge confirmation with:
- Shows: target branch (mono badge), changed files, commits to squash, commit message `feat: {taskTitle}`
- POSTs to `/api/tasks/{taskId}/merge` on confirm
- 409 response: shows inline conflict error with file names
- Loader2 spinner while merging, disabled state prevents double-submit
- Calls `onMergeComplete()` + `router.refresh()` on success

## Decisions Made

- **Date serialization**: Server component serializes `createdAt`/`updatedAt` to ISO strings before passing to client to avoid Next.js serialization warnings
- **Diff auto-fetch**: Triggered by `taskStatus === "IN_REVIEW"` in a `useEffect` — runs on mount and when status changes via SSE
- **SSE status update**: Both local state `setTaskStatus(event.status)` and `router.refresh()` are called — local state for immediate UI, refresh for server data sync
- **Conflict warning inline**: Rendered as a persistent amber section above the file list rather than a toast — users need to see it while reviewing files
- **Dialog open pattern**: Uses `open`/`onOpenChange` props matching the base-ui Dialog.Root API as implemented in `src/components/ui/dialog.tsx`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data flows are wired. Diff data comes from real API, merge triggers real git operation.

## Self-Check: PASSED

All 4 files exist. Both commits verified (7657dca, e5a8cd2). TypeScript compiles with zero new errors.
