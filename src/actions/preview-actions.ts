"use server";

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
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
    // Removed console.log per coding standards — use structured logging if needed
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
const ALLOWED_TERMINAL_APPS = ["Terminal", "iTerm", "iTerm2", "Warp", "Hyper", "Alacritty", "WezTerm", "kitty"];

export async function openInTerminal(worktreePath: string): Promise<void> {
  if (!worktreePath || !isAbsolute(worktreePath)) {
    throw new Error("openInTerminal requires an absolute path");
  }
  const terminalApp = await readConfigValue<string>("terminal.app", "Terminal");
  if (!ALLOWED_TERMINAL_APPS.includes(terminalApp)) {
    throw new Error(`Terminal app '${terminalApp}' is not in the allowed list`);
  }
  execFileSync("open", ["-a", terminalApp, worktreePath]);
}
