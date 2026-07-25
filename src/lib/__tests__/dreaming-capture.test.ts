// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateDreamingInsight: vi.fn(),
  taskFindUnique: vi.fn(),
  noteCreate: vi.fn(),
  executionUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    task: { findUnique: mocks.taskFindUnique },
    projectNote: { create: mocks.noteCreate },
    taskExecution: { update: mocks.executionUpdate },
  },
}));
vi.mock("@/lib/claude-session", () => ({
  generateDreamingInsight: mocks.generateDreamingInsight,
  generateSummaryFromLog: vi.fn(),
}));
vi.mock("child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("fs", () => ({ existsSync: vi.fn(() => false) }));

import { captureTaskDreaming } from "../execution-summary";

describe("captureTaskDreaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.taskFindUnique.mockResolvedValue({
      projectId: "project",
      executions: [{ id: "execution", terminalLog: "completed work", worktreePath: null, summary: "done" }],
    });
  });

  it("skips note creation when all dreaming targets fail", async () => {
    mocks.generateDreamingInsight.mockRejectedValue(new Error("provider failed SECRET"));
    await expect(captureTaskDreaming("task")).resolves.toBeUndefined();
    expect(mocks.noteCreate).not.toHaveBeenCalled();
    expect(mocks.executionUpdate).not.toHaveBeenCalled();
  });

  it("creates and binds a note only for a valid positive result", async () => {
    mocks.generateDreamingInsight.mockResolvedValue({
      summary: "Reusable decision",
      insights: [{ type: "decision", content: "Use an explicit boundary." }],
      shouldCreateNote: true,
      noteTitle: "Explicit boundary",
    });
    mocks.noteCreate.mockResolvedValue({ id: "note" });
    mocks.executionUpdate.mockResolvedValue({});
    await captureTaskDreaming("task");
    expect(mocks.noteCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      title: "Explicit boundary",
      projectId: "project",
      taskId: "task",
    }) });
    expect(mocks.executionUpdate).toHaveBeenCalledWith({
      where: { id: "execution" },
      data: { insightNoteId: "note" },
    });
  });

  it("redacts credential canaries from generated dreaming notes", async () => {
    const canary = "sk-DREAMING_CANARY_123456789";
    mocks.generateDreamingInsight.mockResolvedValue({
      summary: `token=${canary}`,
      insights: [{ type: "decision", content: `Bearer ${canary}` }],
      shouldCreateNote: true,
      noteTitle: `Dream ${canary}`,
    });
    mocks.noteCreate.mockResolvedValue({ id: "note" });
    mocks.executionUpdate.mockResolvedValue({});

    await captureTaskDreaming("task");

    const payload = JSON.stringify(mocks.noteCreate.mock.calls);
    expect(payload).not.toContain(canary);
    expect(payload).toContain("[REDACTED]");
  });
});
