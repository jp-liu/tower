import { FileCode } from "lucide-react";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { getExtensionsDir } from "@/lib/tower-dir";
import type { Extension, ExtensionStatus, ExtensionResult } from "../types";

const execFileAsync = promisify(execFile);

// `~/.tower/extensions/` is where we npm-install optional extension deps —
// the global Tower package's own node_modules is system-managed and writes
// there fail or get hoisted unpredictably across platforms.
const EXT_ROOT = getExtensionsDir();
const MONACO_PKG = path.join(EXT_ROOT, "node_modules", "monaco-editor", "package.json");
const MONACO_VS_LOADER = path.join(
  EXT_ROOT, "node_modules", "monaco-editor", "min", "vs", "loader.js",
);

/** Ensure `~/.tower/extensions/` has a package.json so `npm install` knows
 *  to drop deps into a sibling `node_modules/`. */
function ensureExtensionWorkspace(): void {
  const pkgJson = path.join(EXT_ROOT, "package.json");
  if (!existsSync(pkgJson)) {
    mkdirSync(EXT_ROOT, { recursive: true });
    writeFileSync(
      pkgJson,
      JSON.stringify({ name: "tower-extensions", version: "1.0.0", private: true }, null, 2),
    );
  }
}

/** npm options: install from the extensions workspace (not the global Tower
 *  package), and on Windows use shell:true so `npm.cmd` resolves (Node has
 *  refused to execFile `.cmd` directly since CVE-2024-27980). */
function npmOpts(timeout: number) {
  return {
    timeout,
    cwd: EXT_ROOT,
    shell: process.platform === "win32",
  };
}

async function check(): Promise<ExtensionStatus> {
  // `/api/internal/monaco/[...]` serves directly from this node_modules path —
  // no public/ copy needed. Existence of the on-disk loader.js is sufficient.
  if (!existsSync(MONACO_PKG) || !existsSync(MONACO_VS_LOADER)) {
    return { installed: false };
  }

  let version: string | undefined;
  try {
    const parsed = JSON.parse(readFileSync(MONACO_PKG, "utf-8")) as { version?: string };
    version = parsed.version;
  } catch {
    // Best-effort version extraction
  }

  return { installed: true, path: path.dirname(MONACO_VS_LOADER), version };
}

async function install(): Promise<ExtensionResult> {
  try {
    ensureExtensionWorkspace();
    // `--prefix=EXT_ROOT` forces npm to install into our workspace and ignore
    // any user-level `~/.npmrc prefix=` override that would otherwise hoist
    // the install to a global location and leave EXT_ROOT empty.
    // `--no-audit --no-fund` keep stdout clean so error.message stays useful.
    const { stdout, stderr } = await execFileAsync(
      "npm",
      ["install", "--prefix", EXT_ROOT, "--no-audit", "--no-fund", "monaco-editor"],
      npmOpts(180_000),
    );
    if (!existsSync(MONACO_PKG)) {
      throw new Error(
        `npm install reported success but ${MONACO_PKG} doesn't exist. ` +
        `Check your ~/.npmrc for a prefix= override. ` +
        `stdout: ${(stdout || "").slice(0, 400)} stderr: ${(stderr || "").slice(0, 400)}`,
      );
    }
    if (!existsSync(MONACO_VS_LOADER)) {
      throw new Error(
        `npm install completed but ${MONACO_VS_LOADER} doesn't exist — the monaco-editor package may be incomplete on this registry mirror.`,
      );
    }
    return { success: true, message: `Installed monaco-editor at ${path.dirname(MONACO_PKG)}` };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const parts: string[] = [e.message];
    if (e.stdout) parts.push(`stdout: ${String(e.stdout).slice(-400)}`);
    if (e.stderr) parts.push(`stderr: ${String(e.stderr).slice(-400)}`);
    return { success: false, error: parts.join(" | ") };
  }
}

async function uninstall(): Promise<ExtensionResult> {
  try {
    ensureExtensionWorkspace();
    await execFileAsync(
      "npm",
      ["uninstall", "--prefix", EXT_ROOT, "monaco-editor"],
      npmOpts(60_000),
    );
    return { success: true, message: "Removed monaco-editor" };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export const monacoExtension: Extension = {
  id: "monaco",
  name: "代码编辑器 (Monaco)",
  description: "VS Code 同款 Web 编辑器",
  icon: FileCode,
  sizeMB: 15,
  homepageUrl: "https://microsoft.github.io/monaco-editor/",
  check,
  install,
  uninstall,
};
