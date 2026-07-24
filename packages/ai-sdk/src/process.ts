export interface CliProcessSpec {
  command: string;
  args: string[];
  cwd?: string;
  envPatch?: Record<string, string | null>;
  initialInput?: string;
}

export interface CliProcessRunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

export interface CliProcessResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CliProcessExecutor {
  execute(spec: CliProcessSpec, options?: CliProcessRunOptions): Promise<CliProcessResult>;
}

export interface RedactedLogger {
  debug(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

export interface CliHostContext {
  platform: "darwin" | "linux" | "win32";
  arch: string;
  storageDir: string;
  signal: AbortSignal;
  process: CliProcessExecutor;
  logger: RedactedLogger;
}
