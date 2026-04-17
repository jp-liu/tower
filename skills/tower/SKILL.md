---
name: tower
description: AI task orchestration platform — use Tower MCP tools to manage workspaces, projects, tasks, and monitor agent execution
---

# Tower

Tower is an AI task orchestration platform. This skill teaches you how to use Tower's MCP tools to manage projects and tasks.

## MCP Setup

Before using Tower tools, check if the `tower` MCP server is available. If tools like `list_workspaces` are not found, guide the user to configure MCP:

**Claude Code** — add to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "tower": {
      "command": "npx",
      "args": ["tsx", "/Users/liujunping/project/i/ai-manager/src/mcp/index.ts"]
    }
  }
}
```

**Other AI agents** — add the same config to your MCP client settings file.

After configuration, restart the AI session. The Tower tools will then be available.

---

## When to Use

Use Tower tools when the user wants to:
- View, create, or manage tasks and projects
- Check task execution status or progress
- Interact with a running task's terminal
- Search across workspaces, projects, or tasks
- Organize tasks with labels or status changes
- Get daily work summary or pending todo list
- Check what was done today or what's left to do

---

## Scenarios

### "Show me my workspaces" / "List projects"

1. Call `list_workspaces`
2. If user asks about a specific workspace, call `list_projects` with the workspaceId
3. Present results in a clean table format

### "Create a task" / "Add a task for ..."

1. Call `list_workspaces` to find the target workspace
2. Call `list_projects` with workspaceId to find the target project
3. Ask user to confirm the project (or infer from context)
4. **Worktree mode**: default is direct mode (no branch isolation). If user says "use worktree", "-w", or "branch isolation", set `useWorktree: true`. Optionally pass `baseBranch` to specify which branch to check out from (e.g. `baseBranch: "develop"`). If `baseBranch` is omitted, the project's current git branch is auto-detected.
5. **SubPath detection**: check the project description for directory structure hints (e.g. "monorepo: packages/web, packages/api"). If the task clearly belongs to a subdirectory, set `subPath` (e.g. "packages/web"). If unclear, omit it — it's optional.
6. **References (any files/images)**: ALL user-provided files — including pasted screenshots, uploaded images, and local file paths — should be passed as `references: ["/path/to/file"]` on `create_task`. The tool copies files into the project asset library automatically.
   - **Local file paths**: pass directly (e.g. `references: ["/path/to/doc.md", "/path/to/design.png"]`)
   - **Pasted images with known paths**: if the platform provides file paths for pasted media (e.g. OpenClaw's `{{MediaPaths}}`, Claude Code temp files), pass those paths directly — they are local files
   - **Base64 only (no file path)**: if you only have base64 data with no local path, upload first via `manage_assets` with `action: "upload"`, `projectId`, `base64`, `mimeType`. Get back `{ id: assetId, path }`. Then pass the returned `path` in `references` — `create_task` will automatically copy and link the asset, no separate `link_task` needed
   - **`link_task` only for retroactive linking**: use `manage_assets` with `action: "link_task"` only when you need to associate existing assets with an already-created task (e.g. user wants to add references after task creation)
7. Call `create_task` with projectId, title, and optional description/priority/labelIds/subPath/useWorktree/baseBranch/references
8. `autoStart` defaults to true — task will be created and immediately started. If user says "don't start", "just create", or "-nostart", set `autoStart: false`

### "Start a task" / "Run this task" / "Execute task ..."

1. Call `start_task_execution` with taskId and an optional prompt (instruction for the AI agent)
2. If no prompt is given, use the task's title/description as context
3. The task status changes to IN_PROGRESS automatically

### "What's running?" / "Check task progress"

1. Call `get_task_execution_status` with taskId
2. If status is running, call `get_task_terminal_output` with taskId (default 50 lines)
3. Summarize: status + recent output + duration

### "Send a message to the task" / "Tell it to ..."

1. Call `send_task_terminal_input` with taskId and the text (include `\n` for Enter)
2. Wait briefly, then call `get_task_terminal_output` to see the response

### "Move task to done" / "Cancel this task"

1. Call `move_task` with taskId and the target status (DONE, CANCELLED, etc.)

### "Search for ..." / "Find tasks about ..."

1. Call `search` with the query string
2. Optionally set category to `task`, `project`, or `repository`
3. Results include `navigateTo` paths for UI navigation

### "Label this task" / "Tag it as ..."

1. Call `list_labels` with workspaceId to see available labels
2. Call `set_task_labels` with taskId and the desired labelId array
3. Note: this replaces all existing labels — include current ones if you want to keep them

### "今天做了什么？" / "Daily summary" / "工作总结"

1. Call `daily_summary` (no params for today, or pass `date: "YYYY-MM-DD"` for a specific day)
2. Results are grouped by workspace → project, with:
   - **completed**: tasks moved to DONE today
   - **inProgress**: tasks with activity today but not yet done, including `progressSummary` (last AI chat excerpt)
3. Present stats: totalCompleted, totalInProgress
4. Format as a readable report

### "今天有什么待办？" / "Daily todo" / "还有哪些任务没完成？"

1. Call `daily_todo` (returns all TODO/IN_PROGRESS/IN_REVIEW tasks)
2. Optional filters:
   - `workspaceId` — narrow to one workspace
   - `projectId` — narrow to one project
   - `status` — e.g. `["IN_PROGRESS"]` for only active tasks
   - `priority` — e.g. `["CRITICAL", "HIGH"]` for urgent only
3. Results sorted by priority severity (CRITICAL first), grouped by workspace → project
4. Each task includes `lastSessionId` for resuming execution
5. Present stats: total count, breakdown by status and priority

### "Create a project" / "Set up a new project"

1. Call `list_workspaces` to pick the workspace
2. Call `create_project` with workspaceId, name, and optionally:
   - `gitUrl` — makes it a GIT project with worktree support
   - `localPath` — path to the local repository

---

## Task Lifecycle

```
TODO → IN_PROGRESS → IN_REVIEW → DONE
                                → CANCELLED
