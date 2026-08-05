import os from "node:os";
import path from "node:path";
import type {
  CliAdapter,
  CliHostContext,
  CliPlugin,
  CliMcpProbeOptions,
  CliProcessExecutor,
  CliProcessRunOptions,
  CliProcessResult,
  CliProcessSpec,
  CliProcessStreamEvent,
  PlatformName,
  RedactedLogger,
} from "@tower-org/ai-sdk";
import { redactSensitiveRecord, streamProcessJsonLines } from "@tower-org/ai-sdk";
import {
  CommandResolver,
  type CommandResolution,
  ControlledProcessExecutor,
  NodeCliHostFileSystem,
} from "@tower-org/ai-runtime";
import { getPackageRoot } from "@/lib/tower-paths";
import { ensurePathInEnv, stripClaudeNestingEnv, stripTowerRuntimeEnv } from "@/lib/platform";

const PROVIDER_CONFIG_DIR: Record<string, string> = {
  claude: ".claude",
  codex: ".codex",
  gemini: ".gemini",
};

const SAFE_ENV_KEYS = new Set([
  "ALL_PROXY", "ComSpec", "DISPLAY", "HOME", "HOMEDRIVE", "HOMEPATH", "HTTP_PROXY",
  "HTTPS_PROXY", "LANG", "LC_ALL", "LC_CTYPE", "LOCALAPPDATA", "LOGNAME", "NO_PROXY",
  "PATH", "Path", "PATHEXT", "ProgramData", "ProgramFiles", "ProgramW6432", "SHELL",
  "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TERM", "TMP", "TMPDIR", "USER", "USERPROFILE",
  "WAYLAND_DISPLAY", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR",
  "all_proxy", "http_proxy", "https_proxy", "no_proxy",
]);

const PROVIDER_ENV_PREFIXES: Record<string, string[]> = {
  claude: ["ANTHROPIC_", "CLAUDE_"],
  codex: ["OPENAI_", "CODEX_"],
  gemini: ["GEMINI_", "GOOGLE_"],
};

export interface BuiltInProviderSpec {
  id: string;
  agentFieldValue: string;
  plugin: CliPlugin;
}

export interface LegacyCliProfileOverrides {
  command?: string;
  baseArgs?: string[];
  envPatch?: Record<string, string>;
}

