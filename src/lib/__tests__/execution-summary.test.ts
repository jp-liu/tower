// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock modules BEFORE imports to ensure correct hoisting
vi.mock("@/lib/db", () => ({
  db: {
    taskExecution: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/claude-session", () => ({
  generateSummaryFromLog: vi.fn().mockResolvedValue(null),
}));

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

import { captureExecutionSummary } from "../execution-summary";
import { db } from "@/lib/db";
import { generateSummaryFromLog } from "@/lib/claude-session";
import { execFileSync } from "child_process";
import { existsSync } from "fs";

// Typed mock helpers
const mockUpdate = vi.mocked(db.taskExecution.update);
const mockGenerateSummaryFromLog = vi.mocked(generateSummaryFromLog);
const mockExecFileSync = vi.mocked(execFileSync);
const mockExistsSync = vi.mocked(existsSync);

// Helper: configure execFileSync to return expected git output based on args
function setupGitMocks(options?: {
  gitDir?: string;
  mergeBase?: string;
  gitLog?: string;
  diffStat?: string;
}) {
  const opts = {
    gitDir: ".git",
    mergeBase: "abc1234567890",
    gitLog: "abc1234 feat: add feature\ndef5678 fix: bug fix",
    diffStat: " 2 files changed, 47 insertions(+), 12 deletions(-)",
    ...options,
  };

  mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
    const gitArgs = args as string[];
    const subcmd = gitArgs[0];

    if (subcmd === "rev-parse" && gitArgs[1] === "--git-dir") {
      return opts.gitDir as unknown as ReturnType<typeof execFileSync>;
    }
    if (subcmd === "merge-base") {
      return opts.mergeBase as unknown as ReturnType<typeof execFileSync>;
    }
    if (subcmd === "log") {
      return opts.gitLog as unknown as ReturnType<typeof execFileSync>;
    }
    if (subcmd === "diff" && gitArgs[1] === "--stat") {
      return opts.diffStat as unknown as ReturnType<typeof execFileSync>;
    }
    return "" as unknown as ReturnType<typeof execFileSync>;
  });
}