```

- Tasks start as `TODO`
- `IN_PROGRESS` means an agent is actively working
- `IN_REVIEW` means execution completed, awaiting review/merge
- `DONE` means merged and completed
- `CANCELLED` means dropped

---

## Task Description Format

The `description` field supports Markdown. **Never copy the user's raw message as-is.** Always restructure it into a clear, actionable format:

```markdown
## 目标
<one sentence summary of what to achieve>

## 需求
- <requirement 1>
- <requirement 2>
- ...

## 参考
- <file paths, API endpoints, design references if any>

## 备注
- <constraints, edge cases, things to watch out for>
```

Rules:
- `title` should be short (under 30 chars), summarizing the task
- `description` should be structured Markdown that an AI agent can execute from
- Extract actionable requirements from the user's natural language
- Omit sections that have no content (e.g. skip 备注 if nothing to note)
- If user provides file paths, put them in 参考 section AND in `references` parameter

---

## Display Templates

All query results MUST follow these templates. Do NOT invent your own format. When results are empty, output "No {items} found." (e.g. "No tasks found.", "No workspaces found.").

### Priority Markers

Use consistently across all templates: 🔴 CRITICAL · 🟠 HIGH · 🟡 MEDIUM · ⚪ LOW

### Labels Format

Always render labels as comma-separated names (e.g. `bug, frontend`). Omit the column if no task has labels.

---

### Workspaces (`list_workspaces`)

```
| Workspace | Projects | Description |
|-----------|----------|-------------|
| {name}    | {projectCount} | {description ?? "—"} |
```

### Projects (`list_projects`)

Note: the response does not include workspace name. Use the workspace name from the prior `list_workspaces` call or the user's context.

```
📂 {workspaceName}

| Project | Type | Tasks | Path |
|---------|------|-------|------|
| {name} ({alias}) | {type} | {taskCount} | {localPath ?? "—"} |
```

### Tasks (`list_tasks`)

```
📋 {projectName}

| ID | Task | Status | Priority | Labels |
|----|------|--------|----------|--------|
| {id (first 8 chars)} | {title} | {status} | {priority} | {labels} |
```

### Task Creation Confirmation

After `create_task` succeeds:

```
✅ Task created: **{title}**
- Project: {projectName}
- Priority: {priority}
- Status: {status}
- Worktree: {yes/no}
{autoStart ? "⚡ Execution started" : ""}
```

### Daily Summary (`daily_summary`)

Fields: `stats.totalCompleted`, `stats.totalInProgress`, grouped `workspaces[].projects[].completed[]` and `inProgress[]`.

```
# 📊 Daily Summary — {date}