export interface ProviderHostOptions {
  baseArgs?: string[];
  envOverrides?: Record<string, string>;
  storageDir?: string;
  providerConfigDir?: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export class ManagedCliProcessExecutor implements CliProcessExecutor {
  constructor(
    private readonly executor: CliProcessExecutor,
    private readonly commandPath: string | undefined,
    private readonly profile: LegacyCliProfileOverrides,
    private readonly signal: AbortSignal,
    private readonly providerId: string,
  ) {}

  execute(spec: CliProcessSpec, options: CliProcessRunOptions = {}): Promise<CliProcessResult> {
    const merged = this.commandPath
      ? mergeProviderProcess(spec, this.commandPath, this.profile)
      : mergeProviderProcess(spec, spec.command, this.profile);
    return this.executor.execute(merged, { ...options, signal: options.signal ?? this.signal });
  }

  stream(spec: CliProcessSpec, options: CliProcessRunOptions = {}): AsyncIterable<CliProcessStreamEvent> {
    if (!this.executor.stream) {
      throw new Error("The provider Host does not support process streaming");
    }
    const merged = this.commandPath
      ? mergeProviderProcess(spec, this.commandPath, this.profile)
      : mergeProviderProcess(spec, spec.command, this.profile);
    return this.executor.stream(merged, { ...options, signal: options.signal ?? this.signal });
  }

  async probeMcpServer(options: CliMcpProbeOptions): Promise<boolean> {
    if (this.providerId !== "codex" || !/^[A-Za-z0-9_-]+$/.test(options.name)) return false;
    const timeoutMs = Math.min(options.timeoutMs ?? 5_000, 5_000);
    const result = await this.execute({
      command: this.commandPath ?? "codex",
      args: ["mcp", "get", options.name, "--json"],
      cwd: options.cwd,
    }, { timeoutMs, signal: options.signal, maxOutputBytes: 256 * 1024 });
    if (result.exitCode !== 0 || !this.executor.stream) return false;

    let configured: unknown;
    try {
      configured = JSON.parse(result.stdout);
    } catch {
      return false;
    }
    const server = record(configured);
    const transport = record(server?.transport);
    if (server?.name !== options.name
      || server.enabled !== true
      || transport?.type !== "stdio"
      || typeof transport.command !== "string") {
      return false;
    }
    const args = Array.isArray(transport.args)
      ? transport.args.filter((value): value is string => typeof value === "string")
      : [];
    const configuredEnv = record(transport.env);
    const envPatch = configuredEnv
      ? Object.fromEntries(Object.entries(configuredEnv).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value]] : []
        ))
      : undefined;
    const initialInput = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "tower-assistant-probe", version: "1" },
      } },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ].map((value) => JSON.stringify(value)).join("\n") + "\n";

    for await (const line of streamProcessJsonLines(this.executor, {
      command: transport.command,
      args,
      cwd: typeof transport.cwd === "string" ? transport.cwd : options.cwd,
      envPatch,
      initialInput,
    }, { timeoutMs, signal: options.signal ?? this.signal, maxOutputBytes: 256 * 1024 })) {
      if (line.type !== "json") continue;
      const response = record(line.value);
      if (response?.id !== 2) continue;
      const tools = record(response.result)?.tools;
      return Array.isArray(tools) && tools.length > 0;
    }
    return false;
  }
}

/** Keep the CLI's own auth/config variables while excluding unrelated application secrets. */
export function providerBaseEnvironment(
  providerId: string,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const prefixes = PROVIDER_ENV_PREFIXES[providerId] ?? [];
  const selected: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (SAFE_ENV_KEYS.has(key) || prefixes.some((prefix) => key.startsWith(prefix))) selected[key] = value;
  }
  return stripTowerRuntimeEnv(stripClaudeNestingEnv(ensurePathInEnv(selected as NodeJS.ProcessEnv))) as Record<string, string>;
}

/** PTY children inherit the user's toolchain/session environment after Tower-specific cleanup. */
export function terminalBaseEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const cleaned = stripTowerRuntimeEnv(stripClaudeNestingEnv(ensurePathInEnv({ ...source })));
  return Object.fromEntries(
    Object.entries(cleaned).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function commandBasename(command: string): string {
  return command
    .split(/[\\/]/)
    .at(-1)!
    .toLowerCase()
    .replace(/\.(?:cmd|exe|bat)$/i, "");
}

/** Legacy profiles have no provider column, so only an explicit command match establishes ownership. */
export function profileForProvider(
  profile: LegacyCliProfileOverrides,
  plugin: CliPlugin,
): LegacyCliProfileOverrides {
  if (!profile.command) return {};
  const candidates = [plugin.manifest.command.default, ...(plugin.manifest.command.aliases ?? [])]
    .map(commandBasename);
  return candidates.includes(commandBasename(profile.command)) ? profile : {};
}

type LoggerSink = Pick<typeof console, "debug" | "info" | "warn" | "error">;

function redactDetail(value: unknown, knownSecrets: string[]): unknown {
  if (typeof value === "string") {
    return knownSecrets.reduce(
      (redacted, secret) => redacted.split(secret).join("***REDACTED***"),
      value,
    );
  }
  if (Array.isArray(value)) return value.map((entry) => redactDetail(entry, knownSecrets));
  if (!value || typeof value !== "object") return value;

  const byKey = redactSensitiveRecord(value as Record<string, unknown>);
  return Object.fromEntries(
    Object.entries(byKey).map(([key, entry]) => [
      key,
      entry === "***REDACTED***" ? entry : redactDetail(entry, knownSecrets),
    ]),
  );
}

export function createProviderLogger(
  providerId: string,
  env: Record<string, string>,
  sink: LoggerSink = console,
): RedactedLogger {
  const knownSecrets = Object.entries(env)
    .filter(([key, value]) => value.length > 0
      && redactSensitiveRecord({ [key]: value })[key] === "***REDACTED***")
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);
  const write = (level: keyof LoggerSink, message: string, details?: Record<string, unknown>) => {
    sink[level](`[ai:${providerId}] ${message}`, details ? redactDetail(details, knownSecrets) : "");
  };
  return {
    debug: (message, details) => write("debug", message, details),
    info: (message, details) => write("info", message, details),
    warn: (message, details) => write("warn", message, details),
    error: (message, details) => write("error", message, details),
  };
}

