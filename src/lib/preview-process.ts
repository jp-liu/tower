import { type ChildProcess } from "node:child_process";

// Module-level singleton — persists across requests in the same Node.js process
const previewProcesses = new Map<string, ChildProcess>();

export function registerPreviewProcess(taskId: string, child: ChildProcess): void {
  // Clean up stale entry if exists
  killPreviewProcess(taskId);
  // Auto-remove from map when process exits
  child.on("exit", () => {
    if (previewProcesses.get(taskId) === child) {
      previewProcesses.delete(taskId);
    }
  });
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

export function killAllPreviewProcesses(): void {
  for (const taskId of [...previewProcesses.keys()]) {
    killPreviewProcess(taskId);
  }
}

export function isPreviewRunning(taskId: string): boolean {
  const child = previewProcesses.get(taskId);
  return !!child && !child.killed;
}

// Cleanup on process exit
process.on("SIGTERM", () => killAllPreviewProcesses());
process.on("SIGINT", () => killAllPreviewProcesses());
