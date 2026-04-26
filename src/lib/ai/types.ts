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
  profileArgs?: string[];
  profileEnvVars?: Record<string, string>;
}

export interface CliSpawnResult {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Gemini: spawn 后通过 PTY write 发送初始 prompt */
  initialInput?: string;
}

export interface CliAdapter {
  buildSpawnArgs(opts: CliSpawnOptions): CliSpawnResult;

  buildEnvOverrides(opts: {
    taskId: string;
    taskTitle: string;
    apiUrl: string;
    callbackUrl?: string;
  }): Record<string, string>;

  installHooks(apiUrl: string): Promise<void>;
  uninstallHooks(): Promise<void>;
  isHooksInstalled(): Promise<boolean>;

  isAvailable(): Promise<boolean>;
  getVersion(): Promise<string | null>;
  getModels(): Promise<string[]>;

  getConfigDir(): string;
  getSettingsPath(): string;
  getSessionsDir(): string;
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
