import { execFile } from "node:child_process";
import semver from "semver";
import type { CliPluginManifestV1, CliProcessResult, CliProcessSpec, PlatformName } from "@tower/ai-sdk";
import { CommandResolver, type CommandResolution } from "./command-resolver.js";
import { pluginError } from "./plugin-errors.js";
import { prepareSpawnTarget } from "./process-executor.js";
import type { RuntimeEnvironment } from "./paths.js";

export interface CliDependencyDiagnostic {
  dependency: string;
  state: "missing" | "probe-failed" | "version-incompatible" | "ready";
  commandPath: string | null;
  detectedVersion: string | null;
  supportedVersions: string;
  homepage: string;
  installDocs: string;
  managedByTower: false;
}

export interface CliDependencyVerifier {
  verify(manifest: CliPluginManifestV1): Promise<CliDependencyDiagnostic>;
}

/** Evaluate an already resolved command without probing or loading provider code. */
export function evaluateCliDependency(
  manifest: CliPluginManifestV1,
  commandPath: string | null,
  rawVersion: string | null,
): CliDependencyDiagnostic {
  const dependency = manifest.cliDependency;
  const detectedVersion = rawVersion ? semver.coerce(rawVersion)?.version ?? null : null;
  const base = {
    dependency: dependency.name,
    commandPath,
    detectedVersion,
    supportedVersions: dependency.supportedVersions,
    homepage: dependency.homepage,
    installDocs: dependency.installDocs,
    managedByTower: false as const,
  };
  if (!commandPath) return { ...base, state: "missing" };
  if (!detectedVersion) return { ...base, state: "probe-failed" };
  if (!semver.validRange(dependency.supportedVersions)
    || !semver.satisfies(detectedVersion, dependency.supportedVersions)) {
    return { ...base, state: "version-incompatible" };
  }
  return { ...base, state: "ready" };
}

function safeEnvironment(source: RuntimeEnvironment): RuntimeEnvironment {
  const allowed = [
    "PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "HOME", "USERPROFILE",
    "APPDATA", "LOCALAPPDATA", "NODE_ENV",
  ];
  return {
    NODE_ENV: source.NODE_ENV ?? "production",
    ...Object.fromEntries(allowed.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]])),
  };
}

function nodeEnvironment(value: string | undefined): "production" | "development" | "test" {
  return value === "development" || value === "test" ? value : "production";
}

function execFileProcess(
  platform: PlatformName,
  env: RuntimeEnvironment,
): { execute(spec: CliProcessSpec, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<CliProcessResult> } {
  return {
    async execute(spec, options = {}) {
      const target = await prepareSpawnTarget(spec.command, spec.args, platform, env);
      const childEnv: NodeJS.ProcessEnv = { ...env, NODE_ENV: nodeEnvironment(env.NODE_ENV) };
      for (const [key, value] of Object.entries(spec.envPatch ?? {})) {
        if (value === null) delete childEnv[key];
        else childEnv[key] = value;
      }
      return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        execFile(target.command, target.args, {
          cwd: spec.cwd,
          env: childEnv,
          encoding: "utf8",
          timeout: options.timeoutMs ?? 3_000,
          signal: options.signal,
          windowsHide: true,
          maxBuffer: 256 * 1024,
          shell: false,
        }, (error, stdout, stderr) => {
          if (error && typeof error.code !== "number" && error.killed !== true) {
            reject(error);
            return;
          }
          resolve({
            exitCode: typeof error?.code === "number" ? error.code : error ? null : 0,
            signal: typeof error?.signal === "string" ? error.signal : null,
            stdout,
            stderr,
            durationMs: Date.now() - startedAt,
          });
        });
      });
    },
  };
}

export interface SafeCliDependencyVerifierOptions {
  platform?: PlatformName;
  env?: RuntimeEnvironment;
  cwd?: string;
  resolver?: CommandResolver;
}

export class SafeCliDependencyVerifier implements CliDependencyVerifier {
  private readonly platform: PlatformName;
  private readonly env: RuntimeEnvironment;
  private readonly cwd: string;
  private readonly resolver: CommandResolver;

  constructor(options: SafeCliDependencyVerifierOptions = {}) {
    this.platform = options.platform ?? process.platform as PlatformName;
    this.env = safeEnvironment(options.env ?? process.env);
    this.cwd = options.cwd ?? process.cwd();
    this.resolver = options.resolver ?? new CommandResolver({
      platform: this.platform,
      env: this.env,
      executor: execFileProcess(this.platform, this.env),
    });
  }

  async verify(manifest: CliPluginManifestV1): Promise<CliDependencyDiagnostic> {
    const knownPaths = manifest.command.knownPaths?.[this.platform] ?? [];
    const resolution: CommandResolution = await this.resolver.resolve({
      defaultCommand: manifest.command.default,
      aliases: manifest.command.aliases,
      knownPaths,
      versionArgs: manifest.command.versionArgs,
      versionTimeoutMs: 3_000,
      cwd: this.cwd,
      env: this.env,
    });
    const selected = resolution.selected;
    const diagnostic = selected && selected.state !== "not-found"
      ? evaluateCliDependency(
          manifest,
          selected.path,
          selected.state === "runnable" ? selected.version : null,
        )
      : evaluateCliDependency(manifest, null, null);
    if (diagnostic.state !== "ready") {
      throw pluginError("CLI_DEPENDENCY_UNAVAILABLE", manifest.id, undefined, diagnostic);
    }
    return diagnostic;
  }
}
