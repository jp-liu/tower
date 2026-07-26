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

    // Harness TTL sweep: expire long-open asks so they don't linger forever if a task
    // dies without cleanup. Run once at boot + every 6h. globalThis flag guards against
    // duplicate intervals across HMR reloads.
    const gSweep = globalThis as typeof globalThis & { __harnessSweepStarted?: boolean };
    if (!gSweep.__harnessSweepStarted) {
      gSweep.__harnessSweepStarted = true;
      const runSweep = async () => {
        try {
          const { readConfigValue } = await import("@/lib/config-reader");
          const { sweepExpiredAsks } = await import("@/lib/harness/harness-message");
          const ttlDays = await readConfigValue<number>("harness.pendingTtlDays", 14);
          const n = await sweepExpiredAsks(ttlDays);
          if (n > 0) console.error(`[harness] TTL sweep expired ${n} stale open ask(s)`);
        } catch (err) {
          console.error("[harness] TTL sweep failed:", err);
        }
      };
      void runSweep();
      setInterval(() => void runSweep(), 6 * 60 * 60 * 1000);
    }

    // Re-register enabled dynamic providers and reconcile real CLI config in
    // the background. Startup must not be delayed by provider probes.
    void (async () => {
      try {
        const { reconcileAllProviderIntegrations } = await import(
          "@/lib/ai/provider-reconciliation"
        );
        const results = await reconcileAllProviderIntegrations("startup");
        for (const result of results) {
          console.error(`[init-tower] Provider reconciliation ${result.provider}: ${result.status}`);
        }
      } catch {
        console.error("[init-tower] Provider reconciliation setup failed");
      }
    })();
  }
}
