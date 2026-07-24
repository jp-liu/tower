import os from "node:os";
import path from "node:path";
import type {
  CliAdapter,
  CliHostContext,
  CliPlugin,
  CliProcessSpec,
  PlatformName,
} from "@tower/ai-sdk";
import {
  CommandResolver,
  type CommandResolution,
  ControlledProcessExecutor,
  NodeCliHostFileSystem,
} from "@tower/ai-runtime";
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
): CliHostContext {
  const platform = process.platform as PlatformName;
  const env = providerBaseEnvironment(providerId);
  return {
    platform,
    arch: process.arch,
    storageDir: path.join(os.homedir(), ".tower", "ai-plugins", providerId),
    signal,
    process: new ControlledProcessExecutor({ platform, env }),
    fileSystem: new NodeCliHostFileSystem(),
    resources: {
      homeDir: os.homedir(),
      providerConfigDir: path.join(os.homedir(), PROVIDER_CONFIG_DIR[providerId] ?? `.${providerId}`),
      commandPath,
      towerPackageRoot: getPackageRoot(),
      managedConfigPaths: managedConfigPaths(providerId, platform, env),
    },
    logger: {
      debug: (message, details) => console.debug(`[ai:${providerId}] ${message}`, details ?? ""),
      info: (message, details) => console.info(`[ai:${providerId}] ${message}`, details ?? ""),
      warn: (message, details) => console.warn(`[ai:${providerId}] ${message}`, details ?? ""),
      error: (message, details) => console.error(`[ai:${providerId}] ${message}`, details ?? ""),
    },
  };
}

export function createBuiltInAdapter(spec: BuiltInProviderSpec, commandPath?: string): CliAdapter {
  return spec.plugin.createAdapter(createProviderHostContext(spec.id, commandPath), {});
}

export async function resolveBuiltInCommand(
  spec: BuiltInProviderSpec,
  cwd: string,
  commandOverride?: string,
): Promise<string> {
  const resolution = await resolveBuiltInCommandResolution(spec, cwd, commandOverride);
  if (!resolution.selected || resolution.selected.state === "not-found") {
    throw new Error(`${spec.plugin.manifest.display.name} CLI was not found`);
  }
  if (resolution.selected.state === "found") {
    throw new Error(`${spec.plugin.manifest.display.name} CLI is not runnable`);
  }
  return resolution.selected.path;
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
