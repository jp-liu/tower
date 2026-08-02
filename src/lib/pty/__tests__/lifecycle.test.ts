import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addPtyLifecycleObserver,
  notifyPtyInputStarted,
  notifyPtyProviderTurnCompleted,
  resetPtyLifecycleObserverForTests,
} from "../lifecycle";

afterEach(() => resetPtyLifecycleObserverForTests());

describe("PTY lifecycle fan-out", () => {
  it("delivers one provider fact to every module observer and supports disposal", async () => {
    const workbenchInput = vi.fn();
    const workbenchCompleted = vi.fn(async () => undefined);
    const goalCompleted = vi.fn(async () => undefined);
    addPtyLifecycleObserver({
      inputStarted: workbenchInput,
      providerTurnCompleted: workbenchCompleted,
    });
    const disposeGoal = addPtyLifecycleObserver({ providerTurnCompleted: goalCompleted });

    notifyPtyInputStarted("task-1");
    await notifyPtyProviderTurnCompleted("task-1", "exec-1:turn-1");

    expect(workbenchInput).toHaveBeenCalledWith("task-1");
    expect(workbenchCompleted).toHaveBeenCalledWith("task-1", "exec-1:turn-1");
    expect(goalCompleted).toHaveBeenCalledWith("task-1", "exec-1:turn-1");

    disposeGoal();
    await notifyPtyProviderTurnCompleted("task-1", "exec-1:turn-2");
    expect(workbenchCompleted).toHaveBeenCalledTimes(2);
    expect(goalCompleted).toHaveBeenCalledTimes(1);
  });
});
