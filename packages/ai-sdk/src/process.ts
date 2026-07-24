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

export interface CliFileStat {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** Host-owned file access. Providers never read or write outside paths supplied by the host. */
export interface CliHostFileSystem {
  exists(filePath: string): boolean;
  mkdir(directory: string, options?: { recursive?: boolean }): void;
  readText(filePath: string): string;
  writeText(filePath: string, contents: string): void;
  lstat(filePath: string): Promise<CliFileStat | null>;
  readLink(filePath: string): Promise<string>;
  symlink(target: string, filePath: string, type?: "dir" | "junction"): Promise<void>;
  unlink(filePath: string): Promise<void>;
}

export interface CliHostResources {
  /** User home resolved by the host. */
  homeDir: string;
  /** Provider-owned configuration root, such as ~/.claude or ~/.codex. */
  providerConfigDir: string;
  /** Host-resolved executable used for provider-managed probes and integrations. */
  commandPath?: string;
  /** Tower package root containing scripts and bundled skills. */
  towerPackageRoot?: string;
  /** Optional host-managed policy/config files relevant to this provider. */
  managedConfigPaths?: string[];
}

export interface CliHostContext {
  platform: "darwin" | "linux" | "win32";
  arch: string;
  storageDir: string;
  signal: AbortSignal;
  process: CliProcessExecutor;
  /** Optional v1 extension; providers that need host file access must validate it. */
  fileSystem?: CliHostFileSystem;
  /** Optional v1 extension carrying host-resolved paths and executable. */
  resources?: CliHostResources;
  logger: RedactedLogger;
}
