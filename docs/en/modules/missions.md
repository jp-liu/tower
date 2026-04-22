---
title: Missions
description: Multi-task monitoring dashboard with embedded terminals
---

# Missions Module

**Slug:** `missions`

## Overview

Mission Control is a multi-task monitoring dashboard that spans all workspaces. It shows every running task execution with a live embedded terminal, giving you a bird's-eye view of all ongoing AI agent work. Choose from grid layout presets (1x1, 2x1, 3x2, 2x2, 4x2, 3x3) to fit your screen — your preference is saved locally.

Each mission card embeds a real-time xterm.js terminal so you can observe agent output as it happens. Cards can be reordered via drag-and-drop and are automatically removed when the execution completes naturally. You can also launch new task executions or resume previous sessions directly from the Task Picker without leaving the dashboard.

## Details

- **Grid layout presets**: Six layout options from single-card (1x1) to nine-card (3x3). The selected layout persists in localStorage across sessions.
- **Workspace filtering**: A dropdown filter lets you narrow the view to tasks from a specific workspace.
- **Task Picker**: Launch a new execution or resume a previous session by selecting a task from the picker dialog. Supports searching by task name.
- **Auto-removal**: When a task execution completes or exits naturally, its card is automatically removed from the dashboard. Manually stopping an execution also removes the card.
- **Drag-and-drop**: Reorder mission cards using dnd-kit to arrange your monitoring layout.
- **Live polling**: The dashboard polls for execution status updates every 4 seconds to stay in sync.

## File Reference

### Pages

| Route | File | Description |
|-------|------|-------------|
| `/missions` | `missions-client.tsx` | Missions main page |

### Components (`src/components/missions/`)

| Component | Description |
|-----------|-------------|
| `mission-card.tsx` | Task execution card (with terminal) |
| `grid-preset-picker.tsx` | Grid layout selector |
| `task-picker-dialog.tsx` | Task picker dialog |

### Server Actions

- `getActiveExecutionsAcrossWorkspaces()` -- Get all RUNNING executions

### State Management (`src/stores/task-execution-store.ts`)

Zustand store managing active execution state.
