# Display Templates

All query results MUST follow these templates. Do NOT invent your own format. When results are empty, output "No {items} found." (e.g. "No tasks found.", "No workspaces found.").

**Server-rendered cards — show `response.display` verbatim.** `create_task`,
`start_task_execution`, `get_task_execution_status`, and `get_task_terminal_output`
return a ready-formatted `display` string in their response. Present that `display`
to the user as-is instead of re-deriving the format — the templates for those four
below just document what `display` already contains (fallback only if it's absent).
Everything else here (list/search/daily tables) you render yourself from the data.

## Priority Markers

Use consistently across all templates: 🔴 CRITICAL · 🟠 HIGH · 🟡 MEDIUM · ⚪ LOW

## Labels Format

Always render labels as comma-separated names (e.g. `bug, frontend`). Omit the column if no task has labels.

---

## Workspaces (`list_workspaces`)

```
| Workspace | Projects | Description |
|-----------|----------|-------------|
| {name}    | {projectCount} | {description ?? "—"} |
```

## Projects (`list_projects`)

Note: the response does not include workspace name. Use the workspace name from the prior `list_workspaces` call or the user's context.

```
📂 {workspaceName}

| Project | Type | Tasks | Path |
|---------|------|-------|------|
| {name} ({alias}) | {type} | {taskCount} | {localPath ?? "—"} |
```

## Tasks (`list_tasks`)

```
📋 {projectName}

| ID | Task | Status | Priority | Labels |
|----|------|--------|----------|--------|
| {id (first 8 chars)} | {title} | {status} | {priority} | {labels} |
```

## Task Creation Confirmation

After `create_task` succeeds, render based on the **response** (not the input
parameter — `autoStart: true` does NOT mean execution actually started; check
`response.execution` and `response.executionError`):

```
✅ Task created: **{title}**
- Project: {projectName}
- Priority: {priority}
- Status: {status}
- Worktree: {yes/no}
{worktree yes ? "- Base branch: " + response.baseBranch : ""}
{response.execution ? "⚡ Execution started" : response.executionError ? "⚠️ Auto-start failed: " + response.executionError : ""}
```

`response.baseBranch` is non-null only when worktree isolation applies — show the
`- Base branch:` line only then (omit it entirely for direct-mode tasks).

If `executionError` is present, surface it verbatim — common causes are server
not running, concurrency limit hit, or project missing localPath. Do not say
"Execution started" when the response only shows `executionError`.

## Daily Summary (`daily_summary`)

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

## Daily Todo (`daily_todo`)

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

## Search Results (`search`)

Categories: `task`, `project`, `repository`, `note`, `asset`, `all`. Result count = `results.length`.

```
🔍 Results for "{query}" ({results.length} found)

| Type | Name | Location | Snippet |
|------|------|----------|---------|
| {type} | {title} | {subtitle} | {snippet ?? "—"} |
```

## Execution Status (`get_task_execution_status`)

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

## Start Execution Confirmation (`start_task_execution`)

```
⚡ Execution started
- Task: {taskId}
- Execution ID: {executionId}
- Worktree: {worktreePath ?? "direct mode"}
```

## Terminal Output (`get_task_terminal_output`)

```
📺 Terminal — {taskId} ({total} total lines, showing last {lines.length})

\`\`\`
{lines.join("\n")}
\`\`\`
```

## Labels (`list_labels`)

```
🏷️ Labels for {workspaceName}

| Label | Color | Type |
|-------|-------|------|
| {name} | {color} | {isBuiltin ? "Builtin" : "Custom"} |
```

## Project Identification (`identify_project`)

```
🔎 Project matches for "{query}"

| Project | Alias | Workspace | Confidence |
|---------|-------|-----------|------------|
| {name} | {alias ?? "—"} | {workspaceName} | {(confidence * 100).toFixed(0)}% |
```

## Notes (`manage_notes` — list/get)

```
📝 Notes for {projectName}

| Title | Updated | Preview |
|-------|---------|---------|
| {title} | {updatedAt (MM-DD HH:mm)} | {content (first 60 chars)}... |
```

## Assets (`manage_assets` — list)

```
📎 Assets for {projectName}

| Name | Type | Size | Linked Tasks |
|------|------|------|-------------|
| {originalName} | {mimeType} | {size} | {taskCount} |
```
