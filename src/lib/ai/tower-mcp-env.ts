/**
 * Dynamic task-terminal environment that a provider must forward to Tower's
 * MCP subprocess. Fixed server configuration such as DATABASE_URL and
 * TOWER_DATA_DIR belongs in McpServerConfig.env instead.
 */
export const TOWER_MCP_ENV_VARS = [
  "CALLBACK_URL",
  "TOWER_API_URL",
  "TOWER_HAS_PARENT",
  "TOWER_MCP_PROFILE",
  "TOWER_PACKAGE_ROOT",
  "TOWER_SIGNAL_DIR",
  "TOWER_STARTED_AT",
  "TOWER_STORAGE_DIR",
  "TOWER_TASK_ID",
  "TOWER_TASK_TITLE",
] as const;
