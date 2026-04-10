import { type ChildProcess } from "node:child_process";

// Module-level singleton — persists across requests in the same Node.js process
const previewProcesses = new Map<string, ChildProcess>();

export function registerPreviewProcess(taskId: string, child: ChildProcess): void {
  previewProcesses.set(taskId, child);
}

export function killPreviewProcess(taskId: string): boolean {
  const child = previewProcesses.get(taskId);
  if (!child) return false;
  previewProcesses.delete(taskId);
  if (child.killed) return false;
  child.kill("SIGTERM");
  return true;
}

export function isPreviewRunning(taskId: string): boolean {
  const child = previewProcesses.get(taskId);
  return !!child && !child.killed;
}
