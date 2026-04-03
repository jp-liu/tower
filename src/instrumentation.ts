export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Dynamic imports inside the runtime guard — prevents bundler from
    // pulling Node.js modules (child_process, ws, node-pty) into the
    // Edge/browser bundle.
    const { pruneOrphanedWorktrees } = await import(
      "@/lib/instrumentation-tasks"
    );
    await pruneOrphanedWorktrees();

    // WS-01: Start WebSocket server on port 3001 for PTY terminal sessions
    const { startWsServer } = await import("@/lib/pty/ws-server");
    await startWsServer();
  }
}
