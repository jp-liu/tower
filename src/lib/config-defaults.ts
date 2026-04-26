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
};
