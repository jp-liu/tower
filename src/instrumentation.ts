import type { ProviderConnectionRow } from "@/actions/provider-connection-actions";

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

    // Auto-refresh Tower integrations only when the recorded install fingerprint
    // is stale. The fingerprint includes Tower's package version plus runtime
    // identity (package root, data dir, API URL), so upgrades and path/port
    // changes self-heal without rewriting user CLI config on every boot.
    // Fire-and-forget: a slow CLI probe must not block server startup.
    void (async () => {
      try {
        const { providerRegistry } = await import("@/lib/ai/providers");
        const { buildTowerIntegrationFingerprint, installAllForProvider } = await import(
          "@/lib/ai/install-orchestrator"
        );
        const { getProviderConnection, markProviderConnected, markProviderDisconnected } = await import(
          "@/actions/provider-connection-actions"
        );
        const httpPort = parseInt(process.env.PORT || "3000", 10);
        const apiUrl = `http://localhost:${httpPort}`;
        const integrationFingerprint = buildTowerIntegrationFingerprint(apiUrl);
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
            const connection = await getProviderConnection(provider.name);
            if (isTowerIntegrationCurrent(connection, integrationFingerprint)) {
              console.error(`[init-tower] Tower integration for ${provider.name} is up to date`);
              continue;
            }
            const report = await installAllForProvider(provider.name, apiUrl);
            if (report.ok) await markProviderConnected(provider.name, {
              version: await adapter.getVersion().catch(() => null),
              report,
            });
            else await markProviderDisconnected(provider.name, {
              reason: JSON.stringify({
                mcp: report.mcp?.ok,
                hooks: report.hooks?.ok,
                skill: report.skill?.ok,
                error: report.skill?.error ?? report.hooks?.error ?? report.mcp?.error,
              }),
            });
            if (report.ok) {
              console.error(`[init-tower] Auto-refreshed Tower integration for ${provider.name} (user scope)`);
            } else {
              console.error(`[init-tower] Auto-refresh for ${provider.name} reported issues:`, {
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

function isTowerIntegrationCurrent(
  connection: ProviderConnectionRow | null,
  integrationFingerprint: string,
): boolean {
  if (!connection) return false;
  if (!connection.testOk) return false;
  if (!connection.mcpInstalled || !connection.hooksInstalled || !connection.skillsInstalled) return false;
  if (!connection.installLog) return false;

  try {
    const report = JSON.parse(connection.installLog) as { integrationFingerprint?: unknown };
    return report.integrationFingerprint === integrationFingerprint;
  } catch {
    return false;
  }
}
