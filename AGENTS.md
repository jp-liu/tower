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

System modules for GSD phase scoping. Use the **Slug** as the commit scope (e.g. `feat(terminal-08.01): ...`). Commit messages are written in **English** (conventional-commit type prefix unchanged; only the description is English).

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
| MCP | `mcp` | MCP Server、35 个工具、stdio 传输 |
| Git | `git` | Git 操作、Worktree、Diff、Merge |
| Assets & Notes | `assets` | 项目资产上传、笔记系统 |
| AI | `ai` | Claude SDK、CLI Adapter、执行总结、Prompt 管理 |
| I18n | `i18n` | 国际化、zh/en 双语 |

Detailed module documentation (VitePress site): [`docs/modules/`](docs/modules/) (中文) · [`docs/en/modules/`](docs/en/modules/) (English)

---

## Data Model

### Hierarchy

```
Workspace (id, name, description?)
  ├── ProductGroup[] (id, name, description?)   // groups repos of one product for shared knowledge search
  ├── Project[] (id, name, alias?, description?, type, gitUrl?, localPath?, groupId?, knowledgeDir?)
  │     ├── Task[] (id, title, description?, status, priority, order)
  │     │     ├── TaskLabel[] → Label
  │     │     ├── TaskExecution[]
  │     │     └── TaskMessage[]
  │     └── ProjectFact[] (key, value)          // structured fact cards for knowledge base
  └── Label[] (id, name, color, isBuiltin)
```

### Models

**Workspace**
- `id` (cuid), `name`, `description?`
- Has many: `projects`, `labels`, `productGroups`

**ProductGroup**
- `id` (cuid), `name`, `description?`
- `workspaceId` (FK → Workspace, cascade delete)
- `@@unique([workspaceId, name])` — group name is unique per workspace
- Has many: `projects`
- Purpose: groups the multiple repos of one product (e.g. frontend / backend / trace static-knowledge / requirements) so `ask_project_knowledge` searches all members together. A group's members must all live in the same workspace (enforced in the app layer).

**Project**
- `id` (cuid), `name`, `alias?`, `description?`
- `type`: `NORMAL` | `GIT` — derived from whether `gitUrl` is set
- `gitUrl?`, `localPath?`
- `groupId?` (FK → ProductGroup, `onDelete: SetNull`) — the product group this project belongs to
- `knowledgeDir?` — overrides the in-repo knowledge dir (default `docs/知识库`)
- `workspaceId` (FK → Workspace, cascade delete)
- Has many: `tasks`, `repositories`, `facts`

**ProjectFact**
- `id` (cuid), `projectId`, `key`, `value`
- `@@unique([projectId, key])` — one value per key per project (upsert)
- Structured key-value fact cards (production/CICD paths, domains, other machine-underivable facts). Precise-match source for `ask_project_knowledge`; managed via `manage_project_facts`.

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

The runtime surface and profile membership are derived from
`src/mcp/tool-capabilities.ts`; do not maintain a separate hand-written total.
The default `full` profile remains backward compatible. Bounded `assistant`,
`task`, `gateway`, and `gateway-query` profiles reduce tool discovery and
availability for specific runtimes.

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
| `update_project` | Update name, localPath, description, and knowledge-base settings (`groupId` assigns the project to a ProductGroup so repos of one product are searched together — `""` detaches; `knowledgeDir` overrides the in-repo knowledge dir) | `projectId`, `name?`, `localPath?`, `description?`, `groupId?`, `knowledgeDir?` |
| `list_product_groups` | List a workspace's product groups (with member projects) to discover a `groupId` for `update_project` | `workspaceId` |
| `create_product_group` | Create a product group in a workspace (name unique per workspace); returns its id for `update_project`'s `groupId` | `workspaceId`, `name`, `description?` |
| `delete_project` | Delete a project (cascades to tasks) | `projectId` |

### Task Tools (`src/mcp/tools/task-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `list_tasks` | List tasks in a project, ordered by `order` then `createdAt`; includes labels | `projectId`, `status?` |
| `create_task` | Create a task with optional labels/version. `useWorktree`/`autoStart` default to the saved global preference; first call without them (and before defaults set) returns `{ needsDefaultsSetup: true }` instead of creating | `projectId`, `title`, `description?`, `priority?`, `status?`, `labelIds?`, `versionId?`, `useWorktree?`, `baseBranch?`, `autoStart?`, `references?` |
| `update_task` | Update title, description, priority, labels (replaces all labels), and/or version (`versionId`: assign to a version, or `null`/`""` to move back to backlog) | `taskId`, `title?`, `description?`, `priority?`, `labelIds?`, `versionId?` |
| `move_task` | Move task to a different status column | `taskId`, `status` |
| `delete_task` | Delete a task | `taskId` |
| `set_goal_mode` | Enable or disable unattended goal mode for a task | `taskId`, `enabled` |
| `set_task_defaults` | Save global defaults for new tasks (worktree isolation + auto-start). Call once after asking the user; marks defaults as configured | `useWorktree`, `autoStart` |
| `list_versions` | List a project's active versions (excludes RELEASED) for `create_task`'s or `update_task`'s `versionId` | `projectId` |

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

