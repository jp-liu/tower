import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CliProcessExecutor, CliProcessSpec, PlatformName } from "@tower/ai-sdk";
import { isWindows } from "@tower/ai-sdk";
import { ControlledProcessExecutor } from "./process-executor.js";
import {
  commandPathCandidates,
  defaultSupplementalPaths,
  expandKnownPath,
  pathEnvironmentValue,
  type RuntimeEnvironment,
  windowsPathExtensions,
} from "./paths.js";

export type CommandConnectionState = "not-found" | "found" | "runnable" | "connected";
export type CommandDeclarationSource = "command-override" | "manifest-default" | "manifest-alias" | "manual";
export type CommandLocationSource = "direct" | "path" | "supplemental-path" | "known-path" | "cache";

export interface CommandCandidate {
  requestedCommand: string;
  path: string;
  declarationSource: CommandDeclarationSource;
  locationSource: CommandLocationSource;
  state: CommandConnectionState;
  version: string | null;
  diagnostic?: string;
}

export interface CommandResolution {
  originalCommand: string;
  state: CommandConnectionState;
  selected: CommandCandidate | null;
  candidates: CommandCandidate[];
  cachedPath: string | null;
}

export interface ResolveCommandRequest {
  commandOverride?: string;
  defaultCommand: string;
  aliases?: string[];
  supplementalPaths?: string[];
  knownPaths?: string[];
  manualPath?: string;
  cwd?: string;
  env?: RuntimeEnvironment;
  versionArgs?: string[];
  versionTimeoutMs?: number;
  helloProbe?: (candidate: CommandCandidate) => CliProcessSpec;
  helloTimeoutMs?: number;
  signal?: AbortSignal;
  cacheKey?: string;
}

interface ResolverFileSystem {
  exists(filePath: string): Promise<boolean>;
  executable(filePath: string, platform: PlatformName, env: RuntimeEnvironment): Promise<boolean>;
}

export interface CommandResolverOptions {
  platform?: PlatformName;
  env?: RuntimeEnvironment;
  homeDir?: string;
  fileSystem?: ResolverFileSystem;
  executor?: CliProcessExecutor;
}

