import { describe, expect, it, vi } from "vitest";
import { createWorkbenchRuntimeMaintenanceRunners } from "../runtime-maintenance";

describe("Workbench runtime maintenance", () => {
  it("continues heartbeats while a durable reconcile is still running", async () => {
    let finishRecovery: (() => void) | undefined;
    const recoverClaims = vi.fn(() => new Promise<void>((resolve) => {
      finishRecovery = resolve;
    }));
    const reconcilePending = vi.fn(async () => undefined);
    const heartbeat = vi.fn(async () => undefined);
    const reportError = vi.fn();
    const runners = createWorkbenchRuntimeMaintenanceRunners({
      recoverClaims,
      reconcilePending,
      heartbeat,
      reportError,
    });

    const slowReconcile = runners.reconcile();
    await Promise.resolve();
    await runners.heartbeat();

    expect(recoverClaims).toHaveBeenCalledOnce();
    expect(reconcilePending).not.toHaveBeenCalled();
    expect(heartbeat).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();

    finishRecovery?.();
    await slowReconcile;
    expect(reconcilePending).toHaveBeenCalledOnce();
  });

  it("contains heartbeat failures without blocking reconciliation", async () => {
    const recoverClaims = vi.fn(async () => undefined);
    const reconcilePending = vi.fn(async () => undefined);
    const heartbeatError = new Error("heartbeat unavailable");
    const reportError = vi.fn();
    const runners = createWorkbenchRuntimeMaintenanceRunners({
      recoverClaims,
      reconcilePending,
      heartbeat: vi.fn(async () => { throw heartbeatError; }),
      reportError,
    });

    await runners.heartbeat();
    await runners.reconcile();

    expect(reportError).toHaveBeenCalledWith("heartbeat", heartbeatError);
    expect(recoverClaims).toHaveBeenCalledOnce();
    expect(reconcilePending).toHaveBeenCalledOnce();
  });
});
