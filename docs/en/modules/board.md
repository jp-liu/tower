---
title: Board
description: Kanban board UI with drag-and-drop, filtering, and a project tab bar
---

# Board Module

**Slug:** `board`

## Overview

The Kanban board visualizes tasks across 5 status columns: TODO, IN_PROGRESS, IN_REVIEW, DONE, and CANCELLED. Drag cards between columns to update their status, or drag within a column to reorder. A right-click context menu provides quick access to status changes, launching execution, and navigating to the task detail page. Filter tasks by labels and priority to focus on what matters. Each card displays the task title, description snippet, priority badge, and assigned labels. Pin important tasks to keep them at the top of their column.

## Details

- **Drag-and-drop**: Powered by dnd-kit. Dragging across columns triggers a status update; dragging within a column updates the `order` field.
- **Context menu**: Right-click any card for quick actions — move to a different status, start or resume execution, open in detail view, or delete.
- **Filtering**: Filter the board by one or more labels, priority levels, or both. Filters apply across all columns simultaneously.
- **Column count badges**: Each column header shows its task count; the board top stays compact with a unified tooltip instead of separate stat cards.
- **Pinning**: Pinned tasks always appear at the top of their column regardless of order value.
- **Archive view**: Completed and cancelled tasks can be viewed in a separate archive page.
- **Project tab bar**: Switch projects via horizontal tabs at the top of the board. Hovering a tab opens a tooltip with the badge-format hint and an **Open Studio** entry (opens the project's working directory in an external IDE/terminal); the project column stays highlighted while the pointer is over the tooltip.

## File Reference

### Components (`src/components/board/`)

| Component | Description |
|-----------|-------------|
| `kanban-board.tsx` | Main board container |
| `board-column.tsx` | Status column |
| `task-card.tsx` | Task card |
| `task-card-context-menu.tsx` | Task card right-click menu |
| `board-filters.tsx` | Filters (labels, priority) |
| `project-tabs.tsx` | Top project tab bar (tab switch + tooltip + Open Studio) |
| `create-task-dialog.tsx` | New-task dialog |
| `column-tasks-dialog.tsx` | Full single-column task list dialog |

### Pages

| Route | Description |
|-------|-------------|
| `/workspaces/[workspaceId]` | Board main page (`board-page-client.tsx`) |
| `/workspaces/[workspaceId]/archive` | Archived tasks (`archive-page-client.tsx`) |

### State Management (`src/stores/board-store.ts`)

Zustand store managing column state, filter conditions, and drag state.
