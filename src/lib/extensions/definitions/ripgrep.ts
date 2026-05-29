import { Search } from "lucide-react";
import { execFile, execFileSync } from "child_process";
import { existsSync } from "fs";
import type { Extension, ExtensionStatus, ExtensionResult } from "../types";

/**
 * ripgrep is a Rust binary. Auto-downloading it cross-platform from inside
 * Tower is fragile (GitHub releases get rate-limited / blocked in CN, and
 * there's no reliable domestic mirror). We instead detect a pre-installed
 * `rg` on PATH and, if absent, surface a homepage link so the user can
 * install it via their OS package manager (brew / winget / apt / etc.).
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

/** Resolve `rg` on the user's PATH. Uses `which` on POSIX, `where` on Win. */
function detectSystemBinary(): string | null {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const stdout = execFileSync(finder, ["rg"], { encoding: "utf-8", timeout: 3000 });
    const firstLine = stdout.split(/\r?\n/)[0]?.trim();
    if (firstLine && existsSync(firstLine)) return firstLine;
  } catch {
    // not on PATH
  }
  return null;
}

async function check(): Promise<ExtensionStatus> {
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
