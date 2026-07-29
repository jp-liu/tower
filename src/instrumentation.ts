const instrumentationGlobal = globalThis as typeof globalThis & {
  __towerInstrumentationRegistration?: Promise<void>;
};

async function registerNodeRuntime() {
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

    // Codex writes completion callbacks durably before posting them. Polling is
    // intentionally short so a transient local HTTP/startup race converges in
    // under five seconds without requiring another server restart.
    const gCompletion = globalThis as typeof globalThis & { __providerCompletionRecoveryStarted?: boolean };
    if (!gCompletion.__providerCompletionRecoveryStarted) {
      gCompletion.__providerCompletionRecoveryStarted = true;
      const recover = async () => {
        const { recoverPendingProviderCompletions } = await import(
          "@/lib/terminal/provider-completion-recovery"
        );
        await recoverPendingProviderCompletions();
      };
      const first = setTimeout(() => void recover(), 250);
      first.unref?.();
      const interval = setInterval(() => void recover(), 2_000);
      interval.unref?.();
    }

    // Durable Workbench control loop. Enqueue-time timers make the happy path
    // fast, but this database scan is what guarantees eventual wake-up after a
    // restart, a lost in-memory boundary, or an event arriving during a busy turn.
    const gWorkbench = globalThis as typeof globalThis & {
      __workbenchReconcilerStarted?: boolean;
      __workbenchReconcilerRunning?: boolean;
    };
    if (!gWorkbench.__workbenchReconcilerStarted) {
      gWorkbench.__workbenchReconcilerStarted = true;
      const reconcile = async () => {
        if (gWorkbench.__workbenchReconcilerRunning) return;
        gWorkbench.__workbenchReconcilerRunning = true;
        try {
          const {
            heartbeatActiveWorkbenchRuntimes,
            reconcilePendingWorkbenchEvents,
            recoverWorkbenchEventClaims,
          } = await import(
            "@/lib/workbench/coordinator"
          );
          await recoverWorkbenchEventClaims();
          await reconcilePendingWorkbenchEvents();
          await heartbeatActiveWorkbenchRuntimes();
        } catch (error) {
          console.error("[workbench] Durable reconciliation failed:", error);
        } finally {
          gWorkbench.__workbenchReconcilerRunning = false;
        }
      };
      setTimeout(() => void reconcile(), 500);
      // Keep these control-plane handles referenced. In standalone production
      // Next may run instrumentation in a lifecycle whose only persistent work
      // is these timers; unref() lets that lifecycle disappear after startup.
      setInterval(() => void reconcile(), 2_000);
    }

    // Gateway watchdog. This repairs create-before-confirm windows, recreates
    // missing Workbench requests, and retries durable outbound deliveries
    // without requiring a Tower restart or another user message.
    const gGateway = globalThis as typeof globalThis & {
      __gatewayRecoveryStarted?: boolean;
      __gatewayRecoveryRunning?: boolean;
    };
    if (!gGateway.__gatewayRecoveryStarted) {
      gGateway.__gatewayRecoveryStarted = true;
      const recoverGateway = async () => {
        if (gGateway.__gatewayRecoveryRunning) return;
        gGateway.__gatewayRecoveryRunning = true;
        try {
          const { recoverQueuedGatewayWork, retryGatewayDeliveries } = await import(
            "@/lib/harness/gateway-router"
          );
          await recoverQueuedGatewayWork();
          await retryGatewayDeliveries();
        } catch (error) {
          console.error("[gateway] Durable recovery failed:", error);
        } finally {
          gGateway.__gatewayRecoveryRunning = false;
        }
      };
      setTimeout(() => void recoverGateway(), 1_000);
      setInterval(() => void recoverGateway(), 10_000);
    }

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

    // Daily unattended backup with bounded retention. The first check is
    // delayed so startup and gateway recovery win the initial I/O budget.
    const gBackup = globalThis as typeof globalThis & {
      __scheduledBackupStarted?: boolean;
      __scheduledBackupRunning?: boolean;
    };
    if (!gBackup.__scheduledBackupStarted) {
      gBackup.__scheduledBackupStarted = true;
      const runBackup = async () => {
        if (gBackup.__scheduledBackupRunning) return;
        gBackup.__scheduledBackupRunning = true;
        try {
          const { createScheduledBackupIfDue } = await import("@/lib/scheduled-backup");
          const result = await createScheduledBackupIfDue();
          if (result.created) {
            console.info(`[backup] Scheduled backup created: ${result.filename}`);
          }
        } catch (error) {
          console.error("[backup] Scheduled backup failed:", error);
        } finally {
          gBackup.__scheduledBackupRunning = false;
        }
      };
      setTimeout(() => void runBackup(), 30_000);
      setInterval(() => void runBackup(), 6 * 60 * 60 * 1_000);
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
          const message = `[init-tower] Provider reconciliation ${result.provider}: ${result.status}`;
          if (result.status === "connected") console.info(message);
          else if (result.status === "partial") console.warn(message);
          else console.error(message);
        }
      } catch {
        console.error("[init-tower] Provider reconciliation setup failed");
      }
    })();
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Next may evaluate instrumentation more than once in the same server process
  // (for example when a lazily-loaded runtime bundle is initialized). Startup
  // recovery is destructive by design, so running it again would classify every
  // live terminal as stale and make all Mission cards disappear together.
  // Share one promise on globalThis so concurrent/repeated registrations both
  // await the same initialization instead of starting another cleanup pass.
  instrumentationGlobal.__towerInstrumentationRegistration ??= registerNodeRuntime();
  await instrumentationGlobal.__towerInstrumentationRegistration;
}
