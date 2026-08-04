export interface WorkbenchRuntimeMaintenanceDependencies {
  recoverClaims: () => Promise<unknown>;
  reconcilePending: () => Promise<unknown>;
  heartbeat: () => Promise<unknown>;
  reportError: (operation: "reconcile" | "heartbeat", error: unknown) => void;
}

/**
 * Keep operational projection refresh independent from durable inbox recovery.
 * A slow provider restart may hold the reconcile runner for minutes, but it must
 * never prevent live Workbench heartbeats from receiving their own time slice.
 */
export function createWorkbenchRuntimeMaintenanceRunners(
  dependencies: WorkbenchRuntimeMaintenanceDependencies,
): {
  reconcile: () => Promise<void>;
  heartbeat: () => Promise<void>;
} {
  let reconcileRunning = false;
  let heartbeatRunning = false;

  return {
    async reconcile() {
      if (reconcileRunning) return;
      reconcileRunning = true;
      try {
        await dependencies.recoverClaims();
        await dependencies.reconcilePending();
      } catch (error) {
        dependencies.reportError("reconcile", error);
      } finally {
        reconcileRunning = false;
      }
    },
    async heartbeat() {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      try {
        await dependencies.heartbeat();
      } catch (error) {
        dependencies.reportError("heartbeat", error);
      } finally {
        heartbeatRunning = false;
      }
    },
  };
}
