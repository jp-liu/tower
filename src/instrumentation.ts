export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { pruneOrphanedWorktrees, cleanupStaleExecutions, ensureTowerLabel, ensureDefaultWorkspace } = await import(
      "@/lib/instrumentation-tasks"
    );
    await pruneOrphanedWorktrees();
    await cleanupStaleExecutions();
    await ensureTowerLabel();
    await ensureDefaultWorkspace();

    // WS-01: Start WebSocket server for PTY terminal sessions.
    // Port is derived from the resolved HTTP port (default: httpPort + 1),
    // unless overridden by terminal.wsPort.
    const { startWsServer } = await import("@/lib/pty/ws-server");
    await startWsServer();

    // Ensure .tower/ directory exists for the assistant persona
    const { ensureTowerDir } = await import("@/lib/init-tower");
    ensureTowerDir();
  }
}
