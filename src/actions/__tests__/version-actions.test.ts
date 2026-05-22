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
vi.mock("@/lib/version-git", () => ({ getBranchHead: vi.fn(() => "deadbeef"), getDiffStat: vi.fn(() => ({ additions: 0, deletions: 0, files: 0 })) }));

import { db } from "@/lib/db";
import { getBranchHead } from "@/lib/version-git";
import { createVersion, getProjectVersions, setCurrentVersion, assignTaskVersion, releaseVersion } from "@/actions/version-actions";

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

describe("releaseVersion", () => {
  it("marks released, captures releaseCommit, rolls unfinished tasks, sets next current", async () => {
    (db.version.findUnique as any).mockResolvedValue({
      id: "v1", projectId: "p1", baseBranch: "main",
      project: { localPath: "/repo" },
    });
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
});
