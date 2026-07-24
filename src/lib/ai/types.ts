// src/lib/ai/types.ts

import type { CliAdapter as SdkCliAdapter, CliPlugin } from "@tower/ai-sdk";

// Legacy Hermes gateway integration types. Task-terminal providers use the
// public @tower/ai-sdk contract exclusively.

export interface McpServerConfig {
  /** Unique name for the MCP server (e.g. "tower") */
  name: string;
  /** Command to launch the server (e.g. "npx") */
  command: string;
  /** Arguments for the command */
  args: string[];
  /** Environment variables to pass to the server process */
  env?: Record<string, string>;
  /** Parent-process environment variable names to forward dynamically. */
  envVars?: string[];
}

/** Where the legacy gateway registration lives. */
export type McpScope = "user" | "project" | "local";

export interface McpInstallOptions {
  /** Defaults to "user" — system-wide registration in ~/.claude.json or ~/.codex/config.toml. */
  scope?: McpScope;
  /** Required for scope=project — the project directory whose .mcp.json gets the entry. */
  cwd?: string;
}

/**
 * Result of a single integration install/uninstall.
 *
 * `method` lets the UI / logs surface *how* the change was applied, so we can tell
 * at a glance whether we used the CLI's own API ("cli") or had to fall back to a
 * file write ("file") because the CLI doesn't expose that operation. "symlink"
 * is its own bucket because skill discovery is filesystem-based on both Claude
 * and Codex — there is no `claude skill add` command.
 */
export interface InstallResult {
  ok: boolean;
  method: "cli" | "file" | "symlink";
  /** Command string, file path, or symlink target — whatever was actually applied. */
  detail: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// AI Query Adapter — single-turn and streaming queries
// ---------------------------------------------------------------------------

export interface AiQueryOptions {
  prompt: string;
  cwd?: string;
  systemPrompt?: string;
  model?: string;
  maxTurns?: number;
  tools?: string[];
  allowedTools?: string[];
}

export interface AiQueryResult {
  content: string | null;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AiQueryChunk {
  type: "text" | "tool_use" | "tool_result" | "error";
  content: string;
}

export interface AiQueryAdapter {
  query(opts: AiQueryOptions): Promise<AiQueryResult>;
  queryStream?(opts: AiQueryOptions): AsyncIterable<AiQueryChunk>;

  isAvailable(): Promise<boolean>;
  getModels(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Provider definition & registry types
// ---------------------------------------------------------------------------

export interface ProviderDefinition {
  name: string;
  displayName: string;
  agentFieldValue: string;

  cli?: {
    command: string;
    adapter: SdkCliAdapter;
    plugin: CliPlugin;
  };
  api?: {
    keyEnvVar: string;
    adapter: AiQueryAdapter;
  };
  cliQuery?: {
    adapter: AiQueryAdapter;
  };

  models: {
    cli: string[];
    api: string[];
  };
}

export interface ProviderAvailability {
  name: string;
  displayName: string;
  cli: { available: boolean; version: string | null };
  api: { available: boolean; keyConfigured: boolean };
}

// ---------------------------------------------------------------------------
// Capability slot config (mirrors Prisma model)
// ---------------------------------------------------------------------------

export type AiSlot = "terminal" | "summary" | "dreaming" | "analysis" | "assistant";

export interface AiSlotConfig {
  slot: AiSlot;
  provider: string;
  mode: "cli" | "api";
  model?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AiProviderErrorCode =
  | "CLI_NOT_FOUND"
  | "API_KEY_MISSING"
  | "MODEL_NOT_AVAILABLE"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "UNSUPPORTED_MODE"
  | "SPAWN_FAILED";

export class AiProviderError extends Error {
  constructor(
    public code: AiProviderErrorCode,
    public provider: string,
    message: string,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