const nodeFileSystem: ResolverFileSystem = {
  async exists(filePath) {
    try {
      await fs.access(filePath, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  },
  async executable(filePath, platform, env) {
    if (isWindows(platform)) {
      const extension = path.win32.extname(filePath);
      return windowsPathExtensions(env).some((candidate) => candidate.toLowerCase() === extension.toLowerCase());
    }
    try {
      await fs.access(filePath, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
};

export class CommandResolver {
  private readonly platform: PlatformName;
  private readonly baseEnv: RuntimeEnvironment;
  private readonly homeDir: string;
  private readonly fileSystem: ResolverFileSystem;
  private readonly executor: CliProcessExecutor;
  private readonly cache = new Map<string, { originalCommand: string; path: string }>();

  constructor(options: CommandResolverOptions = {}) {
    this.platform = options.platform ?? process.platform as PlatformName;
    this.baseEnv = options.env ?? process.env;
    this.homeDir = options.homeDir ?? os.homedir();
    this.fileSystem = options.fileSystem ?? nodeFileSystem;
    this.executor = options.executor ?? new ControlledProcessExecutor({
      platform: this.platform,
      env: this.baseEnv,
    });
  }

  clearCache(cacheKey?: string): void {
    if (cacheKey) this.cache.delete(cacheKey);
    else this.cache.clear();
  }

  async resolve(request: ResolveCommandRequest): Promise<CommandResolution> {
    const env = request.env ?? this.baseEnv;
    const cwd = request.cwd ?? process.cwd();
    const pathImpl = isWindows(this.platform) ? path.win32 : path.posix;
    const delimiter = isWindows(this.platform) ? ";" : ":";
    const pathDirectories = pathEnvironmentValue(env, this.platform).split(delimiter).filter(Boolean);
    const supplemental = request.supplementalPaths
      ?? defaultSupplementalPaths(this.platform, env, this.homeDir);
    const originalCommand = request.commandOverride?.trim() || request.defaultCommand;
    const declarations: Array<{ command: string; source: CommandDeclarationSource }> = [];
    if (request.commandOverride?.trim()) declarations.push({ command: request.commandOverride.trim(), source: "command-override" });
    declarations.push({ command: request.defaultCommand, source: "manifest-default" });
    for (const alias of request.aliases ?? []) declarations.push({ command: alias, source: "manifest-alias" });

    const attempts: Array<Omit<CommandCandidate, "state" | "version">> = [];
    const pushCommandLocations = (command: string, declarationSource: CommandDeclarationSource) => {
      const direct = pathImpl.isAbsolute(command) || command.includes("/") || command.includes("\\");
      if (direct) {
        const resolved = pathImpl.isAbsolute(command) ? pathImpl.normalize(command) : pathImpl.resolve(cwd, command);
        attempts.push({ requestedCommand: command, path: resolved, declarationSource, locationSource: "direct" });
        return;
      }
      for (const candidate of commandPathCandidates(command, pathDirectories, this.platform, env)) {
        attempts.push({ requestedCommand: command, path: candidate, declarationSource, locationSource: "path" });
      }
      for (const candidate of commandPathCandidates(command, supplemental, this.platform, env)) {
        attempts.push({ requestedCommand: command, path: candidate, declarationSource, locationSource: "supplemental-path" });
      }
    };
    for (const declaration of declarations) pushCommandLocations(declaration.command, declaration.source);

    for (const knownPath of request.knownPaths ?? []) {
      attempts.push({
        requestedCommand: request.defaultCommand,
        path: expandKnownPath(knownPath, this.platform, env, this.homeDir),
        declarationSource: "manifest-default",
        locationSource: "known-path",
      });
    }
    const cached = request.cacheKey ? this.cache.get(request.cacheKey) : undefined;
    if (cached?.originalCommand === originalCommand) {
      attempts.push({
        requestedCommand: originalCommand,
        path: cached.path,
        declarationSource: request.commandOverride ? "command-override" : "manifest-default",
        locationSource: "cache",
      });
    }
    if (request.manualPath) {
      attempts.push({
        requestedCommand: request.manualPath,
        path: pathImpl.isAbsolute(request.manualPath) ? pathImpl.normalize(request.manualPath) : pathImpl.resolve(cwd, request.manualPath),
        declarationSource: "manual",
        locationSource: "direct",
      });
    }

    const candidates: CommandCandidate[] = [];
    const seen = new Set<string>();
    for (const attempt of attempts) {
      const key = isWindows(this.platform) ? attempt.path.toLowerCase() : attempt.path;
      if (seen.has(key)) continue;
      seen.add(key);
      const exists = await this.fileSystem.exists(attempt.path);
      const executable = exists && await this.fileSystem.executable(attempt.path, this.platform, env);
      const candidate: CommandCandidate = {
        ...attempt,
        state: exists ? "found" : "not-found",
        version: null,
      };
      if (executable) {
        try {
          const version = await this.executor.execute(
            { command: attempt.path, args: request.versionArgs ?? ["--version"], cwd },
            { timeoutMs: request.versionTimeoutMs ?? 5_000, signal: request.signal },
          );
          if (version.exitCode === 0) {
            candidate.state = "runnable";
            candidate.version = firstNonEmptyLine(version.stdout) ?? firstNonEmptyLine(version.stderr);
          } else {
            candidate.diagnostic = `Version probe exited with code ${version.exitCode ?? "signal"}`;
          }
        } catch (error) {
          candidate.diagnostic = error instanceof Error ? error.message : "Version probe failed";
        }
      }
      candidates.push(candidate);
    }

    const selected = candidates.find((candidate) => candidate.state === "runnable")
      ?? candidates.find((candidate) => candidate.state === "found")
      ?? null;
    if (selected?.state === "runnable" && request.helloProbe) {
      try {
        const hello = await this.executor.execute(request.helloProbe(selected), {
          timeoutMs: request.helloTimeoutMs ?? 15_000,
          signal: request.signal,
        });
        if (hello.exitCode === 0) selected.state = "connected";
        else selected.diagnostic = `Hello probe exited with code ${hello.exitCode ?? "signal"}`;
      } catch (error) {
        selected.diagnostic = error instanceof Error ? error.message : "Hello probe failed";
      }
    }

    if (request.cacheKey) {
      if (selected && (selected.state === "runnable" || selected.state === "connected")) {
        this.cache.set(request.cacheKey, { originalCommand, path: selected.path });
      } else {
        this.cache.delete(request.cacheKey);
      }
    }
    const cachedPath = request.cacheKey ? this.cache.get(request.cacheKey)?.path ?? null : null;
    return {
      originalCommand,
      state: selected?.state ?? "not-found",
      selected,
      candidates,
      cachedPath,
    };
  }
}

function firstNonEmptyLine(value: string): string | null {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}
