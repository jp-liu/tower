---
name: ai-manager
description: Manage workspaces, projects, and tasks in ai-manager via MCP tools
---

# ai-manager Operations

## Setup

Configure MCP Server in your AI tool settings:

```json
{
  "mcpServers": {
    "ai-manager": {
      "command": "npx",
      "args": ["tsx", "/Users/liujunping/project/i/ai-manager/src/mcp/index.ts"]
    }
  }
}
```

## Available Tools

### Workspace Tools

| Tool | Description |
|------|-------------|
| `list_workspaces` | List all workspaces ordered by last updated, including project count for each |
| `create_workspace` | Create a new workspace with a name and optional description |
| `update_workspace` | Update an existing workspace's name and/or description |
| `delete_workspace` | Delete a workspace by ID (cascades to all projects and tasks) |

### Project Tools

| Tool | Description |
|------|-------------|
| `list_projects` | List all projects in a workspace ordered by last updated, including task and repository counts |
| `create_project` | Create a new project in a workspace; type is GIT if gitUrl is provided, NORMAL otherwise |
| `update_project` | Update an existing project's name, localPath, and/or description |
| `delete_project` | Delete a project by ID |

### Task Tools

| Tool | Description |
|------|-------------|
| `list_tasks` | List all tasks in a project, optionally filtered by status; ordered by position then creation date |
| `create_task` | Create a new task; priority defaults to MEDIUM, status defaults to TODO; optionally assigns labels by ID |
| `update_task` | Update a task's title, description, priority, and/or labels; providing labelIds replaces all existing labels |
| `move_task` | Move a task to a different status column (TODO, IN_PROGRESS, IN_REVIEW, DONE, CANCELLED) |
| `delete_task` | Delete a task by ID |

### Label Tools

| Tool | Description |
|------|-------------|
| `list_labels` | List all labels available for a workspace, including builtin labels and workspace-specific labels |
| `create_label` | Create a custom label for a workspace with a name and color |
| `delete_label` | Delete a label by ID (builtin labels cannot be deleted) |
| `set_task_labels` | Replace all labels on a task with the provided list of label IDs |

### Search Tools

| Tool | Description |
|------|-------------|
| `search` | Search for tasks, projects, or repositories by a query string; category defaults to task |

## Common Workflows

### Create a new project with tasks

1. `list_workspaces` — pick the target workspace ID
2. `create_project` — provide workspaceId, name, and optional localPath or gitUrl
3. `create_task` — add initial tasks to the project
4. `move_task` — organize tasks across Kanban columns as work begins

### Manage task lifecycle

1. `create_task` with status TODO (default)
2. `move_task` to IN_PROGRESS when work begins
3. `move_task` to IN_REVIEW when implementation is complete
4. `move_task` to DONE after review passes
5. `move_task` to CANCELLED if the task is dropped

### Search across everything

1. `search` with a query string and category set to `task`, `project`, or `repository`
2. Results include a `navigateTo` path for direct UI navigation

### Label management

1. `list_labels` for the workspace — shows both builtin and custom labels
2. `create_label` with a name and color hex/value to add a custom label
3. `set_task_labels` with the task ID and an array of label IDs to tag tasks
4. `update_task` with labelIds to replace labels as part of a broader task update

## Data Model

- **Workspace** contains Projects
- **Project** contains Tasks and Repositories
- **Task** fields:
  - `status`: `TODO` | `IN_PROGRESS` | `IN_REVIEW` | `DONE` | `CANCELLED`
  - `priority`: `LOW` | `MEDIUM` | `HIGH` | `CRITICAL`
  - `order`: numeric position used for Kanban display ordering
  - `labels`: many-to-many relationship with Label
- **Label** is workspace-scoped; builtin labels are shared across all workspaces
- **Project type**: `NORMAL` (no git) or `GIT` (has gitUrl)

## Constraints

- Deleting a workspace cascades to all its projects and tasks
- Deleting a project removes all its tasks
- Built-in labels (`isBuiltin: true`) cannot be deleted
- `set_task_labels` and `update_task` with labelIds both perform a full replace — all previous labels are removed
- `search` returns at most 20 results per query
- Task order matters for Kanban display; tasks are sorted by `order` ascending, then `createdAt` descending
