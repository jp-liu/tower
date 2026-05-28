import { Search } from "lucide-react";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { getPackageRoot } from "@/lib/tower-paths";
import type { Extension, ExtensionStatus, ExtensionResult } from "../types";

/** Promisify wrapper that always calls through the live execFile reference */
function execFileP(
  cmd: string,
  args: string[],
  opts: { timeout: number; cwd?: string; shell?: boolean }
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout) => {
      if (err) reject(err);
      else resolve({ stdout: stdout as string });
    });
  });
}

/** npm options: run from package root so deps land in the right node_modules,
 *  and on Windows use shell:true so `npm.cmd` resolves (Node refuses to
 *  execFile `.cmd` shims since CVE-2024-27980). */
function npmOpts(timeout: number) {
  return {
    timeout,
    cwd: getPackageRoot(),
    shell: process.platform === "win32",
  };
}

async function runVersion(rgPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileP(rgPath, ["--version"], { timeout: 3000 });
    // Output: "ripgrep 14.1.1 ..."
    return stdout.split("\n")[0]?.replace(/^ripgrep\s+/, "").split(" ")[0] || undefined;
  } catch {
    return undefined;
  }
}

async function detectPackageBinary(): Promise<string | null> {
  try {
    const mod = await import("@vscode/ripgrep");
    const rgPath = (mod as { rgPath?: string }).rgPath;
    if (!rgPath) return null;
    // The package may be installed but its postinstall (binary download) failed.
    // Verify the binary file actually exists before reporting installed.
    if (!existsSync(rgPath)) return null;
    return rgPath;
  } catch {
    return null;
  }
}

async function detectSystemBinary(): Promise<string | null> {
  try {
    const { stdout } = await execFileP("which", ["rg"], { timeout: 3000 });
    const path = stdout.trim();
    if (!path || !existsSync(path)) return null;
    return path;
  } catch {
    return null;
  }
}

async function check(): Promise<ExtensionStatus> {
  // Dual-track: package binary first, then system PATH
  const packagePath = await detectPackageBinary();
  if (packagePath) {
    const version = await runVersion(packagePath);
    return { installed: true, path: packagePath, version };
  }
  const systemPath = await detectSystemBinary();
  if (systemPath) {
    const version = await runVersion(systemPath);
    return { installed: true, path: systemPath, version };
  }
  return { installed: false };
}

async function install(): Promise<ExtensionResult> {
  try {
    await execFileP("npm", ["install", "@vscode/ripgrep"], npmOpts(120_000));
    // Clear cached rg path so next searchCode call re-resolves.
    try {
      const { clearRgPathCache } = await import("@/actions/search-code-actions");
      await clearRgPathCache();
    } catch {
      // Best-effort — if module load fails, the cache will refresh at server restart.
    }
    // Verify the binary actually exists — npm install succeeds even if the
    // package's postinstall (binary download) fails silently.
    const verified = await detectPackageBinary();
    if (!verified) {
      return {
        success: false,
        error:
          "@vscode/ripgrep installed but the rg binary is missing — postinstall download likely failed. Check network access to GitHub releases (the package downloads its native binary on install).",
      };
    }
    return { success: true, message: "Installed @vscode/ripgrep" };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function uninstall(): Promise<ExtensionResult> {
  try {
    await execFileP("npm", ["uninstall", "@vscode/ripgrep"], npmOpts(60_000));
    // Clear cached rg path so next searchCode attempt detects absence.
    try {
      const { clearRgPathCache } = await import("@/actions/search-code-actions");
      await clearRgPathCache();
    } catch {
      // Best-effort
    }
    return { success: true, message: "Removed @vscode/ripgrep" };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export const ripgrepExtension: Extension = {
  id: "rg",
  name: "代码搜索 (ripgrep)",
  description: "基于 rg 的全文代码搜索",
  icon: Search,
  sizeMB: 5,
  homepageUrl: "https://github.com/BurntSushi/ripgrep#installation",
  check,
  install,
  uninstall,
};
