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
4. **Worktree mode**: default is direct mode (no branch isolation). If user says "use worktree", "-w", or "branch isolation", set `useWorktree: true`. The baseBranch will be auto-detected from the project's current git branch.
5. **SubPath detection**: check the project description for directory structure hints (e.g. "monorepo: packages/web, packages/api"). If the task clearly belongs to a subdirectory, set `subPath` (e.g. "packages/web"). If unclear, omit it — it's optional.
6. **References (any files/images)**: ALL user-provided files — including pasted screenshots, uploaded images, and local file paths — should be passed as `references: ["/path/to/file"]` on `create_task`. The tool copies files into the project asset library automatically.
   - **Local file paths**: pass directly (e.g. `references: ["/path/to/doc.md", "/path/to/design.png"]`)
   - **Pasted images with known paths**: if the platform provides file paths for pasted media (e.g. OpenClaw's `{{MediaPaths}}`, Claude Code temp files), pass those paths directly — they are local files
   - **Base64 only (no file path)**: if you only have base64 data with no local path, upload first via `manage_assets` with `action: "upload"`, `projectId`, `base64`, `mimeType`. Get back `{ id: assetId, path }`. Then pass the returned `path` in `references` and after task creation call `manage_assets` with `action: "link_task"`, `taskId`, `assetIds: [assetId]`
7. Call `create_task` with projectId, title, and optional description/priority/labelIds/subPath/useWorktree/references
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

## Important Rules

- **SubPath**: for monorepo or multi-folder projects, use `subPath` on task creation to specify the working directory (e.g. "packages/web"). The project description should document the directory structure. If not sure, omit subPath.
- **Cascade deletes**: deleting a workspace removes all its projects and tasks
- **Label replacement**: `set_task_labels` and `update_task` with labelIds do a full replace, not merge
- **Builtin labels**: cannot be deleted (isBuiltin: true)
- **One terminal per task**: each task can have at most one active PTY session
- **Search limit**: returns at most 20 results per query
