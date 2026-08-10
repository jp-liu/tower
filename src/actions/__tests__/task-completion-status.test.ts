import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  taskFindUnique: vi.fn(),
  taskUpdate: vi.fn(),
  executionUpdateMany: vi.fn(),
  executionFindFirst: vi.fn(),
  executionUpdate: vi.fn(),
  completeWorktreeReturn: vi.fn(),
  getRecordedWorktreeBranch: vi.fn(),
  destroySession: vi.fn(),
  removeWorktree: vi.fn(),
  endUnattendedGoalIfActive: vi.fn(),
  captureTaskOverview: vi.fn(),
  captureTaskDreaming: vi.fn(),
  events: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findUnique: mocks.taskFindUnique,
      update: mocks.taskUpdate,
    },
    taskExecution: {
      updateMany: mocks.executionUpdateMany,
      findFirst: mocks.executionFindFirst,
      update: mocks.executionUpdate,
    },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/task-completion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/task-completion")>();
  return {
    ...actual,
    completeWorktreeReturn: mocks.completeWorktreeReturn,
    getRecordedWorktreeBranch: mocks.getRecordedWorktreeBranch,
  };
});
vi.mock("@/lib/pty/session-store", () => ({ destroySession: mocks.destroySession }));
vi.mock("@/lib/worktree", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/worktree")>();
  return { ...actual, removeWorktree: mocks.removeWorktree };
});
vi.mock("@/lib/unattended-goal/runtime", () => ({
  endUnattendedGoalIfActive: mocks.endUnattendedGoalIfActive,
}));
vi.mock("@/lib/task-overview", () => ({ captureTaskOverview: mocks.captureTaskOverview }));
vi.mock("@/lib/execution-summary", () => ({ captureTaskDreaming: mocks.captureTaskDreaming }));

import { updateTaskStatus } from "@/actions/task-actions";
import { MergeConflictError } from "@/lib/task-completion";

const TASK_ID = "ctaskcompletionstatus001";
const worktreeTask = {
  id: TASK_ID,
  status: "IN_PROGRESS",
  baseBranch: "main",
  project: { localPath: "/repo" },
};

describe("updateTaskStatus completion ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.taskFindUnique.mockResolvedValue(worktreeTask);
    mocks.taskUpdate.mockImplementation(async ({ data }: { data: { status: string } }) => {
      mocks.events.push("task-status");
      return { ...worktreeTask, status: data.status };
    });
    mocks.executionUpdateMany.mockImplementation(async () => {
      mocks.events.push("execution-completed");
      return { count: 1 };
    });
    mocks.executionFindFirst.mockResolvedValue(null);
    mocks.completeWorktreeReturn.mockImplementation(async () => {
      mocks.events.push("merge-completed");
      return { completed: true };
    });
    mocks.getRecordedWorktreeBranch.mockResolvedValue(`task/${TASK_ID}`);
    mocks.removeWorktree.mockResolvedValue(undefined);
    mocks.endUnattendedGoalIfActive.mockResolvedValue(undefined);
    mocks.captureTaskOverview.mockResolvedValue(undefined);
  });

  it("keeps a RUNNING execution and PTY untouched when worktree merge conflicts", async () => {
    mocks.completeWorktreeReturn.mockRejectedValue(
      new MergeConflictError(["src/conflicted.ts"], "main"),
    );

    await expect(updateTaskStatus(TASK_ID, "DONE")).rejects.toBeInstanceOf(MergeConflictError);

    expect(mocks.executionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
    expect(mocks.destroySession).not.toHaveBeenCalled();
    expect(mocks.removeWorktree).not.toHaveBeenCalled();
  });

  it("also preserves the live execution for non-conflict merge failures", async () => {
    mocks.completeWorktreeReturn.mockRejectedValue(new Error("main repository is locked"));

    await expect(updateTaskStatus(TASK_ID, "DONE")).rejects.toThrow("main repository is locked");

    expect(mocks.executionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });

  it("updates the task only after worktree completion has finalized its execution", async () => {
    await updateTaskStatus(TASK_ID, "DONE");

    expect(mocks.events.slice(0, 2)).toEqual([
      "merge-completed",
      "task-status",
    ]);
    expect(mocks.executionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "DONE", doneAt: expect.any(Date) },
    }));
  });

  it("can complete on retry after the agent resolves the conflict", async () => {
    mocks.completeWorktreeReturn
      .mockRejectedValueOnce(new MergeConflictError(["src/conflicted.ts"], "main"))
      .mockImplementationOnce(async () => {
        mocks.events.push("merge-completed");
        return { completed: true };
      });

    await expect(updateTaskStatus(TASK_ID, "DONE")).rejects.toBeInstanceOf(MergeConflictError);
    await expect(updateTaskStatus(TASK_ID, "DONE")).resolves.toMatchObject({ status: "DONE" });

    expect(mocks.executionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.taskUpdate).toHaveBeenCalledTimes(1);
  });

  it("preserves direct DONE finalization and PTY teardown", async () => {
    const directTask = { ...worktreeTask, baseBranch: null, project: { localPath: null } };
    mocks.taskFindUnique.mockResolvedValue(directTask);
    mocks.taskUpdate.mockResolvedValue({ ...directTask, status: "DONE" });

    await updateTaskStatus(TASK_ID, "DONE");

    expect(mocks.completeWorktreeReturn).not.toHaveBeenCalled();
    expect(mocks.executionUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.destroySession).toHaveBeenCalledWith(TASK_ID);
  });

  it("preserves CANCELLED finalization, PTY teardown, and worktree cleanup", async () => {
    mocks.taskUpdate.mockResolvedValue({ ...worktreeTask, status: "CANCELLED" });

    await updateTaskStatus(TASK_ID, "CANCELLED");

    expect(mocks.completeWorktreeReturn).not.toHaveBeenCalled();
    expect(mocks.executionUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.destroySession).toHaveBeenCalledWith(TASK_ID);
    expect(mocks.removeWorktree).toHaveBeenCalledWith(
      "/repo",
      TASK_ID,
      `task/${TASK_ID}`,
    );
  });
});
