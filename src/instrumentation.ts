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

    // Harness: register unattended notify channels (feishu) if credentials present.
    // Idempotent + self-healing — dispatch paths re-ensure lazily too. Fire-and-forget.
    void (async () => {
      try {
        const { ensureNotifyChannels } = await import("@/lib/harness/notify/init");
        await ensureNotifyChannels();
      } catch (err) {
        console.error("[harness] notify channel init failed:", err);
      }
    })();

    // Auto-install Tower MCP into every available CLI's user-scope config.
    // Idempotent — skips providers whose CLI isn't installed or whose user-
    // scope MCP entry already matches. Runs after ensureTowerDir so any
    // legacy project-scope writes are cleaned up first. Fire-and-forget:
    // a slow CLI probe must not block server startup.
    void (async () => {
      try {
        const { providerRegistry } = await import("@/lib/ai/providers");
        const { installAllForProvider } = await import("@/lib/ai/install-orchestrator");
        const httpPort = parseInt(process.env.PORT || "3000", 10);
        const apiUrl = `http://localhost:${httpPort}`;
        for (const provider of providerRegistry.getAll()) {
          const adapter = provider.cli?.adapter;
          if (!adapter) continue;
          try {
            // Stale-path repair is independent of CLI availability and MCP
            // status: settings.json may still list hooks from a previous
            // Tower install even if the CLI binary is gone from PATH right
            // now (issue #8). Refresh only existing entries — never adds new.
            await adapter.repairHookPaths?.().catch(() => {});
            if (!(await adapter.isAvailable())) continue;
            const already = await adapter.isMcpInstalled("tower", { scope: "user" }).catch(() => false);
            if (already) continue;
            const report = await installAllForProvider(provider.name, apiUrl);
            if (report.ok) {
              console.error(`[init-tower] Auto-installed Tower MCP for ${provider.name} (user scope)`);
            } else {
              console.error(`[init-tower] Auto-install for ${provider.name} reported issues:`, {
                mcp: report.mcp?.ok,
                hooks: report.hooks?.ok,
                skill: report.skill?.ok,
              });
            }
          } catch (err) {
            console.error(`[init-tower] Auto-install failed for ${provider.name}:`, err);
          }
        }
      } catch (err) {
        console.error("[init-tower] Provider auto-install setup failed:", err);
      }
    })();
  }
}