describe("captureExecutionSummary", () => {
  const EXEC_ID = "exec-abc123";
  const TASK_ID = "task-xyz456";
  const WORKTREE = "/some/worktree/path";

  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.error noise from the function's own logging
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates DB with git data when worktreePath exists and is a git repo", async () => {
    mockExistsSync.mockReturnValue(true);

    mockGenerateSummaryFromLog.mockResolvedValue("AI summary");
    setupGitMocks();

    await captureExecutionSummary(EXEC_ID, TASK_ID, 0, "terminal output", WORKTREE);

    expect(mockUpdate).toHaveBeenCalled();
    const callData = mockUpdate.mock.calls[0][0];
    expect(callData.where).toEqual({ id: EXEC_ID });
    expect(callData.data.exitCode).toBe(0);
    // sessionId is now reported via PostToolUse hook, not captured here
    expect(callData.data.sessionId).toBeUndefined();
    // Git log and stats should be populated
    expect(callData.data.gitLog).toBeTruthy();
    expect(callData.data.gitStats).toBeTruthy();
    // gitStats is JSON string containing commits, filesChanged etc.
    const parsedStats = JSON.parse(callData.data.gitStats as string);
    expect(parsedStats.filesChanged).toBe(2);
    expect(parsedStats.insertions).toBe(47);
    expect(parsedStats.deletions).toBe(12);
    expect(parsedStats.commits).toBeGreaterThanOrEqual(1);
  });

  it("updates DB without git data when worktreePath is null", async () => {
    await captureExecutionSummary(EXEC_ID, TASK_ID, 1, "some output", null);

    expect(mockUpdate).toHaveBeenCalled();
    const callData = mockUpdate.mock.calls[0][0];
    expect(callData.data.exitCode).toBe(1);
    expect(callData.data.gitLog).toBeNull();
    expect(callData.data.gitStats).toBeNull();
  });

  it("updates DB without git data when worktreePath does not exist on filesystem", async () => {
    mockExistsSync.mockReturnValue(false);

    await captureExecutionSummary(EXEC_ID, TASK_ID, 0, "terminal output", WORKTREE);

    expect(mockUpdate).toHaveBeenCalled();
    const callData = mockUpdate.mock.calls[0][0];
    expect(callData.data.gitLog).toBeNull();
    expect(callData.data.gitStats).toBeNull();
  });

  it("strips ANSI escape codes from terminal buffer before storing terminalLog", async () => {
    const ansiBuffer = "\x1b[31mred text\x1b[0m normal text";

    await captureExecutionSummary(EXEC_ID, TASK_ID, 0, ansiBuffer, null);

    const callData = mockUpdate.mock.calls[0][0];
    const terminalLog = callData.data.terminalLog as string;
    // ANSI sequences should be stripped
    expect(terminalLog).not.toContain("\x1b");
    expect(terminalLog).toContain("red text");
    expect(terminalLog).toContain("normal text");
  });

  it("strips OSC sequences from terminal buffer", async () => {
    const oscBuffer = "\x1b]0;title\x07 visible content";

    await captureExecutionSummary(EXEC_ID, TASK_ID, 0, oscBuffer, null);

    const callData = mockUpdate.mock.calls[0][0];
    const terminalLog = callData.data.terminalLog as string;
    expect(terminalLog).not.toContain("\x1b]");
    expect(terminalLog).toContain("visible content");
  });

  it("trims large terminal buffer to 10KB (last 10KB kept)", async () => {
    // Create a 20KB buffer
    const bigBuffer = "x".repeat(20 * 1024);

    await captureExecutionSummary(EXEC_ID, TASK_ID, 0, bigBuffer, null);

    const callData = mockUpdate.mock.calls[0][0];
    const terminalLog = callData.data.terminalLog as string;
    // After ANSI strip (no ANSI here), should be <= 10KB
    expect(terminalLog.length).toBeLessThanOrEqual(10 * 1024);
  });

  it("stores null for terminalLog when buffer is empty", async () => {
    await captureExecutionSummary(EXEC_ID, TASK_ID, 0, "", null);

    const callData = mockUpdate.mock.calls[0][0];
    expect(callData.data.terminalLog).toBeNull();
  });

  it("does not throw when DB update fails", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("DB connection failed"));

    // Should not throw — captureExecutionSummary is designed to never throw
    await expect(
      captureExecutionSummary(EXEC_ID, TASK_ID, 0, "output", null)
    ).resolves.toBeUndefined();
  });

  it("calls generateSummaryFromLog for background AI summary when terminalLog and worktreePath are present", async () => {
    mockExistsSync.mockReturnValue(true);
    mockGenerateSummaryFromLog.mockResolvedValue("Background AI summary");
    setupGitMocks();

    await captureExecutionSummary(EXEC_ID, TASK_ID, 0, "terminal output", WORKTREE);

    // generateSummaryFromLog should have been called with cleaned terminal log and worktree path
    expect(mockGenerateSummaryFromLog).toHaveBeenCalled();
    const [logArg, pathArg] = mockGenerateSummaryFromLog.mock.calls[0];
    expect(pathArg).toBe(WORKTREE);
    expect(logArg).not.toContain("\x1b");
    expect(logArg).toContain("terminal output");
  });

  it("does not call generateSummaryFromLog when worktreePath is null", async () => {
    await captureExecutionSummary(EXEC_ID, TASK_ID, 0, "terminal output", null);

    expect(mockGenerateSummaryFromLog).not.toHaveBeenCalled();
  });

  it("does not call generateSummaryFromLog when terminal buffer is empty", async () => {
    mockExistsSync.mockReturnValue(true);
    setupGitMocks();

    await captureExecutionSummary(EXEC_ID, TASK_ID, 0, "", WORKTREE);

    expect(mockGenerateSummaryFromLog).not.toHaveBeenCalled();
  });

  it("includes correct exitCode in DB update", async () => {
    await captureExecutionSummary(EXEC_ID, TASK_ID, 42, "output", null);

    const callData = mockUpdate.mock.calls[0][0];
    expect(callData.data.exitCode).toBe(42);
  });

  it("handles git command failure gracefully — git data is null, does not throw", async () => {
    mockExistsSync.mockReturnValue(true);
    // rev-parse throws — not a git repo
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    await expect(
      captureExecutionSummary(EXEC_ID, TASK_ID, 0, "output", WORKTREE)
    ).resolves.toBeUndefined();

    const callData = mockUpdate.mock.calls[0][0];
    expect(callData.data.gitLog).toBeNull();
    expect(callData.data.gitStats).toBeNull();
  });
});
