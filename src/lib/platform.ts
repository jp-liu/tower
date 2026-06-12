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

import { constants as fsConstants, promises as fs, readFileSync, existsSync } from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import path from "node:path";

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
  return platform === "win32";
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
  const normalized = path.normalize(p);
  if (isWindows(platform)) {
    return normalized.replace(/\//g, "\\");
  }
  return normalized.replace(/\\/g, "/");
}

/**
 * Convert a path to forward-slash form for cross-platform comparison.
 * Useful when comparing paths from different OS representations
 * (e.g. git worktree list output on Windows vs stored paths).
 */
export function toForwardSlash(p: string): string {
  return p.replace(/\\/g, "/");
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
  const flat = arg.replace(/\r\n|\r|\n/g, " ");
  if (!flat.length) return '""';
  const escaped = flat.replace(/"/g, '""');
  return /[\s"&<>|^()]/.test(escaped) ? `"${escaped}"` : escaped;
}

// ---------------------------------------------------------------------------
// Environment utilities
// ---------------------------------------------------------------------------

/** Default PATH values when the env has none (prevents "command not found"). */
function defaultPathForPlatform(platform: NodeJS.Platform = process.platform): string {
  if (isWindows(platform)) {
    return "C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem";
  }
  return "/usr/local/bin:/opt/homebrew/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin";
}

/**
 * Ensure env has a non-empty PATH. If missing/empty, merges sensible defaults.
 * Returns a new object — never mutates the input.
 */
export function ensurePathInEnv(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string | undefined> {
  const key = isWindows(platform) ? "Path" : "PATH";
  const current = env.PATH ?? env.Path ?? "";
  if (current.length > 0) return env;
  return { ...env, [key]: defaultPathForPlatform(platform) };
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
 * Redact sensitive values from an env object for safe logging.
 * Matches keys containing: key, token, secret, password, authorization, cookie.
 */
const SENSITIVE_KEY_RE = /key|token|secret|password|passwd|authorization|cookie/i;

export function redactEnvForLogs(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    result[k] = SENSITIVE_KEY_RE.test(k) ? "***REDACTED***" : v;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Command resolution
// ---------------------------------------------------------------------------

/** Windows PATHEXT extensions, parsed from environment or sensible default. */
function windowsPathExts(env: NodeJS.ProcessEnv): string[] {
  return (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean);
}

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
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;

  const hasPathSeparator = command.includes("/") || command.includes("\\");
  if (hasPathSeparator) {
    const absolute = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    return (await pathExists(absolute, platform)) ? absolute : null;
  }

  const pathValue = env.PATH ?? env.Path ?? "";
  const delimiter = isWindows(platform) ? ";" : ":";
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const exts = isWindows(platform) ? windowsPathExts(env) : [""];
  const hasExtension = isWindows(platform) && path.extname(command).length > 0;

  for (const dir of dirs) {
    const candidates = isWindows(platform)
      ? hasExtension
        ? [path.join(dir, command)]
        : exts.map((ext) => path.join(dir, `${command}${ext}`))
      : [path.join(dir, command)];

    for (const candidate of candidates) {
      if (await pathExists(candidate, platform)) return candidate;
    }
  }

  return null;
}

/** Function signature for the shell exec used by resolveCommandPathSync (injectable for tests). */
export type ExecSyncFn = (cmd: string) => string;

const defaultExecSync: ExecSyncFn = (cmd) =>
  // Suppress stderr: Windows `where` prints a localized "not found" line (GBK on
  // zh-CN, e.g. "信息: 用提供的模式无法找到文件。") to stderr when the command is
  // absent. With inherited stderr that leaks to the console as mojibake. The
  // not-found case is already handled via the thrown non-zero exit below.
  execSync(cmd, { encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });

/**
 * Sync command resolution — uses `where` (Windows) or `which` (Unix).
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
  exec: ExecSyncFn = defaultExecSync,
): string {
  // If it already has an extension or path separator, return as-is
  if (path.extname(command) || command.includes("/") || command.includes("\\")) {
    return command;
  }

  if (!isWindows(platform)) {
    // Resolve full path via `which` — node-pty's posix_spawnp may fail
    // when PATH differs between the shell and the spawned process
    // (e.g. global npm install vs interactive shell).
    try {
      const resolved = execFileSync("which", [command], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (resolved) return resolved;
    } catch {
      // which failed — fall through to return bare command
    }
    return command;
  }

  try {
    const result = exec(`where ${command}`);
    const foundPaths = result.trim().split("\n").map((p) => p.trim()).filter(Boolean);

    // Prefer .cmd/.bat/.exe over extension-less shims
    const withExt = foundPaths.find((p) => /\.(cmd|bat|exe)$/i.test(p));
    if (withExt) return withExt;
    if (foundPaths.length > 0) return foundPaths[0];
  } catch {
    // Command not found in PATH — return as-is, let caller handle
  }

  return command;
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

  return wrapForPlatform(executable, args, env, platform);
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

async function pathExists(
  candidate: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  try {
    await fs.access(candidate, isWindows(platform) ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shell detection (for PTY spawning, AI CLI testing)
// ---------------------------------------------------------------------------

export interface DetectedShell {
  /** Display name, e.g. "zsh", "Git Bash" */
  name: string;
  /** Absolute path to the shell binary */
  path: string;
}

/**
 * Detect available shells on the current platform.
 *
 * macOS/Linux: reads /etc/shells (same approach as VS Code).
 * Windows: probes well-known Git Bash / PowerShell / WSL paths
 *          (adapted from VS Code's terminal profile detection).
 */
export async function detectShells(
  platform: NodeJS.Platform = process.platform,
): Promise<DetectedShell[]> {
  if (!isWindows(platform)) {
    return detectUnixShells();
  }
  return detectWindowsShells();
}

/** Read /etc/shells — the OS-maintained list of valid login shells. */
async function detectUnixShells(): Promise<DetectedShell[]> {
  try {
    const content = await fs.readFile("/etc/shells", "utf-8");
    const shells: DetectedShell[] = [];
    const seen = new Map<string, number>();

    for (const raw of content.split("\n")) {
      const line = raw.replace(/#.*/, "").trim();
      if (!line || !line.startsWith("/")) continue;
      if (!(await pathExists(line))) continue;

      let name = path.basename(line);
      // Handle duplicate names (e.g. /bin/bash and /usr/local/bin/bash)
      const count = seen.get(name) ?? 0;
      seen.set(name, count + 1);
      if (count > 0) name = `${name} (${count + 1})`;

      shells.push({ name, path: line });
    }
    return shells;
  } catch {
    // /etc/shells not readable — return sensible defaults
    const defaults = ["/bin/zsh", "/bin/bash", "/bin/sh"];
    const shells: DetectedShell[] = [];
    for (const p of defaults) {
      if (await pathExists(p)) shells.push({ name: path.basename(p), path: p });
    }
    return shells;
  }
}

/** Probe well-known Windows shell locations (VS Code approach). */
async function detectWindowsShells(): Promise<DetectedShell[]> {
  const shells: DetectedShell[] = [];

  // --- Git Bash ---
  // Strategy: find git.exe on PATH → derive bash.exe path, then probe ProgramFiles
  const gitBashCandidates: string[] = [];

  // 1. From git.exe on PATH (most reliable)
  const gitPath = await resolveCommandPath("git", { platform: "win32" });
  if (gitPath) {
    const gitRoot = path.resolve(path.dirname(gitPath), "..", "..");
    gitBashCandidates.push(
      path.join(gitRoot, "bin", "bash.exe"),
      path.join(gitRoot, "usr", "bin", "bash.exe"),
    );
  }

  // 2. Standard install directories
  const programDirs = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LocalAppData ? path.join(process.env.LocalAppData, "Programs") : null,
  ].filter(Boolean) as string[];

  for (const dir of programDirs) {
    gitBashCandidates.push(
      path.join(dir, "Git", "bin", "bash.exe"),
      path.join(dir, "Git", "usr", "bin", "bash.exe"),
    );
  }

  // 3. Scoop
  const home = process.env.USERPROFILE ?? "";
  if (home) {
    gitBashCandidates.push(
      path.join(home, "scoop", "apps", "git", "current", "bin", "bash.exe"),
    );
  }

  // 4. CLAUDE_CODE_GIT_BASH_PATH env var
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH) {
    gitBashCandidates.unshift(process.env.CLAUDE_CODE_GIT_BASH_PATH);
  }

  for (const candidate of gitBashCandidates) {
    if (await pathExists(candidate, "win32")) {
      shells.push({ name: "Git Bash", path: candidate });
      break;
    }
  }

  // --- PowerShell Core (pwsh.exe) ---
  const pwshPath = await resolveCommandPath("pwsh", { platform: "win32" });
  if (pwshPath) {
    shells.push({ name: "PowerShell", path: pwshPath });
  }

  // --- Windows PowerShell (legacy) ---
  const winDir = process.env.windir ?? "C:\\WINDOWS";
  const legacyPs = path.join(winDir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (await pathExists(legacyPs, "win32")) {
    shells.push({ name: "Windows PowerShell", path: legacyPs });
  }

  // --- Command Prompt ---
  const cmd = process.env.ComSpec ?? path.join(winDir, "System32", "cmd.exe");
  if (await pathExists(cmd, "win32")) {
    shells.push({ name: "Command Prompt", path: cmd });
  }

  return shells;
}

// ---------------------------------------------------------------------------
// Terminal app detection (for "Open in Terminal" GUI action)
// ---------------------------------------------------------------------------

export interface DetectedTerminalApp {
  /** Display name, e.g. "iTerm2", "Windows Terminal" */
  name: string;
  /** Value for macOS `open -a` or Windows executable path */
  value: string;
  /** Whether the app is actually installed/detected on this system */
  installed: boolean;
}

/** Well-known macOS terminal GUI applications. */
const MAC_TERMINAL_APPS: Array<{ name: string; bundleName: string }> = [
  { name: "Terminal", bundleName: "Terminal" },
  { name: "iTerm2", bundleName: "iTerm" },
  { name: "Warp", bundleName: "Warp" },
  { name: "Alacritty", bundleName: "Alacritty" },
  { name: "WezTerm", bundleName: "WezTerm" },
  { name: "kitty", bundleName: "kitty" },
  { name: "Hyper", bundleName: "Hyper" },
];

/**
 * Detect available GUI terminal applications.
 * macOS: checks /Applications/*.app
 * Windows: checks for Windows Terminal (wt.exe) in PATH
 */
export async function detectTerminalApps(
  platform: NodeJS.Platform = process.platform,
): Promise<DetectedTerminalApp[]> {
  if (platform === "darwin") {
    // Return the FULL known list with an `installed` flag so the UI can show
    // every option and disable the ones that aren't installed.
    const results: DetectedTerminalApp[] = [];
    for (const t of MAC_TERMINAL_APPS) {
      const installed = await pathExists(`/Applications/${t.bundleName}.app`, platform);
      results.push({ name: t.name, value: t.bundleName, installed });
    }
    return results;
  }

  if (isWindows(platform)) {
    const results: DetectedTerminalApp[] = [];
    const wtPath = await resolveCommandPath("wt", { platform });
    if (wtPath) {
      results.push({ name: "Windows Terminal", value: wtPath, installed: true });
    }
    return results;
  }

  return [];
}

export interface DetectedEditor {
  /** Display name, e.g. "VS Code", "Cursor" */
  name: string;
  /** CLI command on PATH, e.g. "code", "cursor" — passed to openInEditor */
  command: string;
  /** Whether the command was found on PATH on this system */
  installed: boolean;
}

/**
 * Editor CLIs Tower knows how to launch, in preference order. Every `command`
 * MUST be present in ALLOWED_EDITOR_COMMANDS (open-targets.ts) — that list is
 * the spawn allowlist; this one adds display names + detection order. The
 * invariant is enforced by a unit test (open-targets.test.ts drift guard).
 *
 * GUI editors only: terminal editors (vim/nvim/emacs) need a TTY, so opening a
 * folder in them from a button can't work and would block the launcher.
 */
export const KNOWN_EDITORS: Array<{ name: string; command: string }> = [
  { name: "VS Code", command: "code" },
  { name: "VS Code Insiders", command: "code-insiders" },
  { name: "Cursor", command: "cursor" },
  { name: "Windsurf", command: "windsurf" },
  { name: "Zed", command: "zed" },
  { name: "Sublime Text", command: "subl" },
  { name: "IntelliJ IDEA", command: "idea" },
  { name: "WebStorm", command: "webstorm" },
  { name: "PyCharm", command: "pycharm" },
  { name: "GoLand", command: "goland" },
  { name: "RubyMine", command: "rubymine" },
  { name: "PhpStorm", command: "phpstorm" },
  { name: "CLion", command: "clion" },
  { name: "Rider", command: "rider" },
];

/**
 * Known non-PATH install locations per editor command, by platform. Used as a
 * fallback when the CLI isn't on PATH — many GUI editors install the .app /
 * .exe but never add their CLI shim to PATH (Sublime Text on macOS is the
 * classic case: the `subl` symlink must be created manually).
 *
 * macOS: the launcher binary inside the .app bundle (accepts a folder arg).
 * Windows: the default per-user / per-machine install paths. `%VAR%` tokens are
 * expanded from the environment. Paths the editor doesn't install to a stable
 * default (notably JetBrains on Windows, where Toolbox versions the directory)
 * are intentionally omitted — those still rely on PATH.
 */
const EDITOR_FALLBACK_PATHS: Record<string, Partial<Record<NodeJS.Platform, string[]>>> = {
  code: {
    darwin: ["/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"],
    win32: [
      "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\bin\\code.cmd",
      "%ProgramFiles%\\Microsoft VS Code\\bin\\code.cmd",
    ],
  },
  "code-insiders": {
    darwin: ["/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders"],
    win32: [
      "%LOCALAPPDATA%\\Programs\\Microsoft VS Code Insiders\\bin\\code-insiders.cmd",
      "%ProgramFiles%\\Microsoft VS Code Insiders\\bin\\code-insiders.cmd",
    ],
  },
  cursor: {
    darwin: ["/Applications/Cursor.app/Contents/Resources/app/bin/cursor"],
    win32: ["%LOCALAPPDATA%\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd"],
  },
  windsurf: {
    darwin: ["/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf"],
    win32: ["%LOCALAPPDATA%\\Programs\\Windsurf\\bin\\windsurf.cmd"],
  },
  zed: {
    darwin: ["/Applications/Zed.app/Contents/MacOS/cli"],
  },
  subl: {
    darwin: ["/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl"],
    win32: [
      "%ProgramFiles%\\Sublime Text\\subl.exe",
      "%ProgramFiles%\\Sublime Text 3\\subl.exe",
    ],
  },
  idea: {
    darwin: [
      "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea",
      "/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea",
    ],
  },
  webstorm: { darwin: ["/Applications/WebStorm.app/Contents/MacOS/webstorm"] },
  pycharm: {
    darwin: [
      "/Applications/PyCharm.app/Contents/MacOS/pycharm",
      "/Applications/PyCharm CE.app/Contents/MacOS/pycharm",
    ],
  },
  goland: { darwin: ["/Applications/GoLand.app/Contents/MacOS/goland"] },
  rubymine: { darwin: ["/Applications/RubyMine.app/Contents/MacOS/rubymine"] },
  phpstorm: { darwin: ["/Applications/PhpStorm.app/Contents/MacOS/phpstorm"] },
  clion: { darwin: ["/Applications/CLion.app/Contents/MacOS/clion"] },
  rider: { darwin: ["/Applications/Rider.app/Contents/MacOS/rider"] },
};

/** Expand `%VAR%` tokens in a Windows path from the given environment. */
function expandWindowsEnv(p: string, env: NodeJS.ProcessEnv): string {
  return p.replace(/%([^%]+)%/g, (whole, name: string) => {
    const direct = env[name];
    if (direct !== undefined) return direct;
    // Windows env keys are case-insensitive; fall back to a case-folded lookup.
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? env[key] ?? whole : whole;
  });
}

/**
 * Resolve an editor command to an absolute binary path. Tries PATH first, then
 * the known platform-specific install locations (EDITOR_FALLBACK_PATHS) so an
 * editor whose CLI shim isn't on PATH is still detected and launchable.
 * Returns null when neither the PATH probe nor any fallback path exists.
 */
export async function resolveEditorBinary(
  command: string,
  opts: ResolveCommandOptions = {},
): Promise<string | null> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;

  const onPath = await resolveCommandPath(command, opts);
  if (onPath) return onPath;

  const candidates = EDITOR_FALLBACK_PATHS[command]?.[platform] ?? [];
  for (const raw of candidates) {
    const candidate = isWindows(platform) ? expandWindowsEnv(raw, env) : raw;
    if (await pathExists(candidate, platform)) return candidate;
  }
  return null;
}

/**
 * Detect installed editors. Probes PATH for each known command, then falls back
 * to known install locations (EDITOR_FALLBACK_PATHS) so GUI editors whose CLI
 * isn't on PATH still show as installed. Returns them in KNOWN_EDITORS order so
 * the first hit is a sensible default.
 */
export async function detectEditors(
  platform: NodeJS.Platform = process.platform,
): Promise<DetectedEditor[]> {
  // Return the FULL known list with an `installed` flag so the UI can show
  // every editor and disable the ones that aren't found.
  const results: DetectedEditor[] = [];
  for (const e of KNOWN_EDITORS) {
    const installed = !!(await resolveEditorBinary(e.command, { platform }));
    results.push({ name: e.name, command: e.command, installed });
  }
  return results;
}
