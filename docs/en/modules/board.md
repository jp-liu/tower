---
title: Board
description: Kanban board UI with drag-and-drop, filtering, and statistics
---

# Board Module

**Slug:** `board`

## Overview

The Kanban board visualizes tasks across 5 status columns: TODO, IN_PROGRESS, IN_REVIEW, DONE, and CANCELLED. Drag cards between columns to update their status, or drag within a column to reorder. A right-click context menu provides quick access to status changes, launching execution, and navigating to the task detail page. Filter tasks by labels and priority to focus on what matters. Each card displays the task title, description snippet, priority badge, and assigned labels. Pin important tasks to keep them at the top of their column.

## Details

- **Drag-and-drop**: Powered by dnd-kit. Dragging across columns triggers a status update; dragging within a column updates the `order` field.
- **Context menu**: Right-click any card for quick actions — move to a different status, start or resume execution, open in detail view, or delete.
- **Filtering**: Filter the board by one or more labels, priority levels, or both. Filters apply across all columns simultaneously.
- **Statistics panel**: Shows task counts per status and overall progress at a glance.
- **Pinning**: Pinned tasks always appear at the top of their column regardless of order value.
- **Archive view**: Completed and cancelled tasks can be viewed in a separate archive page.

## File Reference

### Components (`src/components/board/`)

| Component | Description |
|-----------|-------------|
| `kanban-board.tsx` | Main board container |
| `board-column.tsx` | Status column |
| `task-card.tsx` | Task card |
| `board-filters.tsx` | Filters (labels, priority) |
| `board-stats.tsx` | Statistics panel |

### Pages

| Route | Description |
|-------|-------------|
| `/workspaces/[workspaceId]` | Board main page (`board-page-client.tsx`) |
| `/workspaces/[workspaceId]/archive` | Archived tasks (`archive-page-client.tsx`) |

### State Management (`src/stores/board-store.ts`)

Zustand store managing column state, filter conditions, and drag state.
