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
};
