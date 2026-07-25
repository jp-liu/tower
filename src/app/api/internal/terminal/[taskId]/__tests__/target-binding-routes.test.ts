import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  continueOrStart: vi.fn(),
}));

vi.mock("@/actions/agent-actions", () => ({
  startPtyExecution: mocks.start,
  continueOrStartTaskExecution: mocks.continueOrStart,
}));
vi.mock("@/lib/internal-api-guard", () => ({
  requireLocalhost: vi.fn(() => null),
  validateTaskId: vi.fn(() => null),
}));

import { POST as startPost } from "../start/route";
import { POST as resumePost } from "../resume/route";

const binding = {
  executionId: "execution-1",
  worktreePath: "/tmp/worktree",
  connectionId: "connection-1",
  modelId: "model-1",
  targetId: "target-1",
};

describe("internal terminal target binding routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the selected binding from start", async () => {
    mocks.start.mockResolvedValue(binding);
    const response = await startPost(
      new Request("http://localhost/api/internal/terminal/task-1/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "run" }),
      }) as never,
      { params: Promise.resolve({ taskId: "task-1" }) },
    );

    expect(await response.json()).toEqual(binding);
    expect(mocks.start).toHaveBeenCalledWith("task-1", "run");
  });

  it("returns the fixed binding from continue-or-start", async () => {
    mocks.continueOrStart.mockResolvedValue({ mode: "continued", ...binding });
    const response = await resumePost(
      new Request("http://localhost/api/internal/terminal/task-1/resume", { method: "POST" }) as never,
      { params: Promise.resolve({ taskId: "task-1" }) },
    );

    expect(await response.json()).toEqual({ ok: true, mode: "continued", ...binding });
  });
});
