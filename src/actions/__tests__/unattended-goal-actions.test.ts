// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = { name: "transaction-client" };
  return {
    transaction,
    runTransaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(transaction)),
    discovery: vi.fn(),
    replaceGrants: vi.fn(),
    revokeGrants: vi.fn(),
    applyLifecycle: vi.fn(),
    setSignal: vi.fn(),
    readMode: vi.fn(),
    recoverNotification: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.runTransaction } }));
vi.mock("@/lib/gateway/capability-runtime", () => ({
  discoverGatewayCapabilities: mocks.discovery,
}));
vi.mock("@/lib/gateway/capability-grants", () => ({
  replaceCapabilityGrantsInTransaction: mocks.replaceGrants,
  revokeCapabilityGrantsInTransaction: mocks.revokeGrants,
}));
vi.mock("@/lib/unattended-goal/runtime", () => ({
  applyUnattendedGoalLifecycleEventInTransaction: mocks.applyLifecycle,
  readUnattendedGoalMode: mocks.readMode,
}));
vi.mock("@/lib/harness/unattended-signal", () => ({ setUnattendedSignal: mocks.setSignal }));
vi.mock("@/lib/unattended-goal/final-notification", () => ({
  recoverUnattendedGoalFinalNotification: mocks.recoverNotification,
}));

import {
  disableUnattendedGoalFromUi,
  enableUnattendedGoalFromUi,
  recoverUnattendedGoalNotificationFromUi,
} from "../unattended-goal-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.discovery.mockResolvedValue({
    capabilities: [{
      capability: "human.message.send",
      risk: "R2",
      targetKind: "OWNER_HOME_ROUTE",
      available: true,
      routeRevision: "owner-route-v1",
    }],
  });
  mocks.replaceGrants.mockResolvedValue([{
    authorizationRef: "grant-1",
    capability: "human.message.send",
    targetKind: "OWNER_HOME_ROUTE",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }]);
  mocks.revokeGrants.mockResolvedValue(1);
  mocks.applyLifecycle.mockResolvedValue({ state: "ACTIVE", active: true });
  mocks.readMode.mockResolvedValue({ active: false, runtime: null });
  mocks.recoverNotification.mockResolvedValue({ state: "SUCCEEDED" });
});

describe("unattended Goal UI actions", () => {
  it("persists grants, runtime, and the compatibility shadow in one transaction", async () => {
    await expect(enableUnattendedGoalFromUi({
      taskId: "task-1",
      durationMinutes: 120,
    })).resolves.toMatchObject({
      active: true,
      ownerMessageGrant: { authorizationRef: "grant-1" },
    });

    expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.replaceGrants).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      durationMinutes: 120,
      targets: [expect.objectContaining({ capability: "human.message.send" })],
    }), mocks.transaction);
    expect(mocks.applyLifecycle).toHaveBeenCalledWith(mocks.transaction, {
      taskId: "task-1",
      event: "ACTIVATED",
      refreshActive: true,
      policy: {
        maxDurationMs: 120 * 60_000,
      },
    });
    expect(mocks.setSignal).toHaveBeenCalledWith("task-1", true);
  });

  it("revokes grants and ends the runtime in one transaction", async () => {
    mocks.applyLifecycle.mockResolvedValueOnce({ state: "ENDED", active: false });

    await expect(disableUnattendedGoalFromUi("task-1")).resolves.toMatchObject({
      active: false,
      revoked: 1,
      runtime: { state: "ENDED" },
    });

    expect(mocks.runTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.revokeGrants).toHaveBeenCalledWith("task-1", mocks.transaction);
    expect(mocks.applyLifecycle).toHaveBeenCalledWith(mocks.transaction, {
      taskId: "task-1",
      event: "DEACTIVATED",
    });
    expect(mocks.setSignal).toHaveBeenCalledWith("task-1", false);
  });

  it("restarts the selected duration when unattended mode is enabled again", async () => {
    await enableUnattendedGoalFromUi({ taskId: "task-1", durationMinutes: 120 });

    expect(mocks.applyLifecycle).toHaveBeenCalledWith(mocks.transaction, expect.objectContaining({
      taskId: "task-1",
      event: "ACTIVATED",
      refreshActive: true,
    }));
  });

  it("issues a bounded OWNER grant and recovers a persisted final notification", async () => {
    mocks.readMode.mockResolvedValueOnce({
      active: false,
      runtime: {
        state: "ENDED",
        ownerNotificationRequestId: "request-1",
        ownerNotificationKind: "COMPLETED",
        ownerNotificationState: "BLOCKED",
      },
    });

    await expect(recoverUnattendedGoalNotificationFromUi({ taskId: "task-1" }))
      .resolves.toMatchObject({ notification: { state: "SUCCEEDED" } });

    expect(mocks.replaceGrants).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      durationMinutes: 120,
    }), mocks.transaction);
    expect(mocks.applyLifecycle).not.toHaveBeenCalled();
    expect(mocks.recoverNotification).toHaveBeenCalledWith("task-1", expect.anything(), true);
  });

  it("fails closed before opening a transaction when no OWNER route exists", async () => {
    mocks.discovery.mockResolvedValueOnce({ capabilities: [] });

    await expect(enableUnattendedGoalFromUi({ taskId: "task-1" }))
      .rejects.toThrow(/fixed unattended OWNER home route/);
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(mocks.setSignal).not.toHaveBeenCalled();
  });
});
