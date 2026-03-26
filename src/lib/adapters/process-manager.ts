import { runningProcesses } from "./process-utils";

const MAX_CONCURRENT = 3;

export function registerProcess(executionId: string, runId: string): void {
  // runChildProcess in process-utils stores processes by runId
  // We map executionId → runId so killProcess can find the right process
  executionToRunId.set(executionId, runId);
}

const executionToRunId = new Map<string, string>();

export function killProcess(executionId: string): boolean {
  const runId = executionToRunId.get(executionId);
  if (!runId) return false;

  const entry = runningProcesses.get(runId);
  if (entry && !entry.child.killed) {
    entry.child.kill("SIGTERM");
    runningProcesses.delete(runId);
    executionToRunId.delete(executionId);
    return true;
  }
  executionToRunId.delete(executionId);
  return false;
}

export function canStartExecution(): boolean {
  return runningProcesses.size < MAX_CONCURRENT;
}

export function getRunningCount(): number {
  return runningProcesses.size;
}

export function isRunning(executionId: string): boolean {
  const runId = executionToRunId.get(executionId);
  return runId ? runningProcesses.has(runId) : false;
}
