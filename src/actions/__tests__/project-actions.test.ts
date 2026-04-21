import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    project: { findUnique: vi.fn(), update: vi.fn() },
    taskExecution: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, existsSync: vi.fn(() => false) };
});
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return { ...actual, rename: vi.fn(), mkdir: vi.fn(), readdir: vi.fn() };
});
// Mock dynamic import of session-store
vi.mock("@/lib/pty/session-store", () => ({
  getSession: vi.fn(() => undefined),
}));

import { db } from "@/lib/db";
import { existsSync } from "fs";
import { rename, mkdir, readdir } from "fs/promises";
import { checkMigrationSafety, migrateProjectPath } from "@/actions/project-actions";

const mockExistsSync = vi.mocked(existsSync);
const mockRename = vi.mocked(rename);
const mockMkdir = vi.mocked(mkdir);
const mockReaddir = vi.mocked(readdir);

const mockDb = db as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  taskExecution: { findMany: ReturnType<typeof vi.fn> };
  task: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// checkMigrationSafety
// ---------------------------------------------------------------------------

describe("checkMigrationSafety", () => {
  it("returns safe:false for invalid projectId", async () => {
    const result = await checkMigrationSafety("");
    expect(result).toEqual({ safe: false, reason: expect.any(String) });
  });

  it("returns safe:false when project not found", async () => {
    mockDb.project.findUnique.mockResolvedValue(null);
    const result = await checkMigrationSafety("cxxxxxxxxxxxxxxxxxxxxxx");
    expect(result).toEqual({ safe: false, reason: expect.any(String) });
  });

  it("returns safe:false when running executions exist", async () => {
    mockDb.project.findUnique.mockResolvedValue({ id: "p1", localPath: "/proj" });
    mockDb.taskExecution.findMany.mockResolvedValue([{ id: "ex1" }]);
    const result = await checkMigrationSafety("p1");
    expect(result.safe).toBe(false);
    expect(result).toHaveProperty("reason");
  });

  it("returns safe:true when no blockers", async () => {
    mockDb.project.findUnique.mockResolvedValue({ id: "p1", localPath: "/proj" });
    mockDb.taskExecution.findMany.mockResolvedValue([]);
    mockDb.task.findMany.mockResolvedValue([]);
    mockExistsSync.mockReturnValue(false);
    const result = await checkMigrationSafety("p1");
    expect(result).toEqual({ safe: true });
  });

  // FS mock interception issue — vitest resolves fs→node:fs internally
  it.todo("returns safe:false when worktrees exist");
});

// ---------------------------------------------------------------------------
// migrateProjectPath
// ---------------------------------------------------------------------------

describe("migrateProjectPath", () => {
  it("rejects invalid projectId", async () => {
    const result = await migrateProjectPath("", "/target");
    expect(result).toEqual({ success: false, error: expect.any(String) });
  });

  it("rejects non-absolute target path", async () => {
    const result = await migrateProjectPath("p1", "relative/path");
    expect(result).toEqual({ success: false, error: expect.any(String) });
  });

  it("rejects same source and target", async () => {
    mockDb.project.findUnique.mockResolvedValue({ id: "p1", localPath: "/proj" });
    const result = await migrateProjectPath("p1", "/proj");
    expect(result).toEqual({ success: false, error: expect.any(String) });
  });

  it("rejects when running executions exist", async () => {
    mockDb.project.findUnique.mockResolvedValue({ id: "p1", localPath: "/proj" });
    mockDb.taskExecution.findMany.mockResolvedValue([{ id: "ex1" }]);
    const result = await migrateProjectPath("p1", "/new-proj");
    expect(result.success).toBe(false);
  });

  it("rejects non-empty target directory", async () => {
    mockDb.project.findUnique.mockResolvedValue({ id: "p1", localPath: "/proj" });
    mockDb.taskExecution.findMany.mockResolvedValue([]);
    mockDb.task.findMany.mockResolvedValue([]);
    mockExistsSync.mockImplementation((p: unknown) => String(p).includes("new-proj"));
    mockReaddir.mockResolvedValue(["file.txt"] as any);
    const result = await migrateProjectPath("p1", "/new-proj");
    expect(result.success).toBe(false);
  });

  // FS mock interception issue — vitest resolves fs→node:fs internally
  it.todo("succeeds with atomic rename + DB update");
  it.todo("returns EXDEV error for cross-device rename");
});
