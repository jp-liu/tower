import { PtySession } from "./pty-session";
import { resolveSpawnTargetSync } from "@/lib/platform";
import { recordSessionPid, clearSessionPid } from "./orphan-reaper";
import { notifyPtySessionStarted } from "./lifecycle";

// D-04: globalThis singleton — survives HMR/module re-evaluation in Next.js dev mode.
// Without this, ws-server.ts (loaded once via instrumentation) and agent-actions.ts
// (re-bundled on HMR) would get different Map instances, causing sessions to be invisible
// to the WS server after creation.
const g = globalThis as typeof globalThis & { __ptySessions?: Map<string, PtySession> };
if (!g.__ptySessions) {
  g.__ptySessions = new Map<string, PtySession>();
}
const sessions = g.__ptySessions;

export function createSession(
  taskId: string,
  command: string,
  args: string[],
  cwd: string,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void,
  envOverrides?: Record<string, string>,
  onIdle?: () => void,
  idleThresholdMs?: number,
  initialInput?: string,
  baseEnvOverride?: Record<string, string>,
  startsAtInputBoundary = false,
  executionId?: string,
): PtySession {
  // Kill any existing session for this taskId before creating a new one. We do
  // NOT clear its pid file here — recordSessionPid below overwrites it, which
  // avoids a clear/record race on the same path during same-task re-creation.
  teardownSession(taskId);

  // Resolve command for cross-platform PTY spawning (handles .cmd/.bat on Windows)
  const { command: resolvedCommand, args: resolvedArgs } = resolveSpawnTargetSync(command, args);

  const session = new PtySession(
    taskId,
    resolvedCommand,
    resolvedArgs,
    cwd,
    onData,
    onExit,
    envOverrides,
    onIdle,
    idleThresholdMs,
    baseEnvOverride,
    startsAtInputBoundary,
    executionId,
  );
  sessions.set(taskId, session);
  notifyPtySessionStarted(taskId, startsAtInputBoundary);
  // Persist pid so a hard Tower crash can reap this group on next boot.
  void recordSessionPid(taskId, session.pid);
  if (initialInput !== undefined) session.writeInitialInput(initialInput);
  return session;
}

export function getSession(taskId: string): PtySession | undefined {
  return sessions.get(taskId);
}

/** Preserve the safe turn boundary on the live PTY object across route/module reloads. */
export function markSessionTurnComplete(taskId: string): boolean {
  const session = sessions.get(taskId);
  if (!session || session.killed) return false;
  session.markTurnComplete();
  return true;
}

/**
 * Remove a session from the registry and kill its whole process group (claude
 * CLI + its MCP/LSP children) — killing only the immediate child would orphan
 * those descendants as residual node processes. SIGTERM → SIGKILL escalation is
 * handled inside killTree(). Returns the session if one existed.
 */
function teardownSession(taskId: string): PtySession | undefined {
  const session = sessions.get(taskId);
  if (!session) return undefined;
  sessions.delete(taskId);
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = null;
  }
  session.killTree();
  return session;
}

export function destroySession(taskId: string): void {
  if (teardownSession(taskId)) {
    // Clean teardown — drop the persisted pid so the boot reaper ignores it.
    void clearSessionPid(taskId);
  }
}

/**
 * Park a task's PTY while it waits for a human reply (ask_human). Suspends the
 * WS-disconnect keepalive auto-destroy (ws-server) and cancels any timer already
 * ticking, so a multi-hour human wait can't reap the live terminal — the reply
 * then injects into the SAME running session (continueOrStartTaskExecution's
 * already_running branch) instead of a fragile resume/--continue restart.
 * Mirrors preview PTYs' long-lived `onIdle: undefined` policy. No-op if the
 * session is gone or already dead. Only touches the shared PtySession object,
 * so it works across bundle instances (session map lives on globalThis).
 */
export function parkSession(taskId: string): void {
  const s = sessions.get(taskId);
  if (!s || s.killed) return;
  s.parked = true;
  if (s.disconnectTimer) {
    clearTimeout(s.disconnectTimer);
    s.disconnectTimer = null;
  }
}

/** Reply arrived → clear parked; normal keepalive resumes on the next WS disconnect. */
export function unparkSession(taskId: string): void {
  const s = sessions.get(taskId);
  if (s) s.parked = false;
}

/** D-08: Called on SIGTERM — kills all sessions */
export function destroyAllSessions(): void {
  for (const taskId of sessions.keys()) {
    destroySession(taskId);
  }
}

// D-08: Register SIGTERM/SIGINT cleanup handler
// Only at runtime — build workers import this module and fire SIGINT on exit,
// producing noisy "[session-store] SIGINT received" messages during `next build`.
// Use globalThis flag to prevent listener accumulation across HMR reloads.
const gSignal = globalThis as typeof globalThis & { __ptySignalHandlersRegistered?: boolean };
if (process.env.NEXT_PHASE !== "phase-production-build" && !gSignal.__ptySignalHandlersRegistered) {
  gSignal.__ptySignalHandlersRegistered = true;
  process.once("SIGTERM", () => {
    console.error("[session-store] SIGTERM received — cleaning up PTY sessions");
    destroyAllSessions();
  });
  process.once("SIGINT", () => {
    console.error("[session-store] SIGINT received — cleaning up PTY sessions");
    destroyAllSessions();
  });
}
