<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# currentDate
Today's date is 2026-04-13.

---

# Tower — Agent Reference

## Project Overview

Tower is an AI task management platform with a Kanban board UI. The core hierarchy is:

```
Workspace → Projects → Tasks
```

Workspaces are top-level containers. Each workspace holds multiple Projects and a shared set of Labels. Projects hold Tasks. Tasks are displayed as Kanban cards grouped by status.

---

## Modules

System modules for GSD phase scoping. Use the **Slug** as the commit scope (e.g. `feat(terminal-08.01): ...`).

| Module | Slug | Description |
|--------|------|-------------|
| Workspace | `workspace` | 工作区 CRUD、标签管理 |
| Project | `project` | 项目 CRUD、导入、git 仓库、描述生成 |
| Task | `task` | 任务 CRUD、状态流转、Label、详情页 |
| Board | `board` | 看板 UI、拖拽排序、筛选统计、置顶 |
| Terminal | `terminal` | PTY 会话、WebSocket、xterm.js、CLI Profile |
| Assistant | `assistant` | AI 助手聊天、SSE 流式、多模态 |
| Missions | `missions` | 多任务监控面板、网格布局 |
| Search | `search` | 全局搜索、代码搜索、FTS |
| Settings | `settings` | 系统配置、CLI Profile、Agent 配置 |
| MCP | `mcp` | MCP Server、23 个工具、stdio 传输 |
| Git | `git` | Git 操作、Worktree、Diff、Merge |
| Assets & Notes | `assets` | 项目资产上传、笔记系统 |
| AI | `ai` | Claude SDK、CLI Adapter、执行总结、Prompt 管理 |
| I18n | `i18n` | 国际化、zh/en 双语 |

Detailed module documentation: [`docs/`](docs/README.md)

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
- `sessionId?` — Claude CLI session ID for resume support
- `worktreePath?`, `worktreeBranch?` — git worktree isolation
- `callbackUrl?` — external orchestrator callback URL

**CliProfile**
- `id` (cuid), `command` (default `claude`), `baseArgs` (JSON string array), `envVars` (JSON object)
- `isDefault`: boolean — only one default profile allowed
- Controls which CLI binary and arguments are used for PTY spawning

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

To expose Tower tools to an AI agent via MCP, add the following to your MCP client configuration:

```json
{
  "mcpServers": {
    "tower": {
      "command": "npx",
      "args": ["tsx", "<project-root>/src/mcp/index.ts"]
    }
  }
}
```

Replace `<project-root>` with the absolute path to this repository.

---

## Available MCP Tools

23 tools across 7 categories.

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
| `create_task` | Create a task with optional labels | `projectId`, `title`, `description?`, `priority?`, `status?`, `labelIds?`, `useWorktree?`, `baseBranch?`, `autoStart?`, `references?` |
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

### Terminal Tools (`src/mcp/tools/terminal-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `get_task_terminal_output` | Get recent terminal output lines from a running task's PTY session | `taskId`, `lines?` (default 50, max 500) |
| `send_task_terminal_input` | Send text input to a running task's PTY terminal (include `\n` for Enter) | `taskId`, `text` |
| `get_task_execution_status` | Get execution status (running/idle/exited) with output snippet | `taskId` |

### Report Tools (`src/mcp/tools/report-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `daily_summary` | Today's work summary — completed tasks, in-progress tasks with last chat summary, grouped by workspace → project | `date?` (YYYY-MM-DD) |
| `daily_todo` | All pending tasks (TODO/IN_PROGRESS/IN_REVIEW), sorted by priority severity | `workspaceId?`, `projectId?`, `status?`, `priority?` |

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
| `getWorkspacesWithProjects` | `() → { id, name, projects: { id, name, alias }[] }[]` |
| `getWorkspacesWithRecentTasks` | `(limit?) → { id, name, projects: { id, name, alias, tasks: Task[], _count }[] }[]` — includes recent tasks per project with last sessionId for resume |

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

### `report-actions.ts`

| Function | Signature |
|----------|-----------|
| `getDailySummary` | `(dateStr?) → DailySummaryResult` — tasks with activity on given date, grouped by workspace/project |
| `getDailyTodo` | `(filters?) → DailyTodoResult` — pending tasks, filterable by workspace/project/status/priority |

