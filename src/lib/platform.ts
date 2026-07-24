/**
 * platform.ts — Unified cross-platform utilities.
 *
 * Consolidates duplicate command-resolution and path-normalization logic that
 * previously lived in both cli-test.ts (async, for child_process.spawn) and
 * session-store.ts (sync, for node-pty).  Both consumers now import from here.
 *
 * Design constraints:
 *   - Must support both sync (PTY) and async (spawn) callers.
 *   - Must be testable with platform mocks (win32 / darwin / linux).
 *   - No side-effects on import — all state is passed as arguments.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  isWindows as sdkIsWindows,
  normalizePath as sdkNormalizePath,
  quoteForCmd as sdkQuoteForCmd,
  redactSensitiveRecord,
  toForwardSlash as sdkToForwardSlash,
  type PlatformName,
} from "@tower/ai-sdk";
import {
  defaultSupplementalPaths,
  findCommandPath,
  findCommandPathSync,
  mergePathEnvironment,
  prepareSpawnTarget,
  type LegacyCommandLookup,
} from "@tower/ai-runtime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnTarget {
  command: string;
  args: string[];
}

export interface ResolveCommandOptions {
  /** Working directory for resolving relative paths */
  cwd?: string;
  /** Environment variables (defaults to process.env) */
  env?: NodeJS.ProcessEnv;
  /** Override platform for testing (defaults to process.platform) */
  platform?: NodeJS.Platform;
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

export function isWindows(platform: NodeJS.Platform = process.platform): boolean {
  return sdkIsWindows(platform);
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a file path for the target platform:
 *   - Runs path.normalize (collapses .. and .)
 *   - On Windows: converts forward slashes to backslashes
 *   - On Unix: converts backslashes to forward slashes
 *
 * Useful when comparing user-provided paths that may contain mixed separators
 * (e.g. "D:\project/foo/bar").
 */
export function normalizePath(
  p: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return sdkNormalizePath(p, platform as PlatformName);
}

/**
 * Convert a path to forward-slash form for cross-platform comparison.
 * Useful when comparing paths from different OS representations
 * (e.g. git worktree list output on Windows vs stored paths).
 */
export function toForwardSlash(p: string): string {
  return sdkToForwardSlash(p);
}

// ---------------------------------------------------------------------------
// Command quoting (Windows cmd.exe)
// ---------------------------------------------------------------------------

/**
 * Quote/escape a single argument for use inside a `cmd.exe /c` command line.
 *
 * Rules:
 *   - Flatten newlines (CR/LF → space) — CreateProcess does not accept them.
 *   - Double `"` as required by cmd.exe escaping (`""` inside a quoted arg).
 *   - Wrap in `"…"` when the argument contains whitespace or shell meta-chars.
 *   - Empty string → `""`.
 */
export function quoteForCmd(arg: string): string {
  return sdkQuoteForCmd(arg);
}

// ---------------------------------------------------------------------------
// Environment utilities
// ---------------------------------------------------------------------------

/** Default PATH values for service-launched processes (prevents "command not found"). */
function defaultPathForPlatform(platform: NodeJS.Platform = process.platform): string {
  const runtimePlatform = platform as PlatformName;
  return defaultSupplementalPaths(runtimePlatform).join(isWindows(platform) ? ";" : ":");
}

/**
 * Ensure env has a usable PATH. macOS launchd services often inherit only
 * /usr/bin:/bin:/usr/sbin:/sbin, which hides user-installed CLIs such as
 * ~/.local/bin/claude. Preserve the caller's PATH, then append missing common
 * locations without imposing proxy or company-specific routing behavior.
 * Returns a new object — never mutates the input.
 */
export function ensurePathInEnv(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string | undefined> {
  const runtimePlatform = platform as PlatformName;
  return mergePathEnvironment(
    env,
    defaultPathForPlatform(platform).split(isWindows(platform) ? ";" : ":"),
    runtimePlatform,
  );
}

/**
 * Claude Code nesting prevention — strip env vars that block launching
 * a new Claude CLI instance from within an existing Claude session.
 * Returns a new object.
 */
const CLAUDE_NESTING_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION",
  "CLAUDE_CODE_PARENT_SESSION",
];

export function stripClaudeNestingEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const cleaned = { ...env };
  for (const key of CLAUDE_NESTING_VARS) {
    delete cleaned[key];
  }
  return cleaned;
}

/**
 * Tower's own data-root config — must never be inherited by child processes.
 * Otherwise a PTY (and the MCP servers its CLI spawns) picks up the server's
 * TOWER_DATA_DIR and overrides whatever the MCP registry pinned, so a dev MCP
 * writes the prod DB. Registered MCP servers pin both keys themselves.
 * Returns a new object.
 */
