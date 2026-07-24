// src/lib/ai/types.ts

// ---------------------------------------------------------------------------
// CLI Adapter — PTY execution layer
// ---------------------------------------------------------------------------

export interface CliSpawnOptions {
  taskId: string;
  prompt: string;
  cwd: string;
  envOverrides?: Record<string, string>;
  resumeSessionId?: string;
  continueLatest?: boolean;
  worktreePath?: string;
  /** Extra CLI args (e.g. --append-system-prompt, --model) appended after built-in defaults */
  extraArgs?: string[];
}

export interface CliSpawnResult {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Gemini: spawn 后通过 PTY write 发送初始 prompt */
  initialInput?: string;
}

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

/** Where the registration lives. CLI commands accept this as `-s <scope>`. */
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

export interface CliAdapter {
  buildSpawnArgs(opts: CliSpawnOptions): CliSpawnResult;

  buildEnvOverrides(opts: {
    taskId: string;
    taskTitle: string;
    apiUrl: string;
    callbackUrl?: string;
    /** True when the task was derived by a parent — injects TOWER_HAS_PARENT for the PreToolUse hook. */
    hasParent?: boolean;
    /** Tower's resolved signal dir — injects TOWER_SIGNAL_DIR so the PreToolUse hook can read the unattended flag (TOWER_DATA_DIR is stripped from the PTY env). */
    signalDir?: string;
  }): Record<string, string>;

  // ---- Hooks ---------------------------------------------------------------
  // Method: file write (no CLI subcommand exists in Claude 4.x or Codex 1.x).
  // See .notes/ai-provider-integration.md for the rationale.
  installHooks(apiUrl: string): Promise<InstallResult>;
  uninstallHooks(): Promise<InstallResult>;
  isHooksInstalled(): Promise<boolean>;

  // ---- MCP -----------------------------------------------------------------
  // Method: CLI (`claude mcp add-json` / `codex mcp add`). Direct file edits
  // are forbidden — the CLI's own command keeps us forward-compatible with
  // schema changes.
  installMcp(server: McpServerConfig, opts?: McpInstallOptions): Promise<InstallResult>;
  uninstallMcp(name: string, opts?: McpInstallOptions): Promise<InstallResult>;
  isMcpInstalled(name: string, opts?: McpInstallOptions): Promise<boolean>;

  // ---- Skills --------------------------------------------------------------
  // Method: symlink (`~/.claude/skills/<name>` → repo skill dir).
  // No CLI add/remove command — skills are discovered by directory scan.
  // Symlink lets edits in the repo reflect immediately and lets us safely
  // identify our own installs vs user-managed skills (lstat → isSymbolicLink +
  // readlink target check).
  installSkill(skillName: string, sourceDir: string): Promise<InstallResult>;
  uninstallSkill(skillName: string): Promise<InstallResult>;
  /** When `expectedSourceDir` is given, also verifies the symlink points to that path. */
  isSkillInstalled(skillName: string, expectedSourceDir?: string): Promise<boolean>;

  isAvailable(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  getModels(): Promise<string[]>;

  getConfigDir(): string;
  getSettingsPath(): string;
  getSessionsDir(): string;

  /** API key environment variable name and whether it's strictly required.
   *  If not required, missing key is a warning (user may use subscription auth). */
  getApiKeyInfo(): { envVar: string; required: boolean };

  /** Build the command + args for a non-interactive hello probe.
   *  Embed the prompt inline (no stdin pipe) — Windows libuv crashes when
   *  cmd.exe-wrapped children with piped stdin exit too quickly. */
  buildHelloProbeArgs(prompt: string): { command: string; args: string[] };

  /** Rewrite stale Tower hook command paths in the provider's settings file
   *  to the current `TOWER_PACKAGE_ROOT`. Does NOT install new hook entries —
   *  only refreshes ones that already exist. Used to self-heal users whose
   *  hooks were written by pre-0.2.7 versions with broken `process.cwd()` paths.
   *  Optional; adapters that don't manage hooks via file paths can omit it. */
  repairHookPaths?(): Promise<void>;
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
    adapter: CliAdapter;
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
