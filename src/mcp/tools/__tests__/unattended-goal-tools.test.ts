// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findConfig, activate, end, readMode, readBudget, scheduleWakeup } = vi.hoisted(() => ({
  findConfig: vi.fn(),
  activate: vi.fn(),
  end: vi.fn(),
  readMode: vi.fn(),
  readBudget: vi.fn(),
  scheduleWakeup: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: { systemConfig: { findUnique: findConfig } },
}));

vi.mock("@/lib/unattended-goal/runtime", () => ({
  activateUnattendedGoal: activate,
  endUnattendedGoal: end,
  readUnattendedGoalMode: readMode,
}));

vi.mock("@/lib/unattended-goal/policy", () => ({
  readUnattendedGoalBudget: readBudget,
  scheduleUnattendedGoalWakeup: scheduleWakeup,
}));

import { unattendedGoalTools } from "../unattended-goal-tools";

beforeEach(() => {
  vi.clearAllMocks();
  activate.mockResolvedValue({ active: true, state: "ACTIVE" });
  end.mockResolvedValue({ active: false, state: "ENDED" });
  readMode.mockResolvedValue({
    active: true,
    runtime: {
      state: "ACTIVE",
      nextWakeAt: null,
      policy: { maxDurationMs: 28_800_000, maxProviderTurns: 100 },
    },
  });
  readBudget.mockResolvedValue({
    snapshot: { elapsedMs: 0, providerTurns: 0 },
  });
  scheduleWakeup.mockResolvedValue({ nextWakeAt: new Date("2026-08-02T00:05:00.000Z") });
});

describe("set_goal_mode module tool", () => {
  it("fails closed when no unattended gateway is active", async () => {
    findConfig.mockResolvedValue({ value: "[]" });

    await expect(unattendedGoalTools.set_goal_mode.handler({ taskId: "task-1", on: true }))
      .rejects.toThrow(/requires an active OpenClaw or Hermes unattended channel/);
    expect(activate).not.toHaveBeenCalled();
  });

  it("activates when the Gateway extension has an unattended route", async () => {
    findConfig.mockResolvedValue({
      value: JSON.stringify([
        { active: true, gateway: "openclaw", scope: "unattended" },
      ]),
    });

    const result = await unattendedGoalTools.set_goal_mode.handler({ taskId: "task-1", on: true });

    expect(activate).toHaveBeenCalledWith(expect.anything(), "task-1");
    expect(result).toMatchObject({
      goalMode: true,
      runtimeState: "ACTIVE",
      nextWakeAt: null,
      budget: { elapsedMs: 0, providerTurns: 0 },
      limits: { maxDurationMs: 28_800_000, maxProviderTurns: 100 },
      authorizationGranted: false,
    });
  });

  it("persists a bounded wakeup without changing authorization", async () => {
    findConfig.mockResolvedValue({
      value: JSON.stringify([{ active: true, gateway: "openclaw", scope: "unattended" }]),
    });
    readMode.mockResolvedValue({
      active: true,
      runtime: {
        state: "ACTIVE",
        nextWakeAt: new Date("2026-08-02T00:05:00.000Z"),
        policy: { maxDurationMs: 28_800_000 },
      },
    });

    const result = await unattendedGoalTools.set_goal_mode.handler({
      taskId: "task-1",
      on: true,
      wakeAfterSeconds: 300,
      wakeReason: "Reconcile the external Job",
    });

    expect(scheduleWakeup).toHaveBeenCalledWith({
      taskId: "task-1",
      delaySeconds: 300,
      reason: "Reconcile the external Job",
    }, expect.anything());
    expect(result).toMatchObject({
      nextWakeAt: "2026-08-02T00:05:00.000Z",
      authorizationGranted: false,
    });
  });

  it("can end a run even after the Gateway becomes unavailable", async () => {
    findConfig.mockResolvedValue(null);
    readMode.mockResolvedValue({
      active: false,
      runtime: { state: "ENDED", nextWakeAt: null, policy: null },
    });
    readBudget.mockResolvedValue(null);

    const result = await unattendedGoalTools.set_goal_mode.handler({ taskId: "task-1", on: false });

    expect(end).toHaveBeenCalledWith(expect.anything(), "task-1", "DEACTIVATED");
    expect(result.goalMode).toBe(false);
  });
});
