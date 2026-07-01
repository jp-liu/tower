export interface ConfigEntry {
  defaultValue: unknown;
  type: "string" | "number" | "boolean" | "object";
  label: string;
}

export const CONFIG_DEFAULTS: Record<string, ConfigEntry> = {
  "git.pathMappingRules": {
    defaultValue: [],
    type: "object",
    label: "Git Path Mapping Rules",
  },
  "system.maxUploadBytes": {
    defaultValue: 52428800,
    type: "number",
    label: "Max Upload Size (bytes)",
  },
  "system.maxConcurrentExecutions": {
    defaultValue: 20,
    type: "number",
    label: "Max Concurrent Executions",
  },
  "system.maxReadableFileBytes": {
    defaultValue: 5_242_880,
    type: "number",
    label: "Max Readable File Size (bytes)",
  },
  "system.backupDir": {
    defaultValue: "",
    type: "string",
    label: "Backup Directory",
  },
  "git.timeoutSec": {
    defaultValue: 30,
    type: "number",
    label: "Git Operation Timeout (seconds)",
  },
  "search.resultLimit": {
    defaultValue: 20,
    type: "number",
    label: "Search Result Limit",
  },
  "search.allModeCap": {
    defaultValue: 5,
    type: "number",
    label: "All-Mode Per-Type Cap",
  },
  "search.debounceMs": {
    defaultValue: 250,
    type: "number",
    label: "Search Debounce (ms)",
  },
  "search.snippetLength": {
    defaultValue: 80,
    type: "number",
    label: "Snippet Length (characters)",
  },
  "search.codeTimeoutSec": {
    defaultValue: 30,
    type: "number",
    label: "Code Search Timeout (seconds)",
  },
  "board.archiveDelayDays": {
    defaultValue: 7,
    type: "number",
    label: "Archive Delay (days)",
  },
  "missions.grid.minCols": {
    defaultValue: 1,
    type: "number",
    label: "Grid Min Columns",
  },
  "missions.grid.maxCols": {
    defaultValue: 5,
    type: "number",
    label: "Grid Max Columns",
  },
  "missions.grid.minRows": {
    defaultValue: 1,
    type: "number",
    label: "Grid Min Rows",
  },
  "missions.grid.maxRows": {
    defaultValue: 5,
    type: "number",
    label: "Grid Max Rows",
  },
  "terminal.app": {
    defaultValue: "Terminal",
    type: "string",
    label: "Default Terminal App",
  },
  "editor.command": {
    defaultValue: "",
    type: "string",
    label: "Default Editor Command",
  },
  "terminal.wsPort": {
    defaultValue: 3001,
    type: "number",
    label: "WebSocket Port",
  },
  "terminal.idleTimeoutSec": {
    defaultValue: 180,
    type: "number",
    label: "Idle Timeout (seconds)",
  },
  "terminal.fontSize": {
    defaultValue: 13,
    type: "number",
    label: "Terminal Font Size",
  },
  "terminal.fontFamily": {
    defaultValue: "Menlo, Monaco, 'Courier New', monospace",
    type: "string",
    label: "Terminal Font Family",
  },
  "assistant.systemPrompt": {
    defaultValue: [
      "You are Tower Assistant — the built-in AI operator for the Tower task management platform.",
      "",
      "## Identity",
      "- You are a task management operator, NOT a coding assistant.",
      "- You can ONLY use Tower MCP tools. You CANNOT read files, edit code, run shell commands, or search the web.",
      "- Always respond in the same language the user uses.",
      "",
      "## Capabilities",
      "When users ask what you can do, respond with EXACTLY these 6 groups. Translate to the user's language.",
      "",
      "1. **Workspace & Project** — View, create, update, delete workspaces and projects. Search projects and repositories.",
      "2. **Task Management** — Create tasks (priority, labels, worktree branch isolation, sub-path, auto-start). Move task status (TODO → IN_PROGRESS → IN_REVIEW → DONE / CANCELLED). Update task info and labels.",
      "3. **Execution Monitor** — Start task execution, check execution status, get terminal output, send commands to running terminals.",
      "4. **Daily Report & Todo** — Generate daily work summary (completed + in-progress). View pending task list sorted by priority.",
      "5. **Labels & Notes & Assets** — Manage workspace labels, project notes, and file attachments.",
      "6. **Global Search** — Search tasks, projects, repositories, notes, and assets by keyword.",
      "",
      "Do NOT list any capabilities beyond the above. Do NOT mention code editing, debugging, testing, git operations, or any development capabilities.",
      "",
      "## Scope Boundary",
      "If the user asks you to write code, explain code, debug, search the web, read/write files, or anything outside Tower task management, reply:",
      "\"抱歉，我只能帮你管理工作区、项目和任务。编码、调试等操作请在任务终端中完成。\"",
      "",
      "## 任务来源标注",
      "每次通过 create_task 创建任务时，在 description 末尾追加一段来源标注（与任务终端、飞书的来源规范一致）：",
      "## 来源",
      "Tower Assistant",
    ].join("\n"),
    type: "string",
    label: "Assistant System Prompt",
  },
  "assistant.displayMode": {
    defaultValue: "sidebar",
    type: "string",
    label: "Assistant Display Mode",
  },
  "assistant.communicationMode": {
    defaultValue: "chat",
    type: "string",
    label: "Assistant Communication Mode",
  },
  "task.defaultUseWorktree": {
    defaultValue: true,
    type: "boolean",
    label: "Default: Use Worktree",
  },
  "task.defaultAutoStart": {
    defaultValue: false,
    type: "boolean",
    label: "Default: Auto-start Execution",
  },
  // Whether the MCP task defaults (worktree / auto-start) have been confirmed by
  // the user once. Until true, the first MCP create_task with no explicit
  // useWorktree/autoStart asks the calling AI to collect the user's preference.
  "task.mcpDefaultsConfigured": {
    defaultValue: false,
    type: "boolean",
    label: "MCP Task Defaults Configured",
  },
  // 内置系统声明：所有任务启动时作为 --append-system-prompt 注入（与任务自选的
  // AgentPrompt merge，内置在前）。built-in：默认值在代码里删不掉（不可删），但可经
  // SystemConfig 覆盖（可修改）。
  "task.systemDirective": {
    defaultValue: [
      "## Tower 系统说明",
      "你运行在 Tower —— 一个 AI 任务调度平台 —— 的任务终端里。你的工作产出会被 Tower 作为「任务执行」记录，并可能被上层（派生你的父任务 / 用户）review。",
      "",
      "## Git 工作规则",
      "- 完成一段有意义的改动后，主动用清晰的 message 创建 commit，不要留一堆未提交的改动。",
      "- 若当前任务运行在 Git worktree 隔离分支里（worktree 任务）：**只 commit，不要 push** —— worktree 分支由 Tower 统一管理与合并。",
      "- 若当前任务直接在项目主工作区里（非 worktree 任务）：可以 push。",
      "- 不确定自己是不是 worktree 任务时，默认只 commit、不 push。",
      "- **本轮回复的最后，必须把本轮创建的 commit 列出来（每条 `<短 hash> <message 首行>`）让用户一眼看到**；本轮没有创建任何 commit 时明确说明「本轮无 commit」。",
    ].join("\n"),
    type: "string",
    label: "Task System Directive (built-in)",
  },
};
