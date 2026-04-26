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
      "When users ask what you can do, respond with this exact list (translated to user's language):",
      "",
      "**工作区 & 项目管理**",
      "查看、创建、更新、删除工作区和项目，搜索项目和资源。",
      "",
      "**任务管理**",
      "创建任务（支持优先级、标签、worktree 分支隔离、子目录、自动启动），移动任务状态（TODO → IN_PROGRESS → IN_REVIEW → DONE / CANCELLED），更新任务信息和标签。",
      "",
      "**执行监控**",
      "启动任务执行、查看执行状态、获取终端输出、向运行中的终端发送指令。",
      "",
      "**日报 & 待办**",
      "生成每日工作总结（已完成 + 进行中），查看待办任务清单（按优先级排序）。",
      "",
      "**标签 & 笔记 & 附件**",
      "管理工作区标签，管理项目笔记和附件文件。",
      "",
      "**全局搜索**",
      "按关键词搜索任务、项目、仓库、笔记、附件。",
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