function managedConfigPaths(providerId: string, platform: PlatformName, env: Record<string, string>): string[] {
  if (providerId !== "codex") return [];
  if (platform === "win32") {
    return [path.win32.join(env.ProgramData ?? "C:\\ProgramData", "OpenAI", "Codex", "requirements.toml")];
  }
  return ["/etc/codex/requirements.toml"];
}

export function createProviderHostContext(
  providerId: string,
  commandPath?: string,
  signal: AbortSignal = new AbortController().signal,
  options: ProviderHostOptions = {},
): CliHostContext {
  const platform = process.platform as PlatformName;
  const env = { ...providerBaseEnvironment(providerId), ...(options.envOverrides ?? {}) };
  const executor = new ControlledProcessExecutor({ platform, env });
  const providerConfigDir = options.providerConfigDir === undefined
    ? path.join(os.homedir(), PROVIDER_CONFIG_DIR[providerId] ?? `.${providerId}`)
    : options.providerConfigDir;
  return {
    platform,
    arch: process.arch,
    storageDir: options.storageDir ?? path.join(os.homedir(), ".tower", "ai-plugins", providerId),
    signal,
    process: new ManagedCliProcessExecutor(
      executor,
      commandPath,
      { baseArgs: options.baseArgs, envPatch: options.envOverrides },
      signal,
      providerId,
    ),
    fileSystem: new NodeCliHostFileSystem(),
    resources: {
      homeDir: os.homedir(),
      ...(providerConfigDir ? { providerConfigDir } : {}),
      commandPath,
      towerPackageRoot: getPackageRoot(),
      managedConfigPaths: managedConfigPaths(providerId, platform, env),
    },
    logger: createProviderLogger(providerId, env),
  };
}

export function createBuiltInAdapter(spec: BuiltInProviderSpec, commandPath?: string): CliAdapter {
  return spec.plugin.createAdapter(createProviderHostContext(spec.id, commandPath), {});
}

export async function resolveBuiltInCommandResolution(
  spec: BuiltInProviderSpec,
  cwd: string,
  commandOverride?: string,
): Promise<CommandResolution> {
  const env = providerBaseEnvironment(spec.id);
  const manifest = spec.plugin.manifest;
  const resolver = new CommandResolver({ platform: process.platform as PlatformName, env });
  return resolver.resolve({
    commandOverride,
    defaultCommand: manifest.command.default,
    aliases: manifest.command.aliases,
    knownPaths: manifest.command.knownPaths?.[process.platform as PlatformName],
    versionArgs: manifest.command.versionArgs,
    cwd,
    env,
    cacheKey: spec.id,
  });
}

/** Host merge order: legacy base args, then provider args; legacy env, then task/provider env. */
export function mergeProviderProcess(
  processSpec: CliProcessSpec,
  commandPath: string,
  profile: LegacyCliProfileOverrides = {},
): CliProcessSpec {
  return {
    ...processSpec,
    command: commandPath,
    args: [...(profile.baseArgs ?? []), ...processSpec.args],
    envPatch: { ...(profile.envPatch ?? {}), ...(processSpec.envPatch ?? {}) },
  };
}
