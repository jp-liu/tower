export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { pruneOrphanedWorktrees, cleanupStaleExecutions } = await import(
      "@/lib/instrumentation-tasks"
    );
    await pruneOrphanedWorktrees();
    await cleanupStaleExecutions();

    // WS-01: Start WebSocket server on port 3001 for PTY terminal sessions
    const { startWsServer } = await import("@/lib/pty/ws-server");
    await startWsServer();
  }
}
