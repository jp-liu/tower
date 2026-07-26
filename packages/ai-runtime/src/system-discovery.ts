import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import type { PlatformName } from "@tower-org/ai-sdk";
import { isWindows } from "@tower-org/ai-sdk";
import {
  findCommandPath,
  type FindCommandPathOptions,
  type RuntimeEnvironment,
} from "./paths.js";

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
  platform: PlatformName = process.platform as PlatformName,
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
  const gitPath = await findCommandPath("git", { platform: "win32" });
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
  const pwshPath = await findCommandPath("pwsh", { platform: "win32" });
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
  platform: PlatformName = process.platform as PlatformName,
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
    const wtPath = await findCommandPath("wt", { platform });
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
const EDITOR_FALLBACK_PATHS: Record<string, Partial<Record<PlatformName, string[]>>> = {
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
function expandWindowsEnv(p: string, env: RuntimeEnvironment): string {
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
  opts: FindCommandPathOptions = {},
): Promise<string | null> {
  const platform = opts.platform ?? process.platform as PlatformName;
  const env = opts.env ?? process.env;

  const onPath = await findCommandPath(command, opts);
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
  platform: PlatformName = process.platform as PlatformName,
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

async function pathExists(
  candidate: string,
  platform: PlatformName = process.platform as PlatformName,
): Promise<boolean> {
  try {
    await fs.access(candidate, isWindows(platform) ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
