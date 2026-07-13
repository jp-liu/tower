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
      "args": ["tsx", "<project-root>/src/mcp/index.ts"]
    }
  }
}
```

**Other AI agents** — add the same config to your MCP client settings file. After configuration, restart the AI session.

---

## Core Contracts (must follow)

The must-follow rules. Everything else is operational detail below.

1. **Act, don't announce.** Once you have enough info, emit the tool call in the *same* turn. Never reply "I'll create it now" and end the turn with no tool call. Missing info → ask a *specific* question.
2. **You are a task-management operator only.** Coding, debugging, web search, file edits, or anything outside Tower task management → reply: "抱歉，我只能帮你管理工作区、项目和任务。编码、调试等操作请在任务终端中完成。" Do not attempt out-of-scope work.
3. **Structure the description** into the Markdown template (see *Task Description Format*) — never dump the user's raw message.
4. **Never hand-format `## 来源`.** The server guarantees it (fallback `无`, parent-derivation, `<task-source>` rendering). Just pass any `<task-source>` block through verbatim. See [references/task-source.md](references/task-source.md).
5. **Worktree / auto-start defaults**: `create_task` follows the user's saved global preference. On `{ needsDefaultsSetup: true }`, ask the two questions, call `set_task_defaults` once, then retry. Explicit `useWorktree`/`autoStart` args override and skip the prompt.
6. **Render task-creation from the *response*, not the input** — `autoStart: true` does not mean it started; check `response.execution` / `response.executionError`.
7. **All files/images go in `references`** on `create_task` (local paths directly; base64-only → `manage_assets upload` first, then pass the returned path).
8. **Labels & versions replace, not merge.** `set_task_labels` / `update_task labelIds` overwrite the full set. `versionId: null`/`""` moves a task to the backlog.
9. **Follow the Display Templates** in [references/display-templates.md](references/display-templates.md) for every query result — never invent formats or output raw JSON. Empty results → "No {items} found."
10. **Platform replies go through `relay_channel_reply`** when they contain or quote `[[tower:task=...]]`. Pass `platform`, `chatId`, `platformMessageId`, and `quotedText` when available; it disambiguates ask replies vs work-channel replies. For direct UI/operator replies to a parked ask, `reply_to_ask` is still valid.
11. **Unattended send/receive** follows [references/unattended-messaging.md](references/unattended-messaging.md): Hermes/OpenClaw can send via `push_to_human`; every outbound ask/notify carries `[[tower:task=<taskId>]]`.

---

## When to Use

Use Tower tools when the user wants to view/create/manage tasks and projects, check execution status, interact with a running task's terminal, search, organize with labels/status, or get a daily summary / todo. For unattended relay (the tower-goal / tower-ask skills, pushing `ask_human`/`notify_human`, or `reply_to_ask`), read [references/unattended-messaging.md](references/unattended-messaging.md).

## Session default scope

If a turn opens with `[当前会话默认范围：…]`, the user bound this chat to a workspace/project. Treat it as the **default scope** for scope-needing actions (use those ids directly, skip `identify_project`/`search`). It's a soft default, **not a hard filter** — global requests (daily summary, cross-workspace search) ignore it. The latest scope prefix always wins.

---

## Scenarios

### "Create a task" / "Add a task for ..."

1. Resolve the target project (`list_workspaces` → `list_projects`, or use the session scope / `identify_project`). Confirm or infer from context.
2. **Worktree / auto-start** (Contract 5): on `{ needsDefaultsSetup: true }`, ask (a) default to Git worktree isolation? (b) auto-start after create? → `set_task_defaults` once → retry. When worktree resolves true you may pass `baseBranch` (else the project's current branch is auto-detected).
3. **Version (optional)**: `list_versions` → let the user pick → pass `versionId`. Omit for backlog.
4. **SubPath**: for a monorepo, if the task clearly belongs to a subdir (per the project description), set `subPath` (e.g. `packages/web`); else omit.
5. **References** (Contract 7): pass all file paths / pasted-image paths in `references`. Base64-only → `manage_assets upload` first, then pass the returned `path`.
6. **Source** (Contract 4): don't hand-format `## 来源`; pass any `<task-source>` block through in `description`. The server renders it.
7. Call `create_task`, then render from the response (Contract 6).

### "Start a task" / "Run this task"

`start_task_execution` with taskId and an optional prompt (defaults to task title/description as context). Status flips to IN_PROGRESS.

### "What's running?" / "Check progress"

`get_task_execution_status` → if running, `get_task_terminal_output` (default 50 lines) → summarize status + recent output + duration.

### "Send a message to the task" / "Tell it to ..."

`send_task_terminal_input` with taskId and text. If the message came from an external platform and contains/quotes `[[tower:task=...]]`, use `relay_channel_reply` instead (Contract 10). Then `get_task_terminal_output` to see the response.

### "Move / cancel / edit a task"

- `move_task` with the target status (DONE, CANCELLED, …).
- `update_task` with any of `title`/`description`/`priority`/`labelIds`/`subPath`/`versionId` (only passed fields change; labels/version replace — Contract 8).

### "Search for ..." / "Find tasks about ..."

`search` with the query; optional `category` (`task`/`project`/`repository`/`note`/`asset`/`all`, ≤20 results). Results include `navigateTo` paths.

### "Label / tag this task"

`list_labels` (workspaceId) → `set_task_labels` (taskId + full desired labelId set — replaces all, Contract 8).

### "今天做了什么？" / Daily summary

`daily_summary` (no params = today, or `date: "YYYY-MM-DD"`). Grouped by workspace → project with `completed` and `inProgress` (incl. `progressSummary`).

### "今天有什么待办？" / Daily todo

`daily_todo` (all TODO/IN_PROGRESS/IN_REVIEW). Optional `workspaceId`/`projectId`/`status`/`priority` filters. Sorted by priority severity; each task has `lastSessionId` for resume.

### "Create a project"

`list_workspaces` → `create_project` with workspaceId, name, optionally `gitUrl` (makes it GIT with worktree support) and `localPath`.

---

## Task Lifecycle

```
TODO → IN_PROGRESS → IN_REVIEW → DONE
                                → CANCELLED
```

TODO (created) · IN_PROGRESS (agent working) · IN_REVIEW (execution done, awaiting review/merge) · DONE (merged) · CANCELLED (dropped).

---

## Task Description Format

The `description` is Markdown. **Never copy the user's raw message as-is** — restructure into:

```markdown
## 目标
<one sentence: what to achieve>

## 需求
- <requirement 1>
- <requirement 2>

## 参考
- <file paths, API endpoints, design references>

## 备注
- <constraints, edge cases>
```

Rules:
- `title`: short (< 30 chars), summarizing the task.
- Extract actionable requirements from natural language; omit empty sections.
- File paths go in **both** `参考` and the `references` parameter.
- **`## 来源`**: don't write it yourself — the server guarantees it (Contract 4). Just pass any `<task-source>` bridge block through verbatim in `description`. Details: [references/task-source.md](references/task-source.md).

---

## Reference Files

- [references/display-templates.md](references/display-templates.md) — mandatory output formats for every query result.
- [references/task-source.md](references/task-source.md) — `## 来源` server rendering, `<task-source>` block format, channel map.
- [references/unattended-messaging.md](references/unattended-messaging.md) — unattended send/receive contract.

## Other Rules

- **Empty results**: always output "No {items} found." — never silently return nothing.
- **Cascade deletes**: deleting a workspace removes all its projects and tasks.
- **Builtin labels** (`isBuiltin: true`) cannot be deleted.
- **One terminal per task**: at most one active PTY session per task.
