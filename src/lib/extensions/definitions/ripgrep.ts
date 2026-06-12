import { Search } from "lucide-react";
import { execFile, execFileSync } from "child_process";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import type { Extension, ExtensionStatus, ExtensionResult } from "../types";
import { resolveBundledRgPath } from "../rg-resolve";
import { isWindows } from "@/lib/platform";

/**
 * ripgrep is a Rust binary. We bundle it via `@vscode/ripgrep`, whose
 * per-platform binary ships as an npm optionalDependency — so it installs
 * from the configured registry (CN mirror-friendly) without hitting GitHub
 * and code search works out of the box. We still fall back to a system `rg`
 * on PATH (and known install locations), and if neither is present the
 * Settings UI surfaces install commands the user can copy.
 */

function execFileP(
  cmd: string,
  args: string[],
  opts: { timeout: number },
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout ?? "") });
    });
  });
}

async function runVersion(rgPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP(rgPath, ["--version"], { timeout: 3000 });
    // First line looks like `ripgrep 14.1.1 (rev abc1234)`
    return stdout.split("\n")[0]?.replace(/^ripgrep\s+/, "").split(" ")[0] || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Common install locations to fall back to when `which/where rg` comes up
 * empty. Tower processes can have a different PATH than the user's
 * interactive shell — most often when:
 *   - Tower was started before brew/winget put rg on PATH (env snapshot
 *     captured at launch doesn't pick up subsequent shell-config changes)
 *   - On macOS, brew on Apple Silicon installs into /opt/homebrew/bin/
 *     which only lands in PATH after .zshrc sources its eval line. A
 *     tower binary launched outside that shell won't see it.
 *
 * If the binary exists at any of these known paths we accept it even
 * though `which` said no — the file is right there.
 */
function getKnownInstallPaths(): string[] {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return [
        "/opt/homebrew/bin/rg",   // Apple Silicon brew
        "/usr/local/bin/rg",      // Intel brew
        "/opt/local/bin/rg",      // MacPorts
        path.join(home, ".cargo/bin/rg"),
      ];
    case "linux":
      return [
        "/usr/bin/rg",
        "/usr/local/bin/rg",
        "/snap/bin/rg",
        path.join(home, ".local/bin/rg"),
        path.join(home, ".cargo/bin/rg"),
      ];
    case "win32": {
      const localApp = process.env["LOCALAPPDATA"] ?? "";
      const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
      const userProfile = process.env["USERPROFILE"] ?? home;
      return [
        path.join(localApp, "Microsoft", "WinGet", "Links", "rg.exe"),
        path.join(userProfile, "scoop", "shims", "rg.exe"),
        path.join(localApp, "Programs", "scoop", "shims", "rg.exe"),
        "C:\\ProgramData\\chocolatey\\bin\\rg.exe",
        path.join(programFiles, "ripgrep", "rg.exe"),
      ];
    }
    default:
      return [];
  }
}

/** Resolve `rg`: PATH first, then known install locations. */
function detectSystemBinary(): string | null {
  // isWindows() (cross-module call), NOT inline `process.platform === "win32"`:
  // the inline form gets const-folded to the build OS by Turbopack, collapsing
  // this to "which" only and breaking rg detection on Windows.
  const finder = isWindows() ? "where" : "which";
  try {
    const stdout = execFileSync(finder, ["rg"], { encoding: "utf-8", timeout: 3000 });
    const firstLine = stdout.split(/\r?\n/)[0]?.trim();
    if (firstLine && existsSync(firstLine)) return firstLine;
  } catch {
    // not on PATH — try known locations next
  }
  for (const candidate of getKnownInstallPaths()) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function check(): Promise<ExtensionStatus> {
  // Prefer the bundled @vscode/ripgrep binary, then a system install.
  const bundled = await resolveBundledRgPath();
  if (bundled) {
    const version = await runVersion(bundled);
    return { installed: true, path: bundled, version };
  }
  const systemPath = detectSystemBinary();
  if (systemPath) {
    const version = await runVersion(systemPath);
    return { installed: true, path: systemPath, version };
  }
  return { installed: false };
}

/**
 * We don't auto-install ripgrep. The button instead returns a structured
 * message that the Settings UI surfaces as platform-specific install
 * commands plus the homepage link. See `extension-card.tsx` for the
 * fallback rendering.
 */
async function install(): Promise<ExtensionResult> {
  return {
    success: false,
    error: "ripgrep is a native binary and must be installed via your OS package manager. " +
      "See the install commands below or open the official site.",
  };
}

export const ripgrepExtension: Extension = {
  id: "rg",
  name: "代码搜索 (ripgrep)",
  description: "基于 rg 的全文代码搜索",
  icon: Search,
  sizeMB: 5,
  homepageUrl: "https://github.com/BurntSushi/ripgrep#installation",
  manualInstall: true,
  check,
  install,
};
