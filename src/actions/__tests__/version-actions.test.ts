import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    version: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
    project: { findUnique: vi.fn() },
    task: { updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn((globalThis as any).__tx)),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/version-git", () => ({
  getBranchHead: vi.fn(() => "deadbeef"),
  getDiffStat: vi.fn(() => ({ additions: 0, deletions: 0, files: 0 })),
  getDiffPatch: vi.fn(() => "diff --git a/x.ts b/x.ts\n+hello\n"),
}));

import { db } from "@/lib/db";
import { getBranchHead, getDiffStat, getDiffPatch } from "@/lib/version-git";
import { createVersion, getProjectVersions, setCurrentVersion, assignTaskVersion, releaseVersion, getVersionDiffStat, getVersionDiff } from "@/actions/version-actions";

beforeEach(() => vi.clearAllMocks());

describe("createVersion", () => {
  it("captures baseCommit from baseBranch when project has localPath", async () => {
    (db.project.findUnique as any).mockResolvedValue({ id: "p1", localPath: "/repo" });
    (db.version.create as any).mockResolvedValue({ id: "v1" });
    await createVersion({ projectId: "p1", number: "v1.1", name: "导出", baseBranch: "main" });
    expect(getBranchHead).toHaveBeenCalledWith("/repo", "main");
    expect((db.version.create as any).mock.calls[0][0].data.baseCommit).toBe("deadbeef");
  });

  it("skips baseCommit when no localPath", async () => {
    (db.project.findUnique as any).mockResolvedValue({ id: "p1", localPath: null });
    (db.version.create as any).mockResolvedValue({ id: "v1" });
    await createVersion({ projectId: "p1", number: "v1.1", name: "导出", baseBranch: "main" });
    expect(getBranchHead).not.toHaveBeenCalled();
    expect((db.version.create as any).mock.calls[0][0].data.baseCommit).toBeNull();
  });
});

describe("getProjectVersions", () => {
  it("queries versions ordered for the project", async () => {
    (db.version.findMany as any).mockResolvedValue([]);
    await getProjectVersions("p1");
    expect((db.version.findMany as any).mock.calls[0][0].where).toEqual({ projectId: "p1" });
  });
});

describe("setCurrentVersion", () => {
  it("clears other current flags in the project then sets this one", async () => {
    const tx = { version: { update: vi.fn().mockResolvedValue({ projectId: "p1" }), updateMany: vi.fn() } };
    (globalThis as any).__tx = tx;
    (db.version.findUnique as any).mockResolvedValue({ id: "v1", projectId: "p1" });
    await setCurrentVersion("v1");
    expect(tx.version.updateMany).toHaveBeenCalledWith({ where: { projectId: "p1", isCurrent: true }, data: { isCurrent: false } });
    expect(tx.version.update).toHaveBeenCalledWith({ where: { id: "v1" }, data: { isCurrent: true, status: "ACTIVE" } });
  });
});

describe("assignTaskVersion", () => {
  it("sets versionId on the task", async () => {
    (db.task.updateMany as any).mockResolvedValue({ count: 1 });
    await assignTaskVersion("t1", "v2");
    expect((db.task.updateMany as any)).toHaveBeenCalledWith({ where: { id: "t1" }, data: { versionId: "v2" } });
  });
  it("clears versionId when passed null (backlog)", async () => {
    (db.task.updateMany as any).mockResolvedValue({ count: 1 });
    await assignTaskVersion("t1", null);
    expect((db.task.updateMany as any)).toHaveBeenCalledWith({ where: { id: "t1" }, data: { versionId: null } });
  });
});

describe("getVersionDiffStat", () => {
  it("uses baseCommit..releaseCommit when released", async () => {
    (db.version.findUnique as any).mockResolvedValue({
      baseCommit: "aaa", releaseCommit: "bbb", baseBranch: "main", project: { localPath: "/repo" },
    });
    (getDiffStat as any).mockReturnValue({ additions: 9, deletions: 1, files: 3 });
    const r = await getVersionDiffStat("v1");
    expect(getDiffStat).toHaveBeenCalledWith("/repo", "aaa", "bbb");
    expect(r).toEqual({ additions: 9, deletions: 1, files: 3 });
  });
  it("uses live HEAD when not released", async () => {
    (db.version.findUnique as any).mockResolvedValue({
      baseCommit: "aaa", releaseCommit: null, baseBranch: "main", project: { localPath: "/repo" },
    });
    await getVersionDiffStat("v1");
    expect(getBranchHead).toHaveBeenCalledWith("/repo", "main");
  });
  it("returns null when baseCommit missing", async () => {
    (db.version.findUnique as any).mockResolvedValue({ baseCommit: null, project: { localPath: "/repo" } });
    expect(await getVersionDiffStat("v1")).toBeNull();
  });
});