### Knowledge Tools (`src/mcp/tools/knowledge-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `identify_project` | Resolve a project by partial name, alias, or description; returns matches sorted by confidence score (0–1, min 0.3) | `query`, `workspaceId?` |

### Knowledge Base Tools (`src/mcp/tools/knowledge-base-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `ask_project_knowledge` | Answer a question about a project by aggregating four sources: in-repo knowledge markdown (`<localPath>/<knowledgeDir>`, default `docs/知识库`), structured fact cards, versions + their tasks' merge commits, and DB notes (FTS). Projects in the same product group (front/back/trace/需求) are searched together. Returns raw aggregated material with citations — the **caller** composes the answer. Project by exact id or fuzzy name/alias (ambiguous → `needsSelection`) | `project`, `question`, `workspaceId?` |
| `manage_project_facts` | Manage a project's structured fact cards (key-value): production/CICD paths, domains, other machine-underivable facts. Precise-match source for `ask_project_knowledge` | `action` (`set`\|`delete`\|`list`), `projectId`, `key?`, `value?` |

### Notes & Assets Tools (`src/mcp/tools/note-asset-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `manage_notes` | CRUD + search over a project's notes (FTS-indexed). One tool, multiple actions | `action` (`create`\|`update`\|`delete`\|`get`\|`list`\|`search`), `projectId?`, `noteId?`, `title?`, `content?`, `query?` |
| `manage_assets` | Manage project assets (files, images, screenshots). `upload` saves base64 (pasted images), `add` moves a file from `sourcePath`, `link_task` attaches assets to a task after creation | `action` (`add`\|`upload`\|`delete`\|`list`\|`get`\|`link_task`), `projectId?`, `assetId?`, `assetIds?`, `taskId?`, `sourcePath?`, `base64?` |

### Terminal Tools (`src/mcp/tools/terminal-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `start_task_execution` | Start a Claude CLI PTY session for a task; sends `prompt` as the initial instruction and flips status to IN_PROGRESS. Returns `executionId` and `worktreePath` (worktree mode) | `taskId`, `prompt?` |
| `get_task_terminal_output` | Get recent terminal output lines from a running task's PTY session | `taskId`, `lines?` (default 50, max 500) |
| `send_task_terminal_input` | Send text input to a running task's PTY terminal. Submits by default (trailing newlines trimmed, a standalone CR appended so the TUI sends it); pass `submit: false` to only fill the input box | `taskId`, `text`, `submit?` |
| `get_task_execution_status` | Get execution status (running/idle/exited) with output snippet | `taskId` |
| `stop_task_execution` | Close a task's terminal (same as the Stop button — kills the PTY session, finalizes the execution, moves the task to IN_REVIEW). Identify by exact `taskId` or fuzzy `taskName`. Ambiguous name → returns `needsSelection` with candidates instead of stopping; unique match or exact ID → closes directly. No active terminal is a no-op and still reports success | `taskId?`, `taskName?` |
| `resume_task_execution` | Start a task's terminal so a related task can bring up a sibling before messaging it. Defaults to resuming the latest history session (Continue/Retry button); no prior runs → fresh start with task context (Launch button); already running → no-op (`mode: already_running`). Identify by exact `taskId` or fuzzy `taskName` (ambiguous → `needsSelection`). Returns `mode` (`continued`\|`started`\|`already_running`) + `executionId`. Follow with `send_task_terminal_input` to send the message | `taskId?`, `taskName?` |

### Report Tools (`src/mcp/tools/report-tools.ts`)

| Tool | Description | Key Params |
|------|-------------|------------|
| `daily_summary` | Today's work summary — completed tasks, in-progress tasks with last chat summary, grouped by workspace → project | `date?` (YYYY-MM-DD) |
| `daily_todo` | All pending tasks (TODO/IN_PROGRESS/IN_REVIEW), sorted by priority severity | `workspaceId?`, `projectId?`, `status?`, `priority?` |

### Harness Tools (`src/mcp/tools/harness/`)

These adapters cover unattended messaging, gateway routing, durable Workbench
handoff, diagnostics, scoped recovery, and remote project provisioning.

- Messaging: `list_notify_targets`, `push_to_human`, `ask_human`,
  `notify_human`
- Gateway query: `route_gateway_query`, `read_gateway_project_context`,
  `complete_gateway_discussion`
- Gateway owner: `relay_channel_reply`, `route_gateway_message`,
  `resolve_gateway_task_context`, `continue_bound_task`,
  `diagnose_gateway_request`, `provision_remote_project`, `reply_to_ask`
- Workbench: `ack_workbench_batch`, `resolve_workbench_batch`,
  `heartbeat_workbench_batch`, `confirm_gateway_task_created`,
  `complete_gateway_work`
- Operations: `recover_gateway_request`, `get_gateway_runtime_health`

