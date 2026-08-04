// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findConfig, activate, end } = vi.hoisted(() => ({
  findConfig: vi.fn(),
  activate: vi.fn(),
  end: vi.fn(),
}));
vi.mock("../../db", () => ({
  db: { systemConfig: { findUnique: findConfig } },
}));

vi.mock("@/lib/unattended-goal/runtime", () => ({
  activateUnattendedGoal: activate,
  endUnattendedGoal: end,
}));

import { unattendedGoalTools } from "../unattended-goal-tools";

beforeEach(() => {
  vi.clearAllMocks();
  activate.mockResolvedValue({ active: true, state: "ACTIVE" });
  end.mockResolvedValue({ active: false, state: "ENDED" });
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
      authorizationGranted: false,
    });
  });

  it("can end a run even after the Gateway becomes unavailable", async () => {
    findConfig.mockResolvedValue(null);

    const result = await unattendedGoalTools.set_goal_mode.handler({ taskId: "task-1", on: false });

    expect(end).toHaveBeenCalledWith(expect.anything(), "task-1", "DEACTIVATED");
    expect(result.goalMode).toBe(false);
  });
});
