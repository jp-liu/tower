// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing instrumentation
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// Mock @/lib/db before importing instrumentation
vi.mock("@/lib/db", () => ({
  initDb: vi.fn().mockResolvedValue(undefined),
  db: {
    project: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { execFileSync } from "child_process";
import { initDb, db } from "@/lib/db";

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedInitDb = vi.mocked(initDb);
const mockedFindMany = vi.mocked(db.project.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.NEXT_RUNTIME = "nodejs";
  mockedInitDb.mockResolvedValue(undefined as never);
  mockedFindMany.mockResolvedValue([]);
});

describe("register", () => {
  it("calls initDb and queries GIT projects on startup", async () => {
    const projects = [
      { id: "proj1", name: "Project 1", localPath: "/home/user/proj1" },
      { id: "proj2", name: "Project 2", localPath: "/home/user/proj2" },
    ];
    mockedFindMany.mockResolvedValue(projects as never);

    const { register } = await import("@/instrumentation");
    await register();

    expect(mockedInitDb).toHaveBeenCalledOnce();
    expect(mockedFindMany).toHaveBeenCalledWith({
      where: { type: "GIT", localPath: { not: null } },
      select: { id: true, localPath: true, name: true },
    });
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
    expect(mockedExecFileSync).toHaveBeenCalledWith("git", ["worktree", "prune"], {
      cwd: "/home/user/proj1",
      encoding: "utf-8",
      timeout: 10000,
    });
    expect(mockedExecFileSync).toHaveBeenCalledWith("git", ["worktree", "prune"], {
      cwd: "/home/user/proj2",
      encoding: "utf-8",
      timeout: 10000,
    });
  });

  it("skips prune logic in non-nodejs runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";

    const { register } = await import("@/instrumentation");
    await register();

    expect(mockedInitDb).not.toHaveBeenCalled();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("continues to next project when one prune fails", async () => {
    const projects = [
      { id: "proj1", name: "Project 1", localPath: "/home/user/proj1" },
      { id: "proj2", name: "Project 2", localPath: "/home/user/proj2" },
      { id: "proj3", name: "Project 3", localPath: "/home/user/proj3" },
    ];
    mockedFindMany.mockResolvedValue(projects as never);
    mockedExecFileSync.mockImplementation((_cmd: string, args?: readonly string[], opts?: unknown) => {
      const options = opts as { cwd?: string };
      if (options?.cwd === "/home/user/proj2") {
        throw new Error("git: not a git repository");
      }
      return "" as never;
    });

    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();

    // All three projects should have been attempted
    expect(mockedExecFileSync).toHaveBeenCalledTimes(3);
    expect(mockedExecFileSync).toHaveBeenCalledWith("git", ["worktree", "prune"], {
      cwd: "/home/user/proj1",
      encoding: "utf-8",
      timeout: 10000,
    });
    expect(mockedExecFileSync).toHaveBeenCalledWith("git", ["worktree", "prune"], {
      cwd: "/home/user/proj3",
      encoding: "utf-8",
      timeout: 10000,
    });
  });

  it("handles DB connection failure gracefully without throwing", async () => {
    mockedInitDb.mockRejectedValue(new Error("SQLITE_CANTOPEN: Unable to open database file"));

    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();

    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  it("completes without error when no GIT projects exist", async () => {
    mockedFindMany.mockResolvedValue([]);

    const { register } = await import("@/instrumentation");
    await register();

    expect(mockedInitDb).toHaveBeenCalledOnce();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });
});
