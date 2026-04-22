---
title: Task
description: Core work unit with status flow, labels, executions, and messages
---

# Task Module

**Slug:** `task`

## Overview

Tasks are the core work unit in Tower, displayed as Kanban cards on the board. Each task moves through 5 status states (TODO, IN_PROGRESS, IN_REVIEW, DONE, CANCELLED) to represent workflow progress, and can be assigned one of 4 priority levels (LOW, MEDIUM, HIGH, CRITICAL). Tasks support custom labels for flexible categorization and can be pinned to stay at the top of their column.

When creating a task, you can set a base branch for Git worktree isolation — each task execution then works on an independent branch without affecting the main codebase. Clicking "Execute" on a task spawns a PTY terminal running Claude CLI in that isolated environment. On completion, Tower auto-generates an execution summary and Dreaming insights that capture what was accomplished and learned.

## Details

- **Status workflow**: Tasks flow through 5 columns on the Kanban board. Dragging a card between columns or using the context menu updates the status.
- **Priority levels**: LOW, MEDIUM, HIGH, and CRITICAL. Priority badges are visible on task cards for quick scanning.
- **Labels**: Assigned from the workspace's label pool. Label assignment is a full replacement — pass the complete set of desired labels each time.
- **Worktree isolation**: When `useWorktree` is enabled and a `baseBranch` is specified, each task execution runs in a separate Git worktree with its own branch.
- **Execution lifecycle**: Each task can have multiple execution records tracking agent runs, with session IDs for resumption support.

## Data Model

```
Task (id, title, description?, status, priority, order)
  ├── TaskLabel[] → Label
  ├── TaskExecution[]
  └── TaskMessage[]
```

- `status`: `TODO` | `IN_PROGRESS` | `IN_REVIEW` | `DONE` | `CANCELLED`
- `priority`: `LOW` | `MEDIUM` | `HIGH` | `CRITICAL`
- `order`: Sorting within Kanban columns (ascending, lower values appear higher)
- `projectId`: FK to Project, cascade delete

## File Reference

### Server Actions (`src/actions/task-actions.ts`)

| Function | Description |
|----------|-------------|
| `createTask({ title, projectId, ... })` | Create task |
| `updateTask(taskId, data)` | Update task |
| `updateTaskStatus(taskId, status)` | Status transition |
| `deleteTask(taskId)` | Delete task |
| `getProjectTasks(projectId)` | Get all tasks for a project |

### Pages

| Route | File | Description |
|-------|------|-------------|
| `/workspaces/[id]/tasks/[taskId]` | `task-page-client.tsx` | Task detail page |

### Components (`src/components/task/`)

| Component | Description |
|-----------|-------------|
| `task-detail-panel.tsx` | Task metadata panel |
| `task-terminal.tsx` | Terminal UI |
| `task-diff-view.tsx` | Git diff view |
| `task-merge-confirm-dialog.tsx` | Merge confirmation |
| `code-editor.tsx` | Code editor |
| `file-tree.tsx` | File tree |
| `execution-timeline.tsx` | Execution history timeline |

### MCP Tools (`src/mcp/tools/task-tools.ts`)

- `list_tasks` / `create_task` / `update_task` / `move_task` / `delete_task`

### Label Subsystem

- Server Actions: `src/actions/label-actions.ts`
- MCP Tools: `src/mcp/tools/label-tools.ts`
- `set_task_labels` / `setTaskLabels` perform a full replacement (not a merge)

## Constraints

- The `order` field controls Kanban sorting; do not break existing ordering when creating tasks
- Label replacement is a full replacement operation; pass the complete `labelIds` array
- Deleting a task cascades to its Messages and Executions
