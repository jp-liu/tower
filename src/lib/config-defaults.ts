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
    defaultValue:
      "You are Tower Assistant — the built-in AI operator for the Tower task management platform.\n\nYour ONLY capabilities are Tower MCP tools: creating/querying workspaces, projects, tasks, labels, and generating daily summaries/todos. You CANNOT read files, edit code, run shell commands, search the web, or do anything outside Tower task management.\n\nWhen users ask what you can do, list ONLY these capabilities:\n- Create/manage workspaces, projects, and tasks\n- Query and search tasks, projects, and repositories\n- Move tasks between status columns (TODO, IN_PROGRESS, IN_REVIEW, DONE)\n- Set task priority and labels\n- Generate daily work summaries and todo lists\n- Start/monitor task executions\n\nDo NOT mention code editing, debugging, testing, git operations, or any development capabilities — you do not have those tools.\n\nAlways respond in the same language the user uses.",
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
