<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# currentDate
Today's date is 2026-03-26.

---

# ai-manager — Agent Reference

## Project Overview

ai-manager is an AI task management platform with a Kanban board UI. The core hierarchy is:

```
Workspace → Projects → Tasks
```

Workspaces are top-level containers. Each workspace holds multiple Projects and a shared set of Labels. Projects hold Tasks. Tasks are displayed as Kanban cards grouped by status.

---

## Data Model

### Hierarchy

```
Workspace (id, name, description?)
  ├── Project[] (id, name, alias?, description?, type, gitUrl?, localPath?)
  │     └── Task[] (id, title, description?, status, priority, order)
  │           ├── TaskLabel[] → Label
  │           ├── TaskExecution[]
  │           └── TaskMessage[]
  └── Label[] (id, name, color, isBuiltin)
```

### Models

**Workspace**
- `id` (cuid), `name`, `description?`
- Has many: `projects`, `labels`

**Project**
- `id` (cuid), `name`, `alias?`, `description?`
- `type`: `NORMAL` | `GIT` — derived from whether `gitUrl` is set
- `gitUrl?`, `localPath?`
- `workspaceId` (FK → Workspace, cascade delete)
- Has many: `tasks`, `repositories`

**Task**
- `id` (cuid), `title`, `description?`
- `status`: `TODO` | `IN_PROGRESS` | `IN_REVIEW` | `DONE` | `CANCELLED` (default: `TODO`)
- `priority`: `LOW` | `MEDIUM` | `HIGH` | `CRITICAL` (default: `MEDIUM`)
- `order`: integer used for Kanban column ordering (ascending = top)
- `projectId` (FK → Project, cascade delete)
- Has many: `labels` (via TaskLabel), `executions`, `messages`

**Label**
- `id` (cuid), `name`, `color` (hex, default `#94a3b8`)
- `workspaceId?` — null for builtin labels
- `isBuiltin`: builtin labels are global and cannot be deleted

**TaskExecution**
- `id` (cuid), `taskId`, `agent` (default `CLAUDE_CODE`), `config?`
- `status`: `PENDING` | `RUNNING` | `PAUSED` | `COMPLETED` | `FAILED`
- `branch?`, `startedAt?`, `endedAt?`

**TaskMessage**
- `id` (cuid), `taskId`, `executionId?`
- `role`: `USER` | `ASSISTANT` | `SYSTEM`
- `content`, `metadata?`

**Repository**
- `id` (cuid), `name`, `path`, `branch` (default `main`)
- `projectId` (FK → Project, cascade delete)

**AgentConfig**
- `id` (cuid), `agent`, `configName`, `appendPrompt?`, `settings?`, `isDefault`
- Unique constraint on `(agent, configName)`

---

## MCP Server

To expose ai-manager tools to an AI agent via MCP, add the following to your MCP client configuration:

```json
{
  "mcpServers": {
    "ai-manager": {
      "command": "npx",
      "args": ["tsx", "<project-root>/src/mcp/index.ts"]
    }
  }
}
```

Replace `<project-root>` with the absolute path to this repository.

---

## Available MCP Tools

18 tools across 5 categories.

### Workspace Tools (`src/mcp/tools/workspace-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_workspaces` | List all workspaces ordered by last updated; includes project count | — |
| `create_workspace` | Create a new workspace | `name`, `description?` |
| `update_workspace` | Update name and/or description | `workspaceId`, `name?`, `description?` |
| `delete_workspace` | Delete workspace (cascades to projects and tasks) | `workspaceId` |

### Project Tools (`src/mcp/tools/project-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_projects` | List projects in a workspace; includes task and repository counts | `workspaceId` |
| `create_project` | Create a project; type auto-set to GIT if gitUrl provided | `workspaceId`, `name`, `gitUrl?`, `localPath?` |
| `update_project` | Update name, localPath, and/or description | `projectId`, `name?`, `localPath?`, `description?` |
| `delete_project` | Delete a project (cascades to tasks) | `projectId` |

