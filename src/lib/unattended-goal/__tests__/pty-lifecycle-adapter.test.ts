import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { module: "goal-db" } }));
vi.mock("@/lib/unattended-goal/policy", () => ({
  recordUnattendedGoalProgressFact: mocks.record,
}));

import {
  notifyPtyProviderTurnCompleted,
  resetPtyLifecycleObserverForTests,
} from "@/lib/pty/lifecycle";
import { registerUnattendedGoalPtyLifecycle } from "../pty-lifecycle-adapter";

afterEach(() => {
  resetPtyLifecycleObserverForTests();
  vi.clearAllMocks();
});

describe("unattended Goal PTY lifecycle adapter", () => {
  it("persists only provider-confirmed turns with a stable event key", async () => {
    mocks.record.mockResolvedValue({ recorded: true, verdict: null });
    registerUnattendedGoalPtyLifecycle();

    await notifyPtyProviderTurnCompleted("task-1");
    expect(mocks.record).not.toHaveBeenCalled();

    await notifyPtyProviderTurnCompleted("task-1", "exec-1:turn-1");
    expect(mocks.record).toHaveBeenCalledWith({
      taskId: "task-1",
      kind: "PROVIDER_TURN_COMPLETED",
      dedupKey: "provider-turn:task-1:exec-1:turn-1",
    }, { module: "goal-db" });
  });
});
