import { PtySession } from "./pty-session";

// D-04: Module-level singleton — persists across requests in same Node.js process
const sessions = new Map<string, PtySession>();

export function createSession(
  taskId: string,
  command: string,
  args: string[],
  cwd: string,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void
): PtySession {
  // Destroy any existing session for this taskId before creating new one
  destroySession(taskId);

  const session = new PtySession(taskId, command, args, cwd, onData, onExit);
  sessions.set(taskId, session);
  return session;
}

export function getSession(taskId: string): PtySession | undefined {
  return sessions.get(taskId);
}

export function destroySession(taskId: string): void {
  const session = sessions.get(taskId);
  if (!session) return;
  sessions.delete(taskId);
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = null;
  }
  session.kill();
}

/** D-08: Called on SIGTERM — kills all sessions */
export function destroyAllSessions(): void {
  for (const taskId of sessions.keys()) {
    destroySession(taskId);
  }
}

// D-08: Register SIGTERM cleanup handler
process.on("SIGTERM", () => {
  console.error("[session-store] SIGTERM received — cleaning up PTY sessions");
  destroyAllSessions();
});
