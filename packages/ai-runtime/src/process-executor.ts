import { constants as fsConstants, promises as fs } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type {
  CliProcessExecutor,
  CliProcessResult,
  CliProcessRunOptions,
  CliProcessSpec,
  CliProcessStreamEvent,
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
    const expanded = value.replace(/%~?dp0%?/gi, directory).replace(/\//g, "\\");
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
  killTree?: (child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) => void;
}

class ProcessEventQueue {
  private values: CliProcessStreamEvent[] = [];
  private waiters: Array<{
    resolve: (value: IteratorResult<CliProcessStreamEvent>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private ended = false;
  private failure: unknown;

  push(value: CliProcessStreamEvent): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  clear(): void {
    this.values = [];
  }

  end(error?: unknown): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = error;
    if (error) this.clear();
    for (const waiter of this.waiters.splice(0)) {
      if (error) waiter.reject(error);
      else waiter.resolve({ value: undefined, done: true });
    }
  }

  next(): Promise<IteratorResult<CliProcessStreamEvent>> {
    const value = this.values.shift();
    if (value) return Promise.resolve({ value, done: false });
    if (this.ended) {
      return this.failure
        ? Promise.reject(this.failure)
        : Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
}

export class ControlledProcessExecutor implements CliProcessExecutor {
  private readonly platform: PlatformName;
  private readonly baseEnv: RuntimeEnvironment;
  private readonly spawnProcess: typeof spawn;
  private readonly now: () => number;
  private readonly killTreeOverride?: ControlledProcessExecutorOptions["killTree"];

  constructor(options: ControlledProcessExecutorOptions = {}) {
    this.platform = options.platform ?? process.platform as PlatformName;
    this.baseEnv = options.env ?? process.env;
    this.spawnProcess = options.spawn ?? spawn;
    this.now = options.now ?? Date.now;
    this.killTreeOverride = options.killTree;
  }

  async execute(spec: CliProcessSpec, options: CliProcessRunOptions = {}): Promise<CliProcessResult> {
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    let exitSignal: string | null = null;
    let durationMs = 0;
    for await (const event of this.stream(spec, options)) {
      if (event.type === "stdout") stdout += stdoutDecoder.decode(event.chunk, { stream: true });
      else if (event.type === "stderr") stderr += stderrDecoder.decode(event.chunk, { stream: true });
      else {
        exitCode = event.exitCode;
        exitSignal = event.signal;
        durationMs = event.durationMs;
      }
    }
    stdout += stdoutDecoder.decode();
    stderr += stderrDecoder.decode();
    return { exitCode, signal: exitSignal, stdout, stderr, durationMs };
  }

  async *stream(spec: CliProcessSpec, options: CliProcessRunOptions = {}): AsyncIterable<CliProcessStreamEvent> {
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
        detached: this.platform !== "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
    } catch (cause) {
      void cause;
      throw new CliPluginError("SPAWN_FAILED", "Failed to start provider process");
    }

    const maxOutputBytes = Math.max(1, options.maxOutputBytes ?? 1024 * 1024);
    let outputBytes = 0;
    const events = new ProcessEventQueue();
    let closed = false;
    let termination: "timeout" | "cancel" | "limit" | undefined;
    const onChunk = (type: "stdout" | "stderr", value: Buffer | string) => {
      if (termination) return;
      const chunk = typeof value === "string" ? Buffer.from(value) : value;
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        terminate("limit");
        return;
      }
      events.push({ type, chunk: new Uint8Array(chunk) });
    };
    child.stdout.on("data", (chunk: Buffer) => {
      onChunk("stdout", chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      onChunk("stderr", chunk);
    });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;
    const killTree = (signal: NodeJS.Signals) => {
      if (this.killTreeOverride) {
        this.killTreeOverride(child, signal);
        return;
      }
      if (this.platform === "win32" && child.pid) {
        try {
          this.spawnProcess("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            shell: false,
            windowsHide: true,
            stdio: "ignore",
          });
        } catch {
          child.kill(signal);
        }
        return;
      }
      try {
        if (child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        child.kill(signal);
      }
    };
    const terminate = (reason: "timeout" | "cancel" | "limit") => {
      if (termination) return;
      termination = reason;
      events.clear();
      killTree("SIGTERM");
      forceKillTimeout = setTimeout(() => killTree("SIGKILL"), 500);
      forceKillTimeout.unref();
      const error = reason === "timeout"
        ? new CliPluginError("PROCESS_TIMEOUT", `Process timed out after ${options.timeoutMs}ms`)
        : reason === "limit"
          ? new CliPluginError("PROCESS_OUTPUT_LIMIT", "Provider process output exceeded the configured limit")
          : new CliPluginError("PROCESS_CANCELLED", "Process was cancelled");
      events.end(error);
    };
    const abort = () => terminate("cancel");
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => terminate("timeout"), Math.max(0, options.timeoutMs));
    }

    child.stdin.on("error", () => {});
    child.once("error", () => {
      events.end(new CliPluginError("SPAWN_FAILED", "Provider process failed"));
    });
    child.once("close", (exitCode, signal) => {
      closed = true;
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      if (termination === "timeout") {
        events.end(new CliPluginError("PROCESS_TIMEOUT", `Process timed out after ${options.timeoutMs}ms`));
      } else if (termination === "cancel") {
        events.end(new CliPluginError("PROCESS_CANCELLED", "Process was cancelled"));
      } else if (termination === "limit") {
        events.end(new CliPluginError("PROCESS_OUTPUT_LIMIT", "Provider process output exceeded the configured limit"));
      } else {
        events.push({
          type: "exit",
          exitCode,
          signal,
          durationMs: Math.max(0, this.now() - startedAt),
        });
        events.end();
      }
    });

    if (spec.initialInput !== undefined) child.stdin.end(spec.initialInput);
    else child.stdin.end();

    try {
      while (true) {
        const event = await events.next();
        if (event.done) break;
        yield event.value;
      }
    } finally {
      if (!closed && !termination) terminate("cancel");
      if (timeout) clearTimeout(timeout);
      if (closed && forceKillTimeout) clearTimeout(forceKillTimeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}
