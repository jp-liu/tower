import type { ActiveExecutionInfo } from "@/actions/agent-actions";

export const WORKBENCH_HEARTBEAT_STALE_MS = 12_000;

export function inspectWorkbenchHealth(
  runtime: ActiveExecutionInfo["workbenchRuntime"],
  now = Date.now(),
): {
  unhealthy: boolean;
  heartbeatStale: boolean;
  synchronizationStale: boolean;
  providerTurnInProgress: boolean;
} {
  if (!runtime) {
    return {
      unhealthy: true,
      heartbeatStale: false,
      synchronizationStale: true,
      providerTurnInProgress: false,
    };
  }
  const heartbeatAt = runtime.lastHeartbeatAt
    ? new Date(runtime.lastHeartbeatAt).getTime()
    : null;
  const heartbeatStale = heartbeatAt !== null
    && (!Number.isFinite(heartbeatAt) || now - heartbeatAt > WORKBENCH_HEARTBEAT_STALE_MS);
  const synchronizationStale = runtime.syncState !== "CURRENT";
  const providerTurnInProgress = runtime.state === "BUSY"
    && runtime.activeBatchId === null
    && runtime.pendingEvents === 0;
  return {
    unhealthy: synchronizationStale
      || heartbeatStale
      || runtime.state === "STARTING"
      || runtime.state === "BLOCKED"
      || runtime.state === "DEGRADED"
      || runtime.state === "STOPPED",
    heartbeatStale,
    synchronizationStale,
    providerTurnInProgress,
  };
}
