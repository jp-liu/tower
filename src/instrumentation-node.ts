const instrumentationGlobal = globalThis as typeof globalThis & {
  __towerInstrumentationRegistration?: Promise<void>;
};

async function initializeNodeRuntime() {
  const {
    acquireTowerRuntimeLease,
    heartbeatTowerRuntimeLease,
    RUNTIME_LEASE_HEARTBEAT_MS,
    towerRuntimeOwnerId,
  } = await import("@/lib/runtime-leader");
  const runtimeOwnerId = towerRuntimeOwnerId();
  await acquireTowerRuntimeLease(runtimeOwnerId);
  let runtimeLeaseHeartbeatFailures = 0;
  const runtimeLeaseHeartbeat = setInterval(() => {
    void heartbeatTowerRuntimeLease(runtimeOwnerId).then((owned) => {
      runtimeLeaseHeartbeatFailures = 0;
      if (!owned) {
        console.error("[runtime-leader] Database runtime lease was lost; terminating to prevent split brain");
        process.exit(78);
      }
    }).catch((error) => {
      runtimeLeaseHeartbeatFailures++;
      console.error("[runtime-leader] Database runtime heartbeat failed:", error);
      if (runtimeLeaseHeartbeatFailures >= 3) {
        console.error("[runtime-leader] Lease could expire before the next safe heartbeat; terminating");
        process.exit(78);
      }
    });
  }, RUNTIME_LEASE_HEARTBEAT_MS);
  runtimeLeaseHeartbeat.unref?.();

  const { pruneOrphanedWorktrees, cleanupStaleExecutions, ensureTowerLabel, ensureDefaultWorkspace } = await import(
    "@/lib/instrumentation-tasks"
  );
  await pruneOrphanedWorktrees();
  await cleanupStaleExecutions();
  await ensureTowerLabel();
  await ensureDefaultWorkspace();

  const { registerWorkbenchPtyLifecycle } = await import("@/lib/workbench/pty-lifecycle-adapter");
  registerWorkbenchPtyLifecycle();
  const {
    migrateLegacyGatewayWorkbenchCommands,
    registerGatewayWorkbenchDeliveryLifecycle,
  } = await import(
    "@/lib/harness/workbench-delivery-adapter"
  );
  registerGatewayWorkbenchDeliveryLifecycle();
  await migrateLegacyGatewayWorkbenchCommands();

  const { startWsServer } = await import("@/lib/pty/ws-server");
  await startWsServer();

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
        } = await import("@/lib/workbench/coordinator");
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
    setInterval(() => void reconcile(), 2_000);
  }

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

  const gHarnessOutbound = globalThis as typeof globalThis & {
    __harnessOutboundRecoveryStarted?: boolean;
    __harnessOutboundRecoveryRunning?: boolean;
  };
  if (!gHarnessOutbound.__harnessOutboundRecoveryStarted) {
    gHarnessOutbound.__harnessOutboundRecoveryStarted = true;
    const recoverOutbounds = async () => {
      if (gHarnessOutbound.__harnessOutboundRecoveryRunning) return;
      gHarnessOutbound.__harnessOutboundRecoveryRunning = true;
      try {
        const { recoverHarnessOutbounds } = await import("@/lib/harness/harness-outbound");
        await recoverHarnessOutbounds();
      } catch (error) {
        console.error("[harness-outbound] Durable recovery failed:", error);
      } finally {
        gHarnessOutbound.__harnessOutboundRecoveryRunning = false;
      }
    };
    setTimeout(() => void recoverOutbounds(), 1_500);
    setInterval(() => void recoverOutbounds(), 10_000);
  }

  const { ensureTowerDir } = await import("@/lib/init-tower");
  ensureTowerDir();

  const gSweep = globalThis as typeof globalThis & {
    __harnessSweepStarted?: boolean;
    __harnessSweepRunning?: boolean;
  };
  if (!gSweep.__harnessSweepStarted) {
    gSweep.__harnessSweepStarted = true;
    const runSweep = async () => {
      if (gSweep.__harnessSweepRunning) return;
      gSweep.__harnessSweepRunning = true;
      try {
        await Promise.all([
          (async () => {
            try {
              const { readConfigValue } = await import("@/lib/config-reader");
              const { sweepExpiredAsks } = await import("@/lib/harness/harness-message");
              const ttlDays = await readConfigValue<number>("harness.pendingTtlDays", 14);
              const n = await sweepExpiredAsks(ttlDays);
              if (n > 0) console.error(`[harness] TTL sweep expired ${n} stale open ask(s)`);
            } catch (error) {
              console.error("[harness] TTL sweep failed:", error);
            }
          })(),
          (async () => {
            try {
              const { measureWorkbenchOperationalData } = await import(
                "@/lib/workbench/maintenance"
              );
              const result = await measureWorkbenchOperationalData();
              console.info(
                `[workbench] Operational data scanned=${result.scanned} `
                + `storedBytes=${result.totalTextBytes} eligible=${result.eligibleRows} `
                + `eligibleBytes=${result.eligibleTextBytes}`,
              );
            } catch (error) {
              console.error("[workbench] Operational data observation failed:", error);
            }
          })(),
          (async () => {
            try {
              const { measureGatewayOperationalData } = await import(
                "@/lib/harness/gateway-maintenance"
              );
              const result = await measureGatewayOperationalData();
              console.info(
                `[gateway] Operational data scanned=${result.scanned} `
                + `storedBytes=${result.totalTextBytes} eligible=${result.eligibleRows} `
                + `eligibleBytes=${result.eligibleTextBytes}`,
              );
            } catch (error) {
              console.error("[gateway] Operational data observation failed:", error);
            }
          })(),
        ]);
      } finally {
        gSweep.__harnessSweepRunning = false;
      }
    };
    void runSweep();
    setInterval(() => void runSweep(), 6 * 60 * 60 * 1000);
  }

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
        if (result.created) console.info(`[backup] Scheduled backup created: ${result.filename}`);
      } catch (error) {
        console.error("[backup] Scheduled backup failed:", error);
      } finally {
        gBackup.__scheduledBackupRunning = false;
      }
    };
    setTimeout(() => void runBackup(), 30_000);
    setInterval(() => void runBackup(), 6 * 60 * 60 * 1_000);
  }

  void (async () => {
    try {
      const { reconcileAllProviderIntegrations } = await import("@/lib/ai/provider-reconciliation");
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

export async function registerNodeRuntime() {
  instrumentationGlobal.__towerInstrumentationRegistration ??= initializeNodeRuntime();
  await instrumentationGlobal.__towerInstrumentationRegistration;
}
