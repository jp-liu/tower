"use server";

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import {
  registerPreviewProcess,
  killPreviewProcess,
  isPreviewRunning,
} from "@/lib/adapters/preview-process-manager";
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
    const child = spawn(cmd, args, {
      cwd,
      shell: false,
      detached: false,
      stdio: "ignore",
    });
    child.unref();
    registerPreviewProcess(taskId, child);
    return { started: true };
  } catch (err) {
    return { started: false, error: String(err) };
  }
}

export async function stopPreview(taskId: string): Promise<void> {
  killPreviewProcess(taskId);
}

// macOS-only: uses built-in `open -a` command
// Uses execFileSync with args array — no shell interpolation (security constraint)
export async function openInTerminal(worktreePath: string): Promise<void> {
  const terminalApp = await readConfigValue<string>("terminal.app", "Terminal");
  execFileSync("open", ["-a", terminalApp, worktreePath]);
}