**Stats**: ✅ {stats.totalCompleted} completed · 🔄 {stats.totalInProgress} in progress

## {workspace.name}

### {project.name}

**Completed**:
| Task | Priority | Completed At |
|------|----------|-------------|
| ✅ {title} | {priority} | {completedAt (HH:mm)} |

**In Progress**:
| Task | Status | Priority | Progress |
|------|--------|----------|----------|
| 🔄 {title} | {status} | {priority} | {progressSummary ?? "—"} |
```

If no activity: "No activity recorded for {date}."

### Daily Todo (`daily_todo`)

Fields: `stats.total`, `stats.byPriority.{CRITICAL,HIGH,MEDIUM,LOW}`, `stats.byStatus.{TODO,IN_PROGRESS,IN_REVIEW}`.

```
# 📝 Pending Tasks

**Stats**: {stats.total} tasks · 🔴 {stats.byPriority.CRITICAL} · 🟠 {stats.byPriority.HIGH} · 🟡 {stats.byPriority.MEDIUM} · ⚪ {stats.byPriority.LOW}

## {workspace.name}

### {project.name}

| # | Task | Status | Priority | Labels |
|---|------|--------|----------|--------|
| 1 | {title} {lastSessionId ? "🔁" : ""} | {status} | {priority} | {labels} |
```

Sorted by priority (CRITICAL first). 🔁 = resumable session.

### Search Results (`search`)

Categories: `task`, `project`, `repository`, `note`, `asset`, `all`. Result count = `results.length`.

```
🔍 Results for "{query}" ({results.length} found)

| Type | Name | Location | Snippet |
|------|------|----------|---------|
| {type} | {title} | {subtitle} | {snippet ?? "—"} |
```

### Execution Status (`get_task_execution_status`)

```
⚙️ **{taskTitle}**
- Execution: {executionStatus} · Terminal: {terminalStatus}
- Started: {startedAt} {endedAt ? "· Ended: " + endedAt : ""}
- ID: {executionId}
- Output (last lines):
\`\`\`
{outputSnippet ?? "No output"}
\`\`\`
```

### Start Execution Confirmation (`start_task_execution`)

```
⚡ Execution started
- Task: {taskId}
- Execution ID: {executionId}
- Worktree: {worktreePath ?? "direct mode"}
```

### Terminal Output (`get_task_terminal_output`)

```
📺 Terminal — {taskId} ({total} total lines, showing last {lines.length})

\`\`\`
{lines.join("\n")}
\`\`\`
```

### Labels (`list_labels`)

```
🏷️ Labels for {workspaceName}

| Label | Color | Type |
|-------|-------|------|
| {name} | {color} | {isBuiltin ? "Builtin" : "Custom"} |
```

### Project Identification (`identify_project`)

```
🔎 Project matches for "{query}"

| Project | Alias | Workspace | Confidence |
|---------|-------|-----------|------------|
| {name} | {alias ?? "—"} | {workspaceName} | {(confidence * 100).toFixed(0)}% |
```

### Notes (`manage_notes` — list/get)

```
📝 Notes for {projectName}

| Title | Updated | Preview |
|-------|---------|---------|
| {title} | {updatedAt (MM-DD HH:mm)} | {content (first 60 chars)}... |
```

### Assets (`manage_assets` — list)

```
📎 Assets for {projectName}

| Name | Type | Size | Linked Tasks |
|------|------|------|-------------|
| {originalName} | {mimeType} | {size} | {taskCount} |
```

---

## Important Rules

- **Display format is mandatory**: always use the templates above, never output raw JSON or invent custom formats
- **Empty results**: always output "No {items} found." — never silently return nothing
- **SubPath**: for monorepo or multi-folder projects, use `subPath` on task creation to specify the working directory (e.g. "packages/web"). The project description should document the directory structure. If not sure, omit subPath.
- **Cascade deletes**: deleting a workspace removes all its projects and tasks
- **Label replacement**: `set_task_labels` and `update_task` with labelIds do a full replace, not merge
- **Builtin labels**: cannot be deleted (isBuiltin: true)
- **One terminal per task**: each task can have at most one active PTY session
- **Search limit**: returns at most 20 results per query
- **Search categories**: `task`, `project`, `repository`, `note`, `asset`, `all`
