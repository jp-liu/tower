// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setSignal } = vi.hoisted(() => ({ setSignal: vi.fn() }));
vi.mock("@/lib/harness/unattended-signal", () => ({
  setUnattendedSignal: setSignal,
}));

import {
  activateUnattendedGoal,
  endUnattendedGoal,
  endUnattendedGoalIfActive,
  readUnattendedGoalMode,
} from "../runtime";

const runtimeDefaults = {
  blockedAt: null,
  blockedReason: null,
  providerTurns: 0,
  consecutiveFailures: 0,
  noProgressTurns: 0,
  lastProgressAt: null,
  nextWakeAt: null,
  wakeReason: null,
  ownerNotificationRequestId: null,
  ownerNotificationKind: null,
  ownerNotificationState: null,
  ownerNotificationSummary: null,
  ownerNotificationBinding: null,
  ownerNotificationError: null,
  ownerNotificationCreatedAt: null,
  ownerNotificationCompletedAt: null,
  maxDurationMs: 28_800_000,
  maxProviderTurns: 100,
  maxChildTasks: 50,
  maxConcurrentChildren: 4,
  maxConsecutiveFailures: 3,
  maxNoProgressTurns: 5,
  maxCapabilityJobs: 20,
  maxTokens: null,
  maxCostUsdCents: null,
};

function createDb(input: { legacy?: boolean; runtime?: Record<string, unknown> | null } = {}) {
  let legacy = input.legacy ?? false;
  let runtime = input.runtime ?? null;
  const task = {
    findUnique: vi.fn(async (query: { select?: Record<string, boolean> }) => {
      if (query.select?.title) return { id: "task-1", title: "Task", unattended: legacy };
      return { id: "task-1", unattended: legacy };
    }),
    update: vi.fn(async (query: { data: { unattended: boolean } }) => {
      legacy = query.data.unattended;
      return { id: "task-1" };
    }),
  };
  const unattendedGoalRuntime = {
    findUnique: vi.fn(async () => runtime),
    create: vi.fn(async (query: { data: Record<string, unknown> }) => {
      runtime = {
        taskId: "task-1",
        activatedAt: new Date(),
        endedAt: null,
        ...runtimeDefaults,
        ...query.data,
      };
      return runtime;
    }),
    update: vi.fn(async (query: { data: Record<string, unknown> }) => {
      runtime = { ...(runtime ?? {}), ...query.data };
      return runtime;
    }),
  };
  const capabilityGrant = {
    updateMany: vi.fn(async () => ({ count: 1 })),
  };
  const db = {
    task,
    unattendedGoalRuntime,
    capabilityGrant,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ task, unattendedGoalRuntime, capabilityGrant })),
  };
  return { db, task, unattendedGoalRuntime, capabilityGrant };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("unattended goal runtime", () => {
  it("reads the legacy marker only when no module projection exists", async () => {
    const { db } = createDb({ legacy: true });

    const result = await readUnattendedGoalMode(db as never, "task-1");

    expect(result.active).toBe(true);
    expect(result.runtime).toBeNull();
  });

  it("treats the module projection as authoritative", async () => {
    const { db } = createDb({
      legacy: true,
      runtime: {
        ...runtimeDefaults,
        taskId: "task-1",
        state: "ENDED",
        lastEventKind: "TERMINAL_COMPLETED",
        activatedAt: new Date(),
        endedAt: new Date(),
      },
    });

    const result = await readUnattendedGoalMode(db as never, "task-1");

    expect(result.active).toBe(false);
  });

  it("activates through one module transaction and mirrors the hook signal", async () => {
    const { db, task, unattendedGoalRuntime } = createDb();

    const result = await activateUnattendedGoal(db as never, "task-1");

    expect(result.state).toBe("ACTIVE");
    expect(task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { unattended: true },
      select: { id: true },
    });
    expect(unattendedGoalRuntime.create).toHaveBeenCalled();
    expect(setSignal).toHaveBeenCalledWith("task-1", true);
  });

  it("keeps the original activation time when activation is repeated", async () => {
    const activatedAt = new Date("2026-08-01T00:00:00.000Z");
    const { db, unattendedGoalRuntime } = createDb({
      legacy: true,
      runtime: {
        ...runtimeDefaults,
        taskId: "task-1",
        state: "ACTIVE",
        lastEventKind: "ACTIVATED",
        activatedAt,
        endedAt: null,
      },
    });

    const result = await activateUnattendedGoal(db as never, "task-1");

    expect(result.activatedAt).toEqual(activatedAt);
    expect(result.policy.maxCapabilityJobs).toBe(20);
    expect(unattendedGoalRuntime.create).not.toHaveBeenCalled();
    expect(unattendedGoalRuntime.update).not.toHaveBeenCalled();
    expect(setSignal).toHaveBeenCalledWith("task-1", true);
  });

  it("does not create ended projections for ordinary attended tasks", async () => {
    const { db, unattendedGoalRuntime, capabilityGrant } = createDb();

    const result = await endUnattendedGoalIfActive(db as never, "task-1", "TERMINAL_STOPPED");

    expect(result).toBeNull();
    expect(unattendedGoalRuntime.create).not.toHaveBeenCalled();
    expect(unattendedGoalRuntime.update).not.toHaveBeenCalled();
    expect(capabilityGrant.updateMany).not.toHaveBeenCalled();
    expect(setSignal).toHaveBeenCalledWith("task-1", false);
  });

  it("atomically revokes grants whenever an active Goal ends", async () => {
    const { db, capabilityGrant } = createDb({
      legacy: true,
      runtime: {
        ...runtimeDefaults,
        taskId: "task-1",
        state: "ACTIVE",
        lastEventKind: "ACTIVATED",
        activatedAt: new Date(),
        endedAt: null,
      },
    });

    const result = await endUnattendedGoal(db as never, "task-1", "TERMINAL_STOPPED");

    expect(result).toMatchObject({ state: "ENDED" });
    expect(capabilityGrant.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("ends a blocked Goal on explicit deactivation and keeps repeated deactivation idempotent", async () => {
    const activatedAt = new Date("2026-08-01T00:00:00.000Z");
    const { db, unattendedGoalRuntime, capabilityGrant } = createDb({
      runtime: {
        ...runtimeDefaults,
        taskId: "task-1",
        state: "BLOCKED",
        lastEventKind: "BUDGET_MAX_CHILD_TASKS",
        activatedAt,
        endedAt: null,
        blockedAt: new Date("2026-08-01T01:00:00.000Z"),
        blockedReason: "Child task budget reached",
      },
    });

    const ended = await endUnattendedGoal(db as never, "task-1", "DEACTIVATED");

    expect(ended).toMatchObject({
      active: false,
      state: "ENDED",
      lastEventKind: "DEACTIVATED",
      endedAt: expect.any(Date),
    });
    expect(unattendedGoalRuntime.update).toHaveBeenCalledTimes(1);
    expect(capabilityGrant.updateMany).toHaveBeenCalledWith({
      where: { taskId: "task-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(setSignal).toHaveBeenLastCalledWith("task-1", false);

    const repeated = await endUnattendedGoal(db as never, "task-1", "DEACTIVATED");

    expect(repeated.endedAt).toEqual(ended.endedAt);
    expect(unattendedGoalRuntime.update).toHaveBeenCalledTimes(1);
    expect(setSignal).toHaveBeenLastCalledWith("task-1", false);
  });
});
