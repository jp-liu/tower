import { FileCode } from "lucide-react";
import { execFile } from "child_process";
import { promisify } from "util";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { getExtensionsDir } from "@/lib/tower-dir";
import type { Extension, ExtensionStatus, ExtensionResult } from "../types";

const execFileAsync = promisify(execFile);

// `~/.tower/extensions/` is where we npm-install optional extension deps —
// the global Tower package's own node_modules is system-managed and writes
// there fail or get hoisted unpredictably across platforms.
const EXT_ROOT = getExtensionsDir();
const MONACO_PKG = path.join(EXT_ROOT, "node_modules", "monaco-editor", "package.json");
const MONACO_VS_SRC = path.join(EXT_ROOT, "node_modules", "monaco-editor", "min", "vs");
// `public/vs/` must live under whatever Next.js treats as the public dir at
// runtime — `process.cwd()` for both dev (repo root) and prod (the standalone
// dir we chdir into in `bin/tower.mjs`).
const PUBLIC_VS = path.join(process.cwd(), "public", "vs");
const PUBLIC_VS_LOADER = path.join(PUBLIC_VS, "loader.js");

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

/** Copy monaco-editor/min/vs → public/vs so the editor loads locally without CDN. */
function copyAssetsToPublic(): void {
  if (!existsSync(MONACO_VS_SRC)) {
    throw new Error(
      `monaco-editor/min/vs not found at ${MONACO_VS_SRC} after install — npm install may have failed silently`,
    );
  }
  cpSync(MONACO_VS_SRC, PUBLIC_VS, { recursive: true });
}

async function check(): Promise<ExtensionStatus> {
  const pkgExists = existsSync(MONACO_PKG);
  const loaderExists = existsSync(PUBLIC_VS_LOADER);

  if (!pkgExists || !loaderExists) {
    return { installed: false };
  }

  let version: string | undefined;
  try {
    const pkgJson = readFileSync(MONACO_PKG, "utf-8");
    const parsed = JSON.parse(pkgJson) as { version?: string };
    version = parsed.version;
  } catch {
    // Best-effort version extraction
  }

  return { installed: true, path: PUBLIC_VS, version };
}

async function install(): Promise<ExtensionResult> {
  try {
    ensureExtensionWorkspace();
    await execFileAsync("npm", ["install", "monaco-editor"], npmOpts(180_000));
    copyAssetsToPublic();
    return { success: true, message: "Installed Monaco editor + assets" };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function uninstall(): Promise<ExtensionResult> {
  try {
    if (existsSync(PUBLIC_VS)) {
      rmSync(PUBLIC_VS, { recursive: true, force: true });
    }
    ensureExtensionWorkspace();
    await execFileAsync("npm", ["uninstall", "monaco-editor"], npmOpts(60_000));
    return { success: true, message: "Removed Monaco editor + assets" };
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
