import type { ChildProcess } from "child_process";

const MAX_CONCURRENT = 3;
const runningProcesses = new Map<string, ChildProcess>();

export function registerProcess(executionId: string, proc: ChildProcess): void {
  runningProcesses.set(executionId, proc);
  proc.on("exit", () => runningProcesses.delete(executionId));
}

export function killProcess(executionId: string): boolean {
  const proc = runningProcesses.get(executionId);
  if (proc && !proc.killed) {
    proc.kill("SIGTERM");
    runningProcesses.delete(executionId);
    return true;
  }
  return false;
}

export function getRunningCount(): number {
  return runningProcesses.size;
}

export function canStartExecution(): boolean {
  return runningProcesses.size < MAX_CONCURRENT;
}

export function isRunning(executionId: string): boolean {
  return runningProcesses.has(executionId);
}