const TOWER_RUNTIME_VARS = ["TOWER_DATA_DIR", "DATABASE_URL"];

export function stripTowerRuntimeEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const cleaned = { ...env };
  for (const key of TOWER_RUNTIME_VARS) {
    delete cleaned[key];
  }
  return cleaned;
}

/**
 * Redact sensitive values from an env object for safe logging.
 * Matches keys containing: key, token, secret, password, authorization, cookie.
 */
export function redactEnvForLogs(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const defined = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return redactSensitiveRecord(defined) as Record<string, string>;
}

// ---------------------------------------------------------------------------
// Command resolution
// ---------------------------------------------------------------------------

/**
 * Async command resolution — walks PATH directories and probes file existence.
 * Suitable for child_process.spawn callers that can afford a few fs.access calls.
 *
 * @returns Absolute path to the executable, or `null` if not found.
 */
export async function resolveCommandPath(
  command: string,
  opts: ResolveCommandOptions = {},
): Promise<string | null> {
  return findCommandPath(command, {
    ...opts,
    platform: (opts.platform ?? process.platform) as PlatformName,
  });
}

/** Function signature for the shell exec used by resolveCommandPathSync (injectable for tests). */
export type ExecSyncFn = LegacyCommandLookup;

/**
 * Sync command resolution scans PATH directly without invoking a shell.
 * Suitable for node-pty callers that need a synchronous result.
 *
 * On Windows, prefers .cmd/.bat/.exe over extension-less shims.
 *
 * @param command  - The command name (e.g. "claude")
 * @param platform - Override for testing
 * @param exec     - Override shell exec for testing
 * @returns Resolved path, or the original command if resolution fails.
 */
export function resolveCommandPathSync(
  command: string,
  platform: NodeJS.Platform = process.platform,
  exec?: ExecSyncFn,
): string {
  return findCommandPathSync(command, platform as PlatformName, exec);
}

/**
 * Resolve a Claude CLI command into a path that `@anthropic-ai/claude-agent-sdk`
 * can spawn directly.
 *
 * The SDK treats any `pathToClaudeCodeExecutable` that does NOT end in a JS
 * extension (.js/.mjs/.cjs/...) as a native binary and spawns it directly with
 * no shell. On Windows the resolved `claude` command is usually an npm `.cmd`
 * shim, and spawning a `.cmd` without a shell throws EINVAL on modern Node —
 * which is why the assistant (SDK path) fails while task terminals (PTY path,
 * wrapped via `wrapForPlatform`) work.
 *
 * When we detect a Windows `.cmd`/`.bat` shim, parse it to recover the real
 * target and return that: a `cli.js` entry (classic npm install → the SDK runs
 * `node cli.js`) or a native `bin\claude.exe` entry (the newer native install →
 * the SDK spawns the .exe directly, no EINVAL). Non-Windows platforms and inputs
 * that aren't a .cmd/.bat are returned unchanged.
 */
export function resolveSdkExecutable(
  command: string,
  platform: NodeJS.Platform = process.platform,
  readFile: (p: string) => string = (p) => readFileSync(p, "utf-8"),
  fileExists: (p: string) => boolean = (p) => existsSync(p),
): string {
  if (!isWindows(platform)) return command;

  // Only .cmd/.bat shims are the problem — the SDK spawns the path directly and
  // Node rejects spawning a .cmd without a shell (EINVAL). .exe / extensionless
  // paths are returned untouched.
  const ext = path.extname(command).toLowerCase();
  if (ext !== ".cmd" && ext !== ".bat") return command;

  const dir = path.win32.dirname(command);
  let shimSnippet = "";

  // Expand the shim's %dp0%/%~dp0% (its own dir) and resolve to absolute.
  const expand = (raw: string): string => {
    const p = raw.replace(/%~?dp0%/gi, dir).replace(/\//g, "\\");
    return path.win32.isAbsolute(p) ? path.win32.normalize(p) : path.win32.resolve(dir, p);
  };

  // (1) Parse the shim for the entry it actually launches.
  try {
    const shim = readFile(command);
    shimSnippet = shim.replace(/\s+/g, " ").slice(0, 400);

    // (1a) Prefer a JS entry — the classic npm cmd-shim runs `node …\cli.js`.
    //      Returning the .js makes the SDK run `node cli.js`.
    //      e.g. "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js"
    const jsMatch = shim.match(/"([^"]*\.(?:c?js|mjs))"/i);
    if (jsMatch) {
      const resolved = expand(jsMatch[1]);
      if (fileExists(resolved)) return resolved;
      console.error(`[resolveSdkExecutable] parsed cli="${resolved}" but it doesn't exist`);
    }

    // (1b) Otherwise a native .exe entry — the newer native install ships a
    //      `bin\claude.exe` and the .cmd just execs it. The SDK spawns a real
    //      .exe directly (no EINVAL). Skip node.exe: in the JS-shim variant that
    //      is the runtime used to launch cli.js, not the CLI itself.
    for (const m of shim.matchAll(/"([^"]*\.exe)"/gi)) {
      const resolved = expand(m[1]);
      if (path.win32.basename(resolved).toLowerCase() === "node.exe") continue;
      if (fileExists(resolved)) return resolved;
    }
  } catch (e) {
    console.error(`[resolveSdkExecutable] shim read failed: ${e instanceof Error ? e.message : e}`);
  }

  // (2) Conventional layouts the parse may miss — cli.js (npm) or the native
  //     bin\<name>.exe — under the shim dir's claude-code package.
  const pkgDir = path.win32.join(dir, "node_modules", "@anthropic-ai", "claude-code");
  const base = path.win32.basename(command, path.win32.extname(command));
  const guesses = [
    path.win32.join(pkgDir, "cli.js"),
    path.win32.join(pkgDir, "bin", `${base}.exe`),
  ];
  for (const g of guesses) {
    if (fileExists(g)) return g;
  }

  // Nothing runnable found — return the original (the SDK will surface EINVAL).
  // Log the shim + candidates so the failure is diagnosable in one shot.
  console.error(
    `[resolveSdkExecutable] could not convert ${command} → guesses=${JSON.stringify(guesses)} shim="${shimSnippet}"`
  );
  return command;
}

