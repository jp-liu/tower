import { constants as fsConstants, promises as fs } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type {
  CliProcessExecutor,
  CliProcessResult,
  CliProcessRunOptions,
  CliProcessSpec,
  PlatformName,
} from "@tower/ai-sdk";
import {
  CliPluginError,
  isShellCommandString,
  isWindows,
  quoteForCmd,
  redactSensitiveRecord,
} from "@tower/ai-sdk";
import type { RuntimeEnvironment } from "./paths.js";

export interface SpawnTarget {
  command: string;
  args: string[];
}

export interface ProcessDiagnostic {
  command: string;
  argumentCount: number;
  cwd?: string;
  envPatch?: Record<string, unknown>;
}

export function redactProcessDiagnostic(spec: CliProcessSpec): ProcessDiagnostic {
  return {
    command: spec.command,
    argumentCount: spec.args.length,
    cwd: spec.cwd,
    envPatch: spec.envPatch ? redactSensitiveRecord(spec.envPatch) : undefined,
  };
}

export function parseWindowsNpmShim(shimPath: string, contents: string): string[] {
  const directory = path.win32.dirname(shimPath);
  const expand = (value: string) => {
    const expanded = value.replace(/%~?dp0%/gi, directory).replace(/\//g, "\\");
    return path.win32.isAbsolute(expanded)
      ? path.win32.normalize(expanded)
      : path.win32.resolve(directory, expanded);
  };
  const targets: string[] = [];
  for (const match of contents.matchAll(/["']([^"']+\.(?:mjs|cjs|js|exe))["']/gi)) {
    const candidate = expand(match[1]);
    if (path.win32.basename(candidate).toLowerCase() === "node.exe") continue;
    if (!targets.includes(candidate)) targets.push(candidate);
  }
  return targets;
}

export async function prepareSpawnTarget(
  command: string,
  args: string[],
  platform: PlatformName,
  env: RuntimeEnvironment,
  dependencies: {
    readFile?: (filePath: string) => Promise<string>;
    exists?: (filePath: string) => Promise<boolean>;
    nodeExecutable?: string;
  } = {},
): Promise<SpawnTarget> {
  if (!isWindows(platform) || !/\.(?:cmd|bat)$/i.test(command)) return { command, args };

  const readFile = dependencies.readFile ?? ((filePath: string) => fs.readFile(filePath, "utf8"));
  const exists = dependencies.exists ?? (async (filePath: string) => {
    try {
      await fs.access(filePath, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  });

  try {
    const contents = await readFile(command);
    for (const target of parseWindowsNpmShim(command, contents)) {
      if (!(await exists(target))) continue;
      if (/\.(?:mjs|cjs|js)$/i.test(target)) {
        return { command: dependencies.nodeExecutable ?? process.execPath, args: [target, ...args] };
      }
      return { command: target, args };
    }
  } catch {
    // Non-npm shims are safely delegated to cmd.exe below.
  }

  const shell = env.ComSpec ?? "cmd.exe";
  const commandLine = [quoteForCmd(command), ...args.map(quoteForCmd)].join(" ");
  return { command: shell, args: ["/d", "/s", "/c", commandLine] };
}

export interface ControlledProcessExecutorOptions {
  platform?: PlatformName;
  env?: RuntimeEnvironment;
  spawn?: typeof spawn;
  now?: () => number;
}

export class ControlledProcessExecutor implements CliProcessExecutor {
  private readonly platform: PlatformName;
  private readonly baseEnv: RuntimeEnvironment;
  private readonly spawnProcess: typeof spawn;
  private readonly now: () => number;

  constructor(options: ControlledProcessExecutorOptions = {}) {
    this.platform = options.platform ?? process.platform as PlatformName;
    this.baseEnv = options.env ?? process.env;
    this.spawnProcess = options.spawn ?? spawn;
    this.now = options.now ?? Date.now;
  }

  async execute(spec: CliProcessSpec, options: CliProcessRunOptions = {}): Promise<CliProcessResult> {
    if (!spec.command.trim()) throw new CliPluginError("SPAWN_FAILED", "Process command is required");
    if (isShellCommandString(spec.command)) {
      throw new CliPluginError("SPAWN_FAILED", "Shell command strings are not allowed");
    }
    if (options.signal?.aborted) throw new CliPluginError("PROCESS_CANCELLED", "Process was cancelled");

    const target = await prepareSpawnTarget(spec.command, spec.args, this.platform, this.baseEnv);
    const env = { ...this.baseEnv };
    for (const [key, value] of Object.entries(spec.envPatch ?? {})) {
      if (value === null) delete env[key];
      else env[key] = value;
    }

    const startedAt = this.now();
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess(target.command, target.args, {
        cwd: spec.cwd,
        env: env as NodeJS.ProcessEnv,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
    } catch (cause) {
      throw new CliPluginError("SPAWN_FAILED", `Failed to start ${spec.command}`, { cause });
    }

    const maxOutputBytes = Math.max(1, options.maxOutputBytes ?? 1024 * 1024);
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const append = (current: string, currentBytes: number, chunk: Buffer): [string, number] => {
      if (currentBytes >= maxOutputBytes) return [current, currentBytes];
      const slice = chunk.subarray(0, maxOutputBytes - currentBytes);
      return [current + slice.toString("utf8"), currentBytes + slice.length];
    };
    child.stdout.on("data", (chunk: Buffer) => {
      [stdout, stdoutBytes] = append(stdout, stdoutBytes, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      [stderr, stderrBytes] = append(stderr, stderrBytes, chunk);
    });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;
    let termination: "timeout" | "cancel" | undefined;
    const terminate = (reason: "timeout" | "cancel") => {
      if (termination) return;
      termination = reason;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), 500);
      forceKillTimeout.unref();
    };
    const abort = () => terminate("cancel");
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => terminate("timeout"), Math.max(0, options.timeoutMs));
    }

    if (spec.initialInput !== undefined) child.stdin.end(spec.initialInput);
    else child.stdin.end();

    try {
      const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
      });
      if (termination === "timeout") {
        throw new CliPluginError("PROCESS_TIMEOUT", `Process timed out after ${options.timeoutMs}ms`);
      }
      if (termination === "cancel") {
        throw new CliPluginError("PROCESS_CANCELLED", "Process was cancelled");
      }
      return {
        exitCode: result.exitCode,
        signal: result.signal,
        stdout,
        stderr,
        durationMs: Math.max(0, this.now() - startedAt),
      };
    } catch (cause) {
      if (cause instanceof CliPluginError) throw cause;
      throw new CliPluginError("SPAWN_FAILED", `Failed while running ${spec.command}`, { cause });
    } finally {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}
