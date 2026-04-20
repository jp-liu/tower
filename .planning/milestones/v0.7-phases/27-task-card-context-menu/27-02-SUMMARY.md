---
phase: 27-task-card-context-menu
plan: "02"
subsystem: board-ui
tags: [context-menu, kanban, task-launch, pty]
dependency_graph:
  requires: [27-01]
  provides: [context-menu-wired, task-launch-from-board]
  affects: [kanban-board, board-page-client, task-card, board-column]
tech_stack:
  added: []
  patterns: [prop-threading, context-menu-state, pty-launch-from-board]
key_files:
  created: []
  modified:
    - src/app/workspaces/[workspaceId]/page.tsx
    - src/components/board/task-card.tsx
    - src/components/board/board-column.tsx
    - src/components/board/kanban-board.tsx
    - src/app/workspaces/[workspaceId]/board-page-client.tsx
decisions:
  - "startPtyExecution called with empty string prompt from context menu — task title/description already in DB record; user can refine in task detail page"
  - "TaskCardContextMenu rendered inside DndContext but outside DragOverlay — createPortal to document.body avoids z-index and DnD conflicts"
  - "hasExecutions derived via (task as any)._count?.executions ?? 0 — consistent with existing labels pattern using (task as any)"
metrics:
  duration: 180
  completed_date: "2026-04-03T01:48:36Z"
  tasks_completed: 2
  files_modified: 5
requirements:
  - TASK-01
  - TASK-02
  - TASK-03
---

# Phase 27 Plan 02: Wire Task Card Context Menu — Summary

Full component stack wired: page data query now includes `_count.executions`, `onContextMenu` prop threaded from `TaskCard` through `BoardColumn` into `KanbanBoard`, context menu state managed in `KanbanBoard`, and launch/status-change handlers implemented in `BoardPageClient`.

## What Was Built

Right-clicking any task card on the Kanban board now opens a context menu with three functional actions:

1. **Change Status** — submenu with all 5 statuses; selecting one calls `updateTaskStatus` and refreshes the board
2. **Launch Task** — starts PTY execution via `startPtyExecution` and navigates to `/workspaces/{workspaceId}/tasks/{taskId}`; disabled (greyed out) when the task has any prior executions
3. **Go to Detail** — navigates directly to the task workbench page (handled inside `TaskCardContextMenu` from Plan 01)

## Files Modified

| File | Change |
|------|--------|
| `src/app/workspaces/[workspaceId]/page.tsx` | Added `_count: { select: { executions: true } }` to tasks include |
| `src/components/board/task-card.tsx` | Added `onContextMenu` prop + `onContextMenu` handler with `preventDefault`/`stopPropagation` |
| `src/components/board/board-column.tsx` | Added `onContextMenu` prop and forwarded to each `TaskCard` |
| `src/components/board/kanban-board.tsx` | Added context menu state, `handleContextMenu`, new props (`workspaceId`, `onContextMenuStatusChange`, `onContextMenuLaunch`), renders `TaskCardContextMenu` |
| `src/app/workspaces/[workspaceId]/board-page-client.tsx` | Added `startPtyExecution` import, `handleLaunchTask`, `handleContextMenuStatusChange`, wired new props to `KanbanBoard` |

## Final Prop Interfaces

### KanbanBoard (updated)
```typescript
interface KanbanBoardProps {
  initialTasks: Task[];
  onTaskMove?: (taskId: string, newStatus: TaskStatus) => void;
  onTaskClick?: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onAddTask?: (status: TaskStatus) => void;
  onDeleteTask?: (taskId: string) => void;
  onContextMenuStatusChange?: (taskId: string, status: TaskStatus) => void;
  onContextMenuLaunch?: (taskId: string) => void;
  workspaceId?: string;
}
```

### BoardPageClient — new handlers
```typescript
handleLaunchTask: async (taskId: string) => void  // startPtyExecution + router.push
handleContextMenuStatusChange: async (taskId: string, status: TaskStatus) => void  // updateTaskStatus + refreshData
```

## Deviations from Plan

None — plan executed exactly as written.

The `startPtyExecution(taskId, "")` empty-string prompt approach matches the plan's explicit instruction (D-06 from CONTEXT.md): the task title and description are already in the DB record and the server action accesses them directly.

## TypeScript Check

`npx tsc --noEmit` output contains only two pre-existing errors in `src/actions/agent-config-actions.ts` (InputJsonValue type mismatch, unrelated to this plan). Zero new errors introduced.

## Commits

- `9732cbb` — feat(27-02): add execution count to page query and thread onContextMenu through components
- `65237e3` — feat(27-02): wire context menu state into KanbanBoard and BoardPageClient

## Self-Check: PASSED

All modified files verified present. Both commits confirmed in git log.
