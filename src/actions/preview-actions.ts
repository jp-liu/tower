"use server";

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  registerPreviewProcess,
  killPreviewProcess,
  isPreviewRunning,
} from "@/lib/preview-process";
import { readConfigValue } from "@/lib/config-reader";

export async function startPreview(
  taskId: string,
  command: string,
  cwd: string
): Promise<{ started: boolean; error?: string }> {
  if (isPreviewRunning(taskId)) {
    killPreviewProcess(taskId);
  }
  try {
    // Split command by whitespace into args — shell: false (security requirement)
    const parts = command.trim().split(/\s+/);
    const [cmd, ...args] = parts;
    console.log(`[preview] Starting: ${command} | cwd: ${cwd}`);
    const child = spawn(cmd, args, {
      cwd,
      shell: false,
      detached: false,
      stdio: "ignore",
    });
    registerPreviewProcess(taskId, child);
    return { started: true };
  } catch (err) {
    return { started: false, error: String(err) };
  }
}

export async function stopPreview(taskId: string): Promise<void> {
  killPreviewProcess(taskId);
}

/**
 * Detect the frontend framework from package.json in the given directory.
 * Returns "vite" | "next" | "nuxt" | "angular" | null
 */
export async function detectFramework(cwd: string): Promise<string | null> {
  try {
    const raw = readFileSync(join(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps["vite"] || allDeps["@vitejs/plugin-vue"] || allDeps["@vitejs/plugin-react"]) return "vite";
    if (allDeps["next"]) return "next";
    if (allDeps["nuxt"]) return "nuxt";
    if (allDeps["@angular/core"]) return "angular";
    return null;
  } catch {
    return null;
  }
}

// macOS-only: uses built-in `open -a` command
// Uses execFileSync with args array — no shell interpolation (security constraint)
export async function openInTerminal(worktreePath: string): Promise<void> {
  const terminalApp = await readConfigValue<string>("terminal.app", "Terminal");
  execFileSync("open", ["-a", terminalApp, worktreePath]);
}