// ---------------------------------------------------------------------------
// Spawn target resolution
// ---------------------------------------------------------------------------

/**
 * Async spawn target — resolves command + wraps .cmd/.bat for Windows.
 * Use with child_process.spawn.
 */
export async function resolveSpawnTarget(
  command: string,
  args: string[],
  opts: ResolveCommandOptions = {},
): Promise<SpawnTarget> {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;

  const resolved = await resolveCommandPath(command, opts);
  const executable = resolved ?? command;

  return prepareSpawnTarget(executable, args, platform as PlatformName, env);
}

/**
 * Sync spawn target — resolves command + wraps .cmd/.bat for Windows.
 * Use with node-pty.
 */
export function resolveSpawnTargetSync(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  exec?: ExecSyncFn,
): SpawnTarget {
  const resolved = resolveCommandPathSync(command, platform, exec);
  return wrapForPlatform(resolved, args, process.env, platform);
}

/**
 * Wrap a full command line so it runs through a shell.
 *
 * node-pty's spawn execs the binary directly — it does NOT invoke a shell — so
 * a command line containing operators (`&&`, `||`, `;`, `|`, redirections,
 * globs) must be handed to `sh -c "…"` (Unix) or `cmd.exe /d /s /c "…"`
 * (Windows) for those operators to be interpreted instead of passed as literal
 * args.
 *
 * The working directory is supplied to `pty.spawn` separately, so a leading
 * `cd ./sub` inside `commandLine` is resolved relative to that cwd (i.e. the
 * project/worktree root the preview spawns in).
 */
export function wrapShellCommand(
  commandLine: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): SpawnTarget {
  if (isWindows(platform)) {
    const shell = env.ComSpec || "cmd.exe";
    return { command: shell, args: ["/d", "/s", "/c", commandLine] };
  }
  // /bin/sh guarantees POSIX `&&`/`||`/`;` parsing regardless of the user's
  // login shell. `-c` runs non-interactively without sourcing rc files.
  return { command: "/bin/sh", args: ["-c", commandLine] };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Wrap a resolved executable for the target platform's shell if needed. */
function wrapForPlatform(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): SpawnTarget {
  if (!isWindows(platform)) {
    return { command: executable, args };
  }

  const ext = path.extname(executable).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    const directExecutable = resolveSdkExecutable(executable, platform);
    if (directExecutable !== executable) {
      const directExt = path.extname(directExecutable).toLowerCase();
      if (directExt === ".js" || directExt === ".cjs" || directExt === ".mjs") {
        return { command: process.execPath, args: [directExecutable, ...args] };
      }
      return { command: directExecutable, args };
    }
  }

  if (ext === ".cmd" || ext === ".bat" || ext === ".com") {
    const shell = env.ComSpec || "cmd.exe";
    const commandLine = [quoteForCmd(executable), ...args.map(quoteForCmd)].join(" ");
    return {
      command: shell,
      args: ["/d", "/s", "/c", commandLine],
    };
  }

  return { command: executable, args };
}

export {
  KNOWN_EDITORS,
  detectEditors,
  detectShells,
  detectTerminalApps,
  resolveEditorBinary,
  type DetectedEditor,
  type DetectedShell,
  type DetectedTerminalApp,
} from "@tower/ai-runtime";