`route_gateway_query` is the capability-scoped NON_OWNER entry and cannot
create work. `resolve_gateway_task_context` is read-only. `continue_bound_task`
is an explicit, idempotent OWNER action; it refuses to bypass an OPEN ask.
Mutating/diagnostic/provisioning tools are exposed only to OWNER by the
OpenClaw sender tool policy.

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
| `createProject` | `({ name, alias?, description?, gitUrl?, localPath?, workspaceId, projectType?, previewCommand? }) → Project` — does **not** take `groupId`; assign the group afterward with `setProjectGroup` |
| `updateProject` | `(id, { name?, alias?, description?, localPath? }) → Project` |
| `deleteProject` | `(id) → void` |
| `getProjectByLocalPath` | `(localPath) → Project \| null` |
| `getRecentLocalProjects` | `(limit?) → Project[]` |
| `getWorkspacesWithProjects` | `() → { id, name, projects: { id, name, alias }[] }[]` |
| `getWorkspacesWithRecentTasks` | `(limit?) → { id, name, projects: { id, name, alias, tasks: Task[], _count }[] }[]` — includes recent tasks per project with last sessionId for resume |

### `group-actions.ts`

Product-group CRUD and project↔group assignment. A group's members must all live in the same workspace — the assignment actions enforce this (the knowledge layer aggregates purely by `groupId`, so a cross-workspace member would leak knowledge across workspaces).

| Function | Signature |
|----------|-----------|
| `getProductGroups` | `(workspaceId) → ProductGroup[]` — ordered by name, includes member projects (id/name/alias) |
| `createProductGroup` | `({ name, description?, workspaceId }) → ProductGroup` — name unique per workspace |
| `updateProductGroup` | `(id, { name?, description? }) → ProductGroup` |
| `deleteProductGroup` | `(id) → void` — unbinds all members (`groupId = null`) then deletes; member projects are kept |
| `setProjectGroup` | `(projectId, groupId \| null) → void` — join a group or detach (`null`); rejects cross-workspace assignment |

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

### `preview-actions.ts`

| Function | Signature |
|----------|-----------|
| `getPreviewState` | `({ taskId, projectId, worktreePath }) → PreviewStateResp` |
| `startPreview` | `({ taskId, projectId, worktreePath }) → { started, error? }` |
| `stopPreview` | `({ previewKey }) → void` |
| `installPreviewDeps` | `({ taskId, projectId, worktreePath, autoStartAfter? }) → { ok, error? }` |
| `redetectPreset` | `({ projectId, worktreePath? }) → { preset: string \| null }` |
| `setProjectPreset` | `({ projectId, presetId: string \| null }) → void` |
| `openInTerminal` | `(worktreePath) → void` |

---

## Constraints

- **Cascade deletes**: Deleting a Workspace deletes all its Projects; deleting a Project deletes all its Tasks; deleting a Task deletes its Messages and Executions.
- **Builtin labels**: Labels with `isBuiltin: true` are global (no `workspaceId`). Do not delete them — enforce this check before calling `deleteLabel`.
- **Task order**: The `order` field controls Kanban card position within a status column. Lower values appear higher. Always preserve existing order values when creating tasks unless explicitly reordering.
- **Project type**: `type` is derived from `gitUrl` — always `GIT` when `gitUrl` is set, `NORMAL` otherwise. Do not set type independently.
- **Product groups**: A group and its member projects must share one workspace — assignment (`setProjectGroup` / `update_project` with `groupId`) rejects cross-workspace pairs. Group assignment is a **separate step** after creation: neither `createProject` nor `create_project` accepts `groupId`. Deleting a group unbinds (does not delete) its members. `""` (MCP) / `null` (action) detaches a project.
- **Label replacement**: `set_task_labels` / `setTaskLabels` / `update_task` with `labelIds` all perform a full replace, not a merge. Pass the complete desired set.
- **PTY sessions**: Keyed by `taskId` — one active session per task. Use `startPtyExecution` to create, `resumePtyExecution` to resume with a `sessionId`, `stopPtyExecution` to kill.
- **CliProfile**: Only one default profile (`isDefault: true`). `baseArgs` and `envVars` are JSON strings — parse before use.
- **Environment injection**: `TOWER_TASK_ID`, `TOWER_TASK_TITLE`, `TOWER_API_URL`, and optionally `CALLBACK_URL` are injected into every task PTY session environment. Never mutate `process.env` — use `envOverrides`.
- **Internal HTTP bridge**: `/api/internal/terminal/[taskId]/buffer` (GET), `/input`, `/start`, `/stop`, `/resume`, and `/paste-image` (POST) — localhost-only routes for cross-process PTY access. MCP tools use these since MCP stdio processes cannot share in-memory PTY sessions. `/paste-image` stores a clipboard image pasted into the browser xterm.js terminal to a host file and returns its absolute path; the frontend injects that path as terminal input so the Claude CLI can read it (xterm cannot forward image blobs, so native image paste does not reach the CLI).

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
7. **Launch a sibling terminal:** `resume_task_execution` (by `taskId` or fuzzy `taskName`) to bring up a related task's terminal — resumes its latest session by default — then `send_task_terminal_input` to notify it
8. **Close a sub-task terminal:** `stop_task_execution` (by `taskId` or fuzzy `taskName`) to close a finished sub-task's terminal without opening Mission Control

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
