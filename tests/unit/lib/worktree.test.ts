// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing worktree
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// Mock fs/promises before importing worktree
vi.mock("fs/promises", () => ({
  mkdir: vi.fn(),
}));

// Mock fs before importing worktree
vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

import { execFileSync } from "child_process";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import { createWorktree, removeWorktree } from "@/lib/worktree";

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedMkdir = vi.mocked(mkdir);
const mockedExistsSync = vi.mocked(existsSync);

const LOCAL_PATH = "/home/user/myproject";
const TASK_ID = "clxabc123def";
const BASE_BRANCH = "main";

const expectedWorktreePath = `${LOCAL_PATH}/.worktrees/task-${TASK_ID}`;
const expectedBranch = `task/${TASK_ID}`;

beforeEach(() => {
  vi.clearAllMocks();
  mockedMkdir.mockResolvedValue(undefined);
  mockedExecFileSync.mockReturnValue("" as never);
});

function findCall(args: string[]): boolean {
  return mockedExecFileSync.mock.calls.some(
    (call) => {
      const [cmd, cmdArgs] = call as [string, string[]];
      return cmd === args[0] && JSON.stringify(cmdArgs) === JSON.stringify(args.slice(1));
    }
  );
}

describe("createWorktree", () => {
  it("creates a new worktree when branch does not exist", async () => {
    mockedExecFileSync.mockReturnValue("" as never);

    const result = await createWorktree(LOCAL_PATH, TASK_ID, BASE_BRANCH);

    expect(mockedMkdir).toHaveBeenCalledWith(
      `${LOCAL_PATH}/.worktrees`,
      { recursive: true }
    );
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git", ["worktree", "list", "--porcelain"],
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 10000 }
    );
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git", ["branch", "--list", expectedBranch],
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 5000 }
    );
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git", ["worktree", "add", "-b", expectedBranch, expectedWorktreePath, BASE_BRANCH],
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 30000 }
    );
    expect(result).toEqual({ worktreePath: expectedWorktreePath, worktreeBranch: expectedBranch });
  });

  it("reuses existing worktree when git worktree list contains target path", async () => {
    const porcelainOutput = `worktree /other/path\nHEAD abc123\nbranch refs/heads/main\n\nworktree ${expectedWorktreePath}\nHEAD def456\nbranch refs/heads/${expectedBranch}\n`;
    mockedExecFileSync.mockReturnValue(porcelainOutput as never);

    const result = await createWorktree(LOCAL_PATH, TASK_ID, BASE_BRANCH);

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git", ["worktree", "list", "--porcelain"],
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 10000 }
    );
    // Should NOT call git branch --list or git worktree add (early return)
    expect(findCall(["git", "branch", "--list", expectedBranch])).toBe(false);
    expect(result).toEqual({ worktreePath: expectedWorktreePath, worktreeBranch: expectedBranch });
  });

  it("attaches existing branch without -b flag when branch already exists", async () => {
    mockedExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
      const argsArr = args as string[] | undefined;
      if (argsArr?.[0] === "worktree" && argsArr?.[1] === "list") return "" as never;
      if (argsArr?.[0] === "branch" && argsArr?.[1] === "--list") return `  task/${TASK_ID}` as never;
      return "" as never;
    });

    const result = await createWorktree(LOCAL_PATH, TASK_ID, BASE_BRANCH);

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git", ["worktree", "add", expectedWorktreePath, expectedBranch],
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 30000 }
    );
    // Should NOT have been called with -b
    expect(findCall(["git", "worktree", "add", "-b", expectedBranch, expectedWorktreePath, BASE_BRANCH])).toBe(false);
    expect(result).toEqual({ worktreePath: expectedWorktreePath, worktreeBranch: expectedBranch });
  });

  it("throws with descriptive message when git worktree add fails", async () => {
    mockedExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
      const argsArr = args as string[] | undefined;
      if (argsArr?.[0] === "worktree" && argsArr?.[1] === "list") return "" as never;
      if (argsArr?.[0] === "branch" && argsArr?.[1] === "--list") return "" as never;
      throw new Error("fatal: 'main' is not a commit and a branch 'task/clxabc123def' cannot be created from it");
    });

    await expect(createWorktree(LOCAL_PATH, TASK_ID, BASE_BRANCH)).rejects.toThrow(
      "fatal: 'main' is not a commit"
    );
  });
});

describe("removeWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExecFileSync.mockReturnValue("" as never);
    mockedExistsSync.mockReturnValue(false);
  });

  it("removes worktree dir and deletes branch when both exist", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
      const argsArr = args as string[] | undefined;
      if (argsArr?.[0] === "branch" && argsArr?.[1] === "--list") return `  task/${TASK_ID}` as never;
      return "" as never;
    });

    await removeWorktree(LOCAL_PATH, TASK_ID);

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git", ["worktree", "remove", expectedWorktreePath, "--force"],
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 30000 }
    );
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git", ["branch", "-D", expectedBranch],
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 5000 }
    );
  });

  it("skips git worktree remove when dir does not exist but still deletes branch", async () => {
    mockedExistsSync.mockReturnValue(false);
    mockedExecFileSync.mockImplementation((cmd: string, args?: readonly string[]) => {
      const argsArr = args as string[] | undefined;
      if (argsArr?.[0] === "branch" && argsArr?.[1] === "--list") return `  task/${TASK_ID}` as never;
      return "" as never;
    });

    await removeWorktree(LOCAL_PATH, TASK_ID);

    expect(findCall(["git", "worktree", "remove", expectedWorktreePath, "--force"])).toBe(false);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git", ["branch", "-D", expectedBranch],
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 5000 }
    );
  });

  it("skips git branch -D when branch does not exist", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExecFileSync.mockReturnValue("" as never);

    await removeWorktree(LOCAL_PATH, TASK_ID);

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git", ["worktree", "remove", expectedWorktreePath, "--force"],
      { cwd: LOCAL_PATH, encoding: "utf-8", timeout: 30000 }
    );
    expect(findCall(["git", "branch", "-D", expectedBranch])).toBe(false);
  });

  it("is a no-op when neither dir nor branch exist", async () => {
    mockedExistsSync.mockReturnValue(false);
    mockedExecFileSync.mockReturnValue("" as never);

    await removeWorktree(LOCAL_PATH, TASK_ID);

    expect(findCall(["git", "worktree", "remove", expectedWorktreePath, "--force"])).toBe(false);
    expect(findCall(["git", "branch", "-D", expectedBranch])).toBe(false);
    expect(findCall(["git", "branch", "--list", expectedBranch])).toBe(true);
  });
});
