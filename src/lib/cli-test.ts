import { spawn, type ChildProcess } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types (from adapters/types.ts)
// ---------------------------------------------------------------------------

export interface TestResult {
  ok: boolean;
  checks: TestCheck[];
}

export interface TestCheck {
  name: string;
  passed: boolean;
  message: string;
}

interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

interface RunProcessResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

// ---------------------------------------------------------------------------
// Internal process utilities (from adapters/process-utils.ts)
// ---------------------------------------------------------------------------

interface RunningProcess {
  child: ChildProcess;
  graceSec: number;
}

interface SpawnTarget {
  command: string;
  args: string[];
}

type ChildProcessWithEvents = ChildProcess & {
  on(event: "error", listener: (err: Error) => void): ChildProcess;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): ChildProcess;
};

const runningProcesses = new Map<string, RunningProcess>();
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function appendWithCap(prev: string, chunk: string, cap = MAX_CAPTURE_BYTES) {
  const combined = prev + chunk;
  return combined.length > cap ? combined.slice(combined.length - cap) : combined;
}

async function pathExists(candidate: string) {
  try {
    await fs.access(candidate, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function windowsPathExts(env: NodeJS.ProcessEnv): string[] {
  return (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean);
}

async function resolveCommandPath(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const hasPathSeparator = command.includes("/") || command.includes("\\");
  if (hasPathSeparator) {
    const absolute = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    return (await pathExists(absolute)) ? absolute : null;
  }

  const pathValue = env.PATH ?? env.Path ?? "";
  const delimiter = process.platform === "win32" ? ";" : ":";
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? windowsPathExts(env) : [""];
  const hasExtension = process.platform === "win32" && path.extname(command).length > 0;

  for (const dir of dirs) {
    const candidates =
      process.platform === "win32"
        ? hasExtension
          ? [path.join(dir, command)]
          : exts.map((ext) => path.join(dir, `${command}${ext}`))
        : [path.join(dir, command)];
    for (const candidate of candidates) {
      if (await pathExists(candidate)) return candidate;
    }
  }

  return null;
}

function quoteForCmd(arg: string) {
  if (!arg.length) return '""';
  const escaped = arg.replace(/"/g, '""');
  return /[\s"&<>|^()]/.test(escaped) ? `"${escaped}"` : escaped;
}

async function resolveSpawnTarget(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<SpawnTarget> {
  const resolved = await resolveCommandPath(command, cwd, env);
  const executable = resolved ?? command;

  if (process.platform !== "win32") {
    return { command: executable, args };
  }

  if (/\.(cmd|bat)$/i.test(executable)) {
    const shell = env.ComSpec || process.env.ComSpec || "cmd.exe";
    const commandLine = [quoteForCmd(executable), ...args.map(quoteForCmd)].join(" ");
    return {
      command: shell,
      args: ["/d", "/s", "/c", commandLine],
    };
  }

  return { command: executable, args };
}

async function ensureCommandResolvable(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  const resolved = await resolveCommandPath(command, cwd, env);
  if (resolved) return;
  if (command.includes("/") || command.includes("\\")) {
    const absolute = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    throw new Error(`Command is not executable: "${command}" (resolved: "${absolute}")`);
  }
  throw new Error(`Command not found in PATH: "${command}"`);
}

async function runChildProcess(
  runId: string,
  command: string,
  args: string[],
  opts: {
    cwd: string;
    env: Record<string, string>;
    timeoutSec: number;
    graceSec: number;
    onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
    onLogError?: (err: unknown, runId: string, message: string) => void;
    stdin?: string;
  },
): Promise<RunProcessResult> {
  const onLogError = opts.onLogError ?? ((err, id, msg) => console.warn({ err, runId: id }, msg));

  return new Promise<RunProcessResult>((resolve, reject) => {
    const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...opts.env };

    void resolveSpawnTarget(command, args, opts.cwd, mergedEnv)
      .then((target) => {
        const child = spawn(target.command, target.args, {
          cwd: opts.cwd,
          env: mergedEnv,
          shell: false,
          stdio: [opts.stdin != null ? "pipe" : "ignore", "pipe", "pipe"],
        }) as ChildProcessWithEvents;

        if (opts.stdin != null && child.stdin) {
          child.stdin.write(opts.stdin);
          child.stdin.end();
        }

        runningProcesses.set(runId, { child, graceSec: opts.graceSec });

        let timedOut = false;
        let stdout = "";
        let stderr = "";
        let logChain: Promise<void> = Promise.resolve();

        const timeout =
          opts.timeoutSec > 0
            ? setTimeout(() => {
                timedOut = true;
                child.kill("SIGTERM");
                setTimeout(() => {
                  if (!child.killed) {
                    child.kill("SIGKILL");
                  }
                }, Math.max(1, opts.graceSec) * 1000);
              }, opts.timeoutSec * 1000)
            : null;

        child.stdout?.on("data", (chunk: unknown) => {
          const text = String(chunk);
          stdout = appendWithCap(stdout, text);
          logChain = logChain
            .then(() => opts.onLog("stdout", text))
            .catch((err) => onLogError(err, runId, "failed to append stdout log chunk"));
        });

        child.stderr?.on("data", (chunk: unknown) => {
          const text = String(chunk);
          stderr = appendWithCap(stderr, text);
          logChain = logChain
            .then(() => opts.onLog("stderr", text))
            .catch((err) => onLogError(err, runId, "failed to append stderr log chunk"));
        });

        child.on("error", (err: Error) => {
          if (timeout) clearTimeout(timeout);
          runningProcesses.delete(runId);
          const errno = (err as NodeJS.ErrnoException).code;
          const pathValue = mergedEnv.PATH ?? mergedEnv.Path ?? "";
          const msg =
            errno === "ENOENT"
              ? `Failed to start command "${command}" in "${opts.cwd}". Verify command, working directory, and PATH (${pathValue}).`
              : `Failed to start command "${command}" in "${opts.cwd}": ${err.message}`;
          reject(new Error(msg));
        });

        child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
          if (timeout) clearTimeout(timeout);
          runningProcesses.delete(runId);
          void logChain.finally(() => {
            resolve({
              exitCode: code,
              signal,
              timedOut,
              stdout,
              stderr,
            });
          });
        });
      })
      .catch(reject);
  });
}

// ---------------------------------------------------------------------------
// Parse utilities (from adapters/claude-local/parse.ts)
// ---------------------------------------------------------------------------

const CLAUDE_AUTH_REQUIRED_RE = /(?:not\s+logged\s+in|please\s+log\s+in|please\s+run\s+`?claude\s+login`?|login\s+required|requires\s+login|unauthorized|authentication\s+required)/i;
const URL_RE = /(https?:\/\/[^\s'"`<>()[\]{};,!?]+[^\s'"`<>()[\]{};,!.?:]+)/gi;

function parseJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseClaudeStreamJson(stdout: string) {
  let sessionId: string | null = null;
  let model = "";
  let finalResult: Record<string, unknown> | null = null;
  const assistantTexts: string[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const event = parseJson(line);
    if (!event) continue;

    const type = asString(event.type, "");
    if (type === "system" && asString(event.subtype, "") === "init") {
      sessionId = asString(event.session_id, sessionId ?? "") || sessionId;
      model = asString(event.model, model);
      continue;
    }

    if (type === "assistant") {
      sessionId = asString(event.session_id, sessionId ?? "") || sessionId;
      const message = parseObject(event.message);
      const content = Array.isArray(message.content) ? message.content : [];
      for (const entry of content) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
        const block = entry as Record<string, unknown>;
        if (asString(block.type, "") === "text") {
          const text = asString(block.text, "");
          if (text) assistantTexts.push(text);
        }
      }
      continue;
    }

    if (type === "result") {
      finalResult = event;
      sessionId = asString(event.session_id, sessionId ?? "") || sessionId;
    }
  }

  if (!finalResult) {
    return {
      sessionId,
      model,
      costUsd: null as number | null,
      usage: null as UsageSummary | null,
      summary: assistantTexts.join("\n\n").trim(),
      resultJson: null as Record<string, unknown> | null,
    };
  }

  const usageObj = parseObject(finalResult.usage);
  const usage: UsageSummary = {
    inputTokens: asNumber(usageObj.input_tokens, 0),
    cachedInputTokens: asNumber(usageObj.cache_read_input_tokens, 0),
    outputTokens: asNumber(usageObj.output_tokens, 0),
  };
  const costRaw = finalResult.total_cost_usd;
  const costUsd = typeof costRaw === "number" && Number.isFinite(costRaw) ? costRaw : null;
  const summary = asString(finalResult.result, assistantTexts.join("\n\n")).trim();

  return {
    sessionId,
    model,
    costUsd,
    usage,
    summary,
    resultJson: finalResult,
  };
}

function extractClaudeLoginUrl(text: string): string | null {
  const match = text.match(URL_RE);
  if (!match || match.length === 0) return null;
  for (const rawUrl of match) {
    const cleaned = rawUrl.replace(/[\])}.!,?;:'\"]+$/g, "");
    if (cleaned.includes("claude") || cleaned.includes("anthropic") || cleaned.includes("auth")) {
      return cleaned;
    }
  }
  return match[0]?.replace(/[\])}.!,?;:'\"]+$/g, "") ?? null;
}

function extractClaudeErrorMessages(parsed: Record<string, unknown>): string[] {
  const raw = Array.isArray(parsed.errors) ? parsed.errors : [];
  const messages: string[] = [];

  for (const entry of raw) {
    if (typeof entry === "string") {
      const msg = entry.trim();
      if (msg) messages.push(msg);
      continue;
    }

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }

    const obj = entry as Record<string, unknown>;
    const msg = asString(obj.message, "") || asString(obj.error, "") || asString(obj.code, "");
    if (msg) {
      messages.push(msg);
      continue;
    }

    try {
      messages.push(JSON.stringify(obj));
    } catch {
      // skip non-serializable entry
    }
  }

  return messages;
}

function detectClaudeLoginRequired(input: {
  parsed: Record<string, unknown> | null;
  stdout: string;
  stderr: string;
}): { requiresLogin: boolean; loginUrl: string | null } {
  const resultText = asString(input.parsed?.result, "").trim();
  const messages = [resultText, ...extractClaudeErrorMessages(input.parsed ?? {}), input.stdout, input.stderr]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const requiresLogin = messages.some((line) => CLAUDE_AUTH_REQUIRED_RE.test(line));
  return {
    requiresLogin,
    loginUrl: extractClaudeLoginUrl([input.stdout, input.stderr].join("\n")),
  };
}

// ---------------------------------------------------------------------------
// testEnvironment (from adapters/claude-local/test.ts)
// ---------------------------------------------------------------------------

export async function testEnvironment(cwd: string): Promise<TestResult> {
  const checks: TestCheck[] = [];

  // Check 1: verify `claude` command exists
  try {
    await ensureCommandResolvable("claude", cwd, { ...process.env });
    checks.push({
      name: "claude_command_resolvable",
      passed: true,
      message: "claude command found in PATH",
    });
  } catch (err) {
    checks.push({
      name: "claude_command_resolvable",
      passed: false,
      message: err instanceof Error ? err.message : "claude command not found in PATH",
    });
    return { ok: false, checks };
  }

  // Check 2: get CLI version (best-effort per D-06)
  try {
    const versionProbe = await runChildProcess(
      `claude-version-${Date.now()}`,
      "claude",
      ["--version"],
      {
        cwd,
        env: {},
        timeoutSec: 5,
        graceSec: 2,
        onLog: async () => {},
      },
    );
    const versionStr = (versionProbe.stdout.trim() || versionProbe.stderr.trim()) || "";
    checks.push({
      name: "claude_version",
      passed: true,
      message: versionStr ? `Version: ${versionStr}` : "Version: unknown",
    });
  } catch {
    checks.push({
      name: "claude_version",
      passed: true,
      message: "Version: unknown",
    });
  }

  // Check 3: verify ANTHROPIC_API_KEY (optional — claude may use browser auth)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasApiKey = typeof apiKey === "string" && apiKey.trim().length > 0;
  checks.push({
    name: "anthropic_api_key",
    passed: hasApiKey,
    message: hasApiKey
      ? "ANTHROPIC_API_KEY is set"
      : "ANTHROPIC_API_KEY is not set (claude may use browser/subscription auth)",
  });

  // Check 4: run hello probe
  const probeId = `claude-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    const probe = await runChildProcess(
      probeId,
      "claude",
      ["--print", "-", "--output-format", "stream-json", "--verbose"],
      {
        cwd,
        env: {},
        stdin: "Respond with just the word hello",
        timeoutSec: 45,
        graceSec: 5,
        onLog: async () => {},
      },
    );

    const parsedStream = parseClaudeStreamJson(probe.stdout);
    const parsed = parsedStream.resultJson;
    const loginMeta = detectClaudeLoginRequired({
      parsed,
      stdout: probe.stdout,
      stderr: probe.stderr,
    });

    if (loginMeta.requiresLogin) {
      const hint = loginMeta.loginUrl
        ? `Run \`claude login\` and complete sign-in at ${loginMeta.loginUrl}`
        : "Run `claude login` to authenticate";
      checks.push({
        name: "claude_hello_probe",
        passed: false,
        message: `Claude login required. ${hint}`,
      });
    } else if (probe.timedOut) {
      checks.push({
        name: "claude_hello_probe",
        passed: false,
        message: "Claude hello probe timed out",
      });
    } else if ((probe.exitCode ?? 1) === 0) {
      const summary = parsedStream.summary.trim();
      const hasHello = /\bhello\b/i.test(summary);
      checks.push({
        name: "claude_hello_probe",
        passed: hasHello,
        message: hasHello
          ? "Claude hello probe succeeded"
          : `Claude probe ran but returned unexpected output: ${summary.slice(0, 120)}`,
      });
    } else {
      const stderrLine =
        probe.stderr
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find(Boolean) ?? "";
      checks.push({
        name: "claude_hello_probe",
        passed: false,
        message: stderrLine
          ? `Claude hello probe failed: ${stderrLine}`
          : `Claude hello probe failed with exit code ${probe.exitCode ?? -1}`,
      });
    }
  } catch (err) {
    checks.push({
      name: "claude_hello_probe",
      passed: false,
      message: err instanceof Error ? err.message : "Claude hello probe threw an error",
    });
  }

  const ok = checks.every((c) => c.passed || c.name === "anthropic_api_key");
  return { ok, checks };
}