### `agent-actions.ts`

| Function | Signature |
|----------|-----------|
| `sendTaskMessage` | `(taskId, content) → { userMessage, assistantMessage }` |
| `getTaskMessages` | `(taskId) → TaskMessage[]` |
| `startTaskExecution` | `(taskId, agent?) → TaskExecution` — also sets task status to IN_PROGRESS |
| `stopTaskExecution` | `(executionId) → TaskExecution` — sets status to COMPLETED |
| `stopPtyExecution` | `(taskId) → void` — stops the PTY session for a task |
| `getTaskExecutions` | `(taskId) → TaskExecution[]` |
| `startPtyExecution` | `(taskId, prompt) → { executionId, worktreePath }` — spawns Claude CLI in PTY with CliProfile settings |
| `resumePtyExecution` | `(taskId, previousSessionId) → { executionId, worktreePath }` — resumes a previous Claude CLI session |
| `getActiveExecutionsAcrossWorkspaces` | `() → ActiveExecutionInfo[]` — all RUNNING executions with workspace/project/task metadata |

---

## Constraints

- **Cascade deletes**: Deleting a Workspace deletes all its Projects; deleting a Project deletes all its Tasks; deleting a Task deletes its Messages and Executions.
- **Builtin labels**: Labels with `isBuiltin: true` are global (no `workspaceId`). Do not delete them — enforce this check before calling `deleteLabel`.
- **Task order**: The `order` field controls Kanban card position within a status column. Lower values appear higher. Always preserve existing order values when creating tasks unless explicitly reordering.
- **Project type**: `type` is derived from `gitUrl` — always `GIT` when `gitUrl` is set, `NORMAL` otherwise. Do not set type independently.
- **Label replacement**: `set_task_labels` / `setTaskLabels` / `update_task` with `labelIds` all perform a full replace, not a merge. Pass the complete desired set.
- **PTY sessions**: Keyed by `taskId` — one active session per task. Use `startPtyExecution` to create, `resumePtyExecution` to resume with a `sessionId`, `stopPtyExecution` to kill.
- **CliProfile**: Only one default profile (`isDefault: true`). `baseArgs` and `envVars` are JSON strings — parse before use.
- **Environment injection**: `AI_MANAGER_TASK_ID` and `CALLBACK_URL` are injected into every PTY session environment. Never mutate `process.env` — use `envOverrides`.
- **Internal HTTP bridge**: `/api/internal/terminal/[taskId]/buffer` (GET) and `/api/internal/terminal/[taskId]/input` (POST) — localhost-only routes for cross-process PTY access. MCP tools use these since MCP stdio processes cannot share in-memory PTY sessions.

---

## Mission Control

**Route:** `/missions` — multi-task monitoring dashboard across all workspaces.

**Capabilities:**
- View all RUNNING task executions with embedded xterm.js terminals
- Grid layout presets (1×1, 2×1, 3×2, 2×2, 4×2, 3×3) persisted in localStorage
- Workspace filter dropdown to narrow visible tasks
- Launch new task execution or resume previous session from Task Picker
- Stop execution (card removed) / auto-remove on natural completion
- Drag-and-drop card reordering via dnd-kit
- 4-second polling for live updates

**For external orchestrators (OpenClaw/Paperclip):**

To dispatch and monitor tasks programmatically, use MCP tools in this workflow:

1. **Create task:** `create_task` → get `taskId`
2. **Start execution:** Call `startPtyExecution(taskId, prompt)` via server action (or use the internal HTTP bridge)
3. **Monitor:** `get_task_execution_status` for high-level status, `get_task_terminal_output` for live output
4. **Send input:** `send_task_terminal_input` to interact with the running Claude CLI
5. **Check completion:** Poll `get_task_execution_status` — `terminalStatus: "exited"` means done
6. **Resume if needed:** `resumePtyExecution(taskId, sessionId)` to continue a previous session

**ActiveExecutionInfo type** (returned by `getActiveExecutionsAcrossWorkspaces`):
```typescript
{
  executionId: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  projectAlias: string | null;
  projectLocalPath: string | null;
  workspaceId: string;
  workspaceName: string;
  worktreePath: string | null;
  startedAt: string | null; // ISO string
}
```
