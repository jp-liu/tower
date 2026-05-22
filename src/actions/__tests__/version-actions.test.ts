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
import { createVersion, getProjectVersions, setCurrentVersion } from "@/actions/version-actions";

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
