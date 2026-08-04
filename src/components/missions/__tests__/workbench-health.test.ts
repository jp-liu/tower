import { describe, expect, it } from "vitest";
import { inspectWorkbenchHealth, WORKBENCH_HEARTBEAT_STALE_MS } from "../workbench-health";

const now = new Date("2026-08-04T10:00:00.000Z").getTime();

describe("Workbench health projection", () => {
  it("explains a provider-owned BUSY turn even with no pending events", () => {
    expect(inspectWorkbenchHealth({
      executionId: "execution-current",
      runtimeExecutionId: "execution-current",
      syncState: "CURRENT",
      generation: 2,
      state: "BUSY",
      activeBatchId: null,
      pendingEvents: 0,
      lastHeartbeatAt: new Date(now).toISOString(),
      blockedReason: "Provider turn in progress",
      lastError: null,
    }, now)).toMatchObject({
      unhealthy: false,
      heartbeatStale: false,
      providerTurnInProgress: true,
    });
  });

  it("marks an otherwise healthy runtime stale after missed heartbeats", () => {
    expect(inspectWorkbenchHealth({
      executionId: "execution-current",
      runtimeExecutionId: "execution-current",
      syncState: "CURRENT",
      generation: 2,
      state: "IDLE",
      activeBatchId: null,
      pendingEvents: 0,
      lastHeartbeatAt: new Date(now - WORKBENCH_HEARTBEAT_STALE_MS - 1).toISOString(),
      blockedReason: null,
      lastError: null,
    }, now)).toMatchObject({
      unhealthy: true,
      heartbeatStale: true,
    });
  });

  it("keeps a current STARTING runtime non-green while awaiting its first boundary", () => {
    expect(inspectWorkbenchHealth({
      executionId: "execution-current",
      runtimeExecutionId: "execution-current",
      syncState: "CURRENT",
      generation: 3,
      state: "STARTING",
      activeBatchId: null,
      pendingEvents: 1,
      lastHeartbeatAt: new Date(now).toISOString(),
      blockedReason: "Waiting for the current execution's provider-confirmed turn boundary",
      lastError: null,
    }, now)).toMatchObject({
      unhealthy: true,
      heartbeatStale: false,
      synchronizationStale: false,
    });
  });
});
