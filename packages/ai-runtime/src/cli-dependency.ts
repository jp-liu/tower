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

function safeEnvironment(source: RuntimeEnvironment): RuntimeEnvironment {
  const allowed = ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"];
  return Object.fromEntries(allowed.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]));
}

function execFileProcess(
  platform: PlatformName,
  env: RuntimeEnvironment,
): { execute(spec: CliProcessSpec, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<CliProcessResult> } {
  return {
    async execute(spec, options = {}) {
      const target = await prepareSpawnTarget(spec.command, spec.args, platform, env);
      const childEnv: NodeJS.ProcessEnv = { ...env };
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
    const dependency = manifest.cliDependency;
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
    const detectedVersion = selected?.version ? semver.coerce(selected.version)?.version ?? null : null;
    const base = {
      dependency: dependency.name,
      commandPath: selected?.path ?? null,
      detectedVersion,
      supportedVersions: dependency.supportedVersions,
      homepage: dependency.homepage,
      installDocs: dependency.installDocs,
      managedByTower: false as const,
    };
    let diagnostic: CliDependencyDiagnostic;
    if (!selected || selected.state === "not-found") {
      diagnostic = { ...base, state: "missing" };
    } else if (selected.state !== "runnable" || !detectedVersion) {
      diagnostic = { ...base, state: "probe-failed" };
    } else if (!semver.validRange(dependency.supportedVersions)
      || !semver.satisfies(detectedVersion, dependency.supportedVersions)) {
      diagnostic = { ...base, state: "version-incompatible" };
    } else {
      diagnostic = { ...base, state: "ready" };
    }
    if (diagnostic.state !== "ready") {
      throw pluginError("CLI_DEPENDENCY_UNAVAILABLE", manifest.id, undefined, diagnostic);
    }
    return diagnostic;
  }
}
