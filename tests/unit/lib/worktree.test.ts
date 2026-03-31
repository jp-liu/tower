// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing worktree
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

// Mock fs/promises before importing worktree
vi.mock("fs/promises", () => ({
  mkdir: vi.fn(),
}));

import { execSync } from "child_process";
import { mkdir } from "fs/promises";
import { createWorktree } from "@/lib/worktree";

const mockedExecSync = vi.mocked(execSync);
const mockedMkdir = vi.mocked(mkdir);

const LOCAL_PATH = "/home/user/myproject";
const TASK_ID = "clxabc123def";
const BASE_BRANCH = "main";

const expectedWorktreePath = `${LOCAL_PATH}/.worktrees/task-${TASK_ID}`;
const expectedBranch = `task/${TASK_ID}`;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: mkdir succeeds
  mockedMkdir.mockResolvedValue(undefined);
  // Default: empty worktree list (no existing worktrees)
  // Default: empty branch list (branch does not exist)
  mockedExecSync.mockReturnValue("" as never);
});

describe("createWorktree", () => {
  it("creates a new worktree when branch does not exist", async () => {
    // Arrange: worktree list is empty, branch list is empty
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("git worktree list")) return "" as never;
      if (cmd.includes("git branch --list")) return "" as never;
      // git worktree add -b branch path baseBranch
      return "" as never;
    });

    const result = await createWorktree(LOCAL_PATH, TASK_ID, BASE_BRANCH);

    expect(mockedMkdir).toHaveBeenCalledWith(
      `${LOCAL_PATH}/.worktrees`,
      { recursive: true }
    );
    // Should call git worktree list --porcelain
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git worktree list --porcelain",
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 10000 }
    );
    // Should check if branch exists
    expect(mockedExecSync).toHaveBeenCalledWith(
      `git branch --list task/${TASK_ID}`,
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 5000 }
    );
    // Should create with -b flag since branch doesn't exist
    expect(mockedExecSync).toHaveBeenCalledWith(
      `git worktree add -b ${expectedBranch} "${expectedWorktreePath}" ${BASE_BRANCH}`,
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 30000 }
    );
    expect(result).toEqual({ worktreePath: expectedWorktreePath, worktreeBranch: expectedBranch });
  });

  it("reuses existing worktree when git worktree list contains target path", async () => {
    // Arrange: worktree list contains the target path
    const porcelainOutput = `worktree /other/path\nHEAD abc123\nbranch refs/heads/main\n\nworktree ${expectedWorktreePath}\nHEAD def456\nbranch refs/heads/${expectedBranch}\n`;
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("git worktree list")) return porcelainOutput as never;
      return "" as never;
    });

    const result = await createWorktree(LOCAL_PATH, TASK_ID, BASE_BRANCH);

    // Should check worktree list
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git worktree list --porcelain",
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 10000 }
    );
    // Should NOT call git branch --list or git worktree add (early return)
    const calls = mockedExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("git branch --list"))).toBe(false);
    expect(calls.some((c) => c.includes("git worktree add"))).toBe(false);
    // Returns same paths
    expect(result).toEqual({ worktreePath: expectedWorktreePath, worktreeBranch: expectedBranch });
  });

  it("attaches existing branch without -b flag when branch already exists", async () => {
    // Arrange: worktree list is empty, but branch already exists
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("git worktree list")) return "" as never;
      if (cmd.includes("git branch --list")) return `  task/${TASK_ID}` as never;
      // git worktree add (no -b) — attaches existing branch
      return "" as never;
    });

    const result = await createWorktree(LOCAL_PATH, TASK_ID, BASE_BRANCH);

    // Should attach existing branch WITHOUT -b flag
    expect(mockedExecSync).toHaveBeenCalledWith(
      `git worktree add "${expectedWorktreePath}" ${expectedBranch}`,
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 30000 }
    );
    // Should NOT have been called with -b
    const calls = mockedExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("worktree add -b"))).toBe(false);
    expect(result).toEqual({ worktreePath: expectedWorktreePath, worktreeBranch: expectedBranch });
  });

  it("throws with descriptive message when git worktree add fails", async () => {
    // Arrange: worktree list empty, branch doesn't exist, but add fails
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("git worktree list")) return "" as never;
      if (cmd.includes("git branch --list")) return "" as never;
      // git worktree add fails
      throw new Error("fatal: 'main' is not a commit and a branch 'task/clxabc123def' cannot be created from it");
    });

    await expect(createWorktree(LOCAL_PATH, TASK_ID, BASE_BRANCH)).rejects.toThrow(
      "fatal: 'main' is not a commit"
    );
  });
});