### Task Tools (`src/mcp/tools/task-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_tasks` | List tasks in a project, ordered by `order` then `createdAt`; includes labels | `projectId`, `status?` |
| `create_task` | Create a task with optional labels | `projectId`, `title`, `description?`, `priority?`, `status?`, `labelIds?` |
| `update_task` | Update title, description, priority, and/or labels (replaces all labels) | `taskId`, `title?`, `description?`, `priority?`, `labelIds?` |
| `move_task` | Move task to a different status column | `taskId`, `status` |
| `delete_task` | Delete a task | `taskId` |

### Label Tools (`src/mcp/tools/label-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_labels` | List all labels for a workspace (builtin + workspace-specific) | `workspaceId` |
| `create_label` | Create a custom label for a workspace | `workspaceId`, `name`, `color` |
| `delete_label` | Delete a label by ID | `labelId` |
| `set_task_labels` | Replace all labels on a task | `taskId`, `labelIds` |

### Search Tools (`src/mcp/tools/search-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `search` | Search tasks, projects, or repositories by query string | `query`, `category?` (`task`\|`project`\|`repository`) |

---

## Server Actions

For AI working directly in the Next.js codebase, use these server actions (all in `src/actions/`).

### `workspace-actions.ts`

| Function | Signature |
|----------|-----------|
| `getWorkspaces` | `() → Workspace[]` |
| `getWorkspaceById` | `(id) → Workspace \| null` |
| `createWorkspace` | `({ name, description? }) → Workspace` |
| `updateWorkspace` | `(id, { name?, description? }) → Workspace` |
| `deleteWorkspace` | `(id) → void` |
| `createProject` | `({ name, alias?, description?, gitUrl?, localPath?, workspaceId }) → Project` |
| `updateProject` | `(id, { name?, alias?, description?, localPath? }) → Project` |
| `deleteProject` | `(id) → void` |
| `getProjectByLocalPath` | `(localPath) → Project \| null` |
| `getRecentLocalProjects` | `(limit?) → Project[]` |

### `task-actions.ts`

| Function | Signature |
|----------|-----------|
| `createTask` | `({ title, description?, projectId, priority?, status?, labelIds? }) → Task` |
| `updateTask` | `(taskId, { title?, description?, priority?, labelIds? }) → Task` |
| `updateTaskStatus` | `(taskId, status) → Task` |
| `deleteTask` | `(taskId) → void` |
| `getProjectTasks` | `(projectId) → Task[]` |

### `label-actions.ts`

| Function | Signature |
|----------|-----------|
| `getLabelsForWorkspace` | `(workspaceId) → Label[]` |
| `createLabel` | `({ name, color, workspaceId }) → Label` |
| `deleteLabel` | `(id) → void` |
| `setTaskLabels` | `(taskId, labelIds) → void` |
| `getTaskLabels` | `(taskId) → Label[]` |

### `search-actions.ts`

| Function | Signature |
|----------|-----------|
| `globalSearch` | `(query, category?) → SearchResult[]` |

### `agent-actions.ts`

| Function | Signature |
|----------|-----------|
| `sendTaskMessage` | `(taskId, content) → { userMessage, assistantMessage }` |
| `getTaskMessages` | `(taskId) → TaskMessage[]` |
| `startTaskExecution` | `(taskId, agent?) → TaskExecution` — also sets task status to IN_PROGRESS |
| `stopTaskExecution` | `(executionId) → TaskExecution` — sets status to COMPLETED |
| `getTaskExecutions` | `(taskId) → TaskExecution[]` |

---

## Constraints

- **Cascade deletes**: Deleting a Workspace deletes all its Projects; deleting a Project deletes all its Tasks; deleting a Task deletes its Messages and Executions.
- **Builtin labels**: Labels with `isBuiltin: true` are global (no `workspaceId`). Do not delete them — enforce this check before calling `deleteLabel`.
- **Task order**: The `order` field controls Kanban card position within a status column. Lower values appear higher. Always preserve existing order values when creating tasks unless explicitly reordering.
- **Project type**: `type` is derived from `gitUrl` — always `GIT` when `gitUrl` is set, `NORMAL` otherwise. Do not set type independently.
- **Label replacement**: `set_task_labels` / `setTaskLabels` / `update_task` with `labelIds` all perform a full replace, not a merge. Pass the complete desired set.
