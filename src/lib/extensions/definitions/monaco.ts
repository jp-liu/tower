import { FileCode } from "lucide-react";
import { execFile } from "child_process";
import { promisify } from "util";
import { cpSync, existsSync, readFileSync, rmSync } from "fs";
import path from "path";
import type { Extension, ExtensionStatus, ExtensionResult } from "../types";

const execFileAsync = promisify(execFile);

const MONACO_PKG = path.join(process.cwd(), "node_modules", "monaco-editor", "package.json");
const MONACO_VS_SRC = path.join(process.cwd(), "node_modules", "monaco-editor", "min", "vs");
const PUBLIC_VS_LOADER = path.join(process.cwd(), "public", "vs", "loader.js");
const PUBLIC_VS = path.join(process.cwd(), "public", "vs");

/** Copy monaco-editor/min/vs → public/vs so the editor loads locally without CDN. */
function copyAssetsToPublic(): void {
  if (!existsSync(MONACO_VS_SRC)) {
    throw new Error("monaco-editor/min/vs not found after install — pnpm add may have failed silently");
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
    await execFileAsync("pnpm", ["add", "monaco-editor"], { timeout: 180_000 });
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
    await execFileAsync("pnpm", ["remove", "monaco-editor"], { timeout: 60_000 });
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
