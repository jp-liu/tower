---
title: Workspace
description: Top-level container for managing projects and labels
---

# Workspace Module

**Slug:** `workspace`

## Overview

Workspaces are the top-level containers in Tower for organizing teams or project groups. Each workspace has its own label pool that is shared across all projects within it. You can rename workspaces, edit their descriptions, and delete them — deletion cascades to all projects and tasks inside.

## Details

- **Label pool**: Every workspace maintains a set of custom labels. These labels are available to all tasks across every project in that workspace. Built-in labels (global) are also accessible but cannot be deleted.
- **Cascade delete**: Removing a workspace permanently deletes all of its projects, tasks, executions, and messages. This operation is irreversible.
- **Project grouping**: Use workspaces to separate concerns — for example, one workspace per team, per client, or per product line.

## Data Model

```
Workspace (id, name, description?)
  ├── Project[]
  └── Label[]
```

- `id`: cuid
- `name`: required
- `description`: optional
- Cascade delete: Deleting a Workspace removes all its Projects and Labels

## File Reference

### Server Actions (`src/actions/workspace-actions.ts`)

| Function | Description |
|----------|-------------|
| `getWorkspaces()` | List all workspaces |
| `getWorkspaceById(id)` | Get by ID |
| `createWorkspace({ name, description? })` | Create |
| `updateWorkspace(id, data)` | Update |
| `deleteWorkspace(id)` | Delete (cascade) |
| `getWorkspacesWithProjects()` | With project list |
| `getWorkspacesWithRecentTasks(limit?)` | With recent tasks |

### Pages

| Route | File | Description |
|-------|------|-------------|
| `/workspaces` | `src/app/workspaces/page.tsx` | Workspace list |
| `/workspaces/[id]` | `src/app/workspaces/[workspaceId]/` | Workspace detail (board) |

### MCP Tools (`src/mcp/tools/workspace-tools.ts`)

- `list_workspaces` / `create_workspace` / `update_workspace` / `delete_workspace`

## Constraints

- Labels under a Workspace are split into builtin (global) and workspace-scoped
- Builtin labels cannot be deleted