describe("getVersionDiff", () => {
  it("calls getDiffPatch with localPath, baseCommit, and releaseCommit when released", async () => {
    (db.version.findUnique as any).mockResolvedValue({
      baseCommit: "abc", releaseCommit: "def", baseBranch: "main", project: { localPath: "/repo" },
    });
    (getDiffPatch as any).mockReturnValue("diff text");
    const r = await getVersionDiff("v1");
    expect(getDiffPatch).toHaveBeenCalledWith("/repo", "abc", "def");
    expect(r).toEqual({ patch: "diff text" });
  });
  it("resolves to from branch HEAD when no releaseCommit", async () => {
    (db.version.findUnique as any).mockResolvedValue({
      baseCommit: "abc", releaseCommit: null, baseBranch: "main", project: { localPath: "/repo" },
    });
    (getDiffPatch as any).mockReturnValue("patch text");
    await getVersionDiff("v1");
    // getBranchHead mocked to return "deadbeef"
    expect(getDiffPatch).toHaveBeenCalledWith("/repo", "abc", "deadbeef");
  });
  it("returns null when baseCommit is missing", async () => {
    (db.version.findUnique as any).mockResolvedValue({
      baseCommit: null, releaseCommit: null, baseBranch: "main", project: { localPath: "/repo" },
    });
    const r = await getVersionDiff("v1");
    expect(r).toBeNull();
    expect(getDiffPatch).not.toHaveBeenCalled();
  });
});

describe("releaseVersion", () => {
  it("marks released, captures releaseCommit, rolls unfinished tasks, sets next current", async () => {
    (db.version.findUnique as any)
      .mockResolvedValueOnce({ id: "v1", projectId: "p1", baseBranch: "main", project: { localPath: "/repo" } })
      .mockResolvedValueOnce({ id: "v2", projectId: "p1" });
    const tx = {
      version: { update: vi.fn().mockResolvedValue({}), updateMany: vi.fn() },
      task: { updateMany: vi.fn() },
    };
    (globalThis as any).__tx = tx;
    await releaseVersion("v1", "v2");
    expect(tx.version.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "v1" },
      data: expect.objectContaining({ status: "RELEASED", releaseCommit: "deadbeef" }),
    }));
    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: { versionId: "v1", status: { notIn: ["DONE", "CANCELLED"] } },
      data: { versionId: "v2" },
    });
    expect(tx.version.updateMany).toHaveBeenCalledWith({ where: { projectId: "p1", isCurrent: true }, data: { isCurrent: false } });
    expect(tx.version.update).toHaveBeenCalledWith({ where: { id: "v2" }, data: { isCurrent: true, status: "ACTIVE" } });
  });

  it("rejects a next version from a different project", async () => {
    (db.version.findUnique as any)
      .mockResolvedValueOnce({ id: "v1", projectId: "p1", baseBranch: "main", project: { localPath: "/repo" } })
      .mockResolvedValueOnce({ id: "v2", projectId: "OTHER" });
    await expect(releaseVersion("v1", "v2")).rejects.toThrow("同一项目");
  });

  it("rejects releasing an already-released version", async () => {
    (db.version.findUnique as any).mockResolvedValueOnce({
      id: "v1", projectId: "p1", status: "RELEASED", baseBranch: "main", project: { localPath: "/repo" },
    });
    await expect(releaseVersion("v1", "v2")).rejects.toThrow("已发布");
  });

  it("rejects a released next version", async () => {
    (db.version.findUnique as any)
      .mockResolvedValueOnce({ id: "v1", projectId: "p1", status: "ACTIVE", baseBranch: "main", project: { localPath: "/repo" } })
      .mockResolvedValueOnce({ id: "v2", projectId: "p1", status: "RELEASED" });
    await expect(releaseVersion("v1", "v2")).rejects.toThrow("目标版本已发布");
  });
});
