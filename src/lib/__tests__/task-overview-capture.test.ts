// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  taskFindUnique: vi.fn(),
  executionFindFirst: vi.fn(),
  assetFindMany: vi.fn(),
  noteCreate: vi.fn(),
  generateText: vi.fn(),
  syncFts: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    task: { findUnique: mocks.taskFindUnique },
    taskExecution: { findFirst: mocks.executionFindFirst },
    projectAsset: { findMany: mocks.assetFindMany },
    projectNote: { create: mocks.noteCreate },
  },
}));
vi.mock("@/lib/ai/capability-executor", () => ({ generateCapabilityText: mocks.generateText }));
vi.mock("@/actions/config-actions", () => ({ getConfigValue: vi.fn(async () => "zh") }));
vi.mock("@/lib/fts", () => ({ syncNoteToFts: mocks.syncFts }));
vi.mock("@/lib/task-diff-resolver", () => ({ resolveTaskDiffSource: vi.fn() }));

import { captureTaskOverview } from "../task-overview";

describe("captureTaskOverview fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.taskFindUnique.mockResolvedValue({
      id: "task",
      title: "Implement boundary",
      projectId: "project",
      project: { id: "project", name: "Tower", localPath: null },
    });
    mocks.executionFindFirst.mockResolvedValue({ gitLog: "abc1234 feat: deterministic fallback", worktreePath: null });
    mocks.assetFindMany.mockResolvedValue([]);
    mocks.noteCreate.mockResolvedValue({ id: "note", title: "note", content: "content" });
    mocks.syncFts.mockResolvedValue(undefined);
  });

  it("writes and indexes a fallback note when every summary target fails", async () => {
    mocks.generateText.mockRejectedValue(new Error("provider failed SECRET"));
    await captureTaskOverview("task");
    await vi.waitFor(() => expect(mocks.noteCreate).toHaveBeenCalledTimes(1));
    expect(mocks.noteCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      projectId: "project",
      taskId: "task",
      content: expect.stringContaining("deterministic fallback"),
    }) });
    expect(mocks.syncFts).toHaveBeenCalledTimes(1);
  });

  it("redacts credential canaries from generated overview notes", async () => {
    const canary = "sk-OVERVIEW_CANARY_123456789";
    mocks.generateText.mockResolvedValue(`Summary token=${canary}`);
    await captureTaskOverview("task");
    await vi.waitFor(() => expect(mocks.noteCreate).toHaveBeenCalledTimes(1));

    const payload = JSON.stringify(mocks.noteCreate.mock.calls);
    expect(payload).not.toContain(canary);
    expect(payload).toContain("[REDACTED]");
  });
});
