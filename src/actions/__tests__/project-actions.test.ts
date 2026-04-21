import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecFileFn = vi.hoisted(() => vi.fn());

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
vi.mock("child_process", () => ({
  default: { execFile: mockExecFileFn },
  execFile: mockExecFileFn,
  execFileSync: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  exec: vi.fn(),
}));

import { db } from "@/lib/db";
import { existsSync } from "fs";
import { rename, mkdir, readdir } from "fs/promises";
import { checkMigrationSafety, migrateProjectPath, analyzeProjectDirectory } from "@/actions/project-actions";

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

// ---------------------------------------------------------------------------
// analyzeProjectDirectory
// ---------------------------------------------------------------------------

describe("analyzeProjectDirectory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 1: throws for empty string localPath", async () => {
    await expect(analyzeProjectDirectory("")).rejects.toThrow("无效的本地路径");
  });

  it("Test 2: throws for non-string localPath (null coerced)", async () => {
    // @ts-expect-error testing invalid input
    await expect(analyzeProjectDirectory(null)).rejects.toThrow("无效的本地路径");
  });

  it("Test 3: throws for localPath starting with tilde", async () => {
    await expect(analyzeProjectDirectory("~/my-project")).rejects.toThrow(
      "不支持 ~ 别名，请提供绝对路径"
    );
  });

  it("Test 4: valid absolute path calls execFile with correct args", async () => {
    mockExecFileFn.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null, stdout: string) => void;
      cb(null, "# My Project\n");
      return {} as ReturnType<typeof execFile>;
    });

    await analyzeProjectDirectory("/valid/path");

    expect(mockExecFileFn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["-p", expect.stringContaining("package.json"), "--no-session-persistence", "--max-turns", "1"]),
      expect.objectContaining({ cwd: "/valid/path", timeout: 30000, encoding: "utf-8" }),
      expect.any(Function)
    );
  });

  it("Test 5: valid path resolves with trimmed stdout on success", async () => {
    mockExecFileFn.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null, stdout: string) => void;
      cb(null, "# My Project\n...\n");
      return {} as ReturnType<typeof execFile>;
    });

    const result = await analyzeProjectDirectory("/valid/path");
    expect(result).toBe("# My Project\n...");
  });

  it("Test 6: execFile error propagates as rejection", async () => {
    const execError = new Error("timeout exceeded");
    mockExecFileFn.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error, stdout: string) => void;
      cb(execError, "");
      return {} as ReturnType<typeof execFile>;
    });

    await expect(analyzeProjectDirectory("/valid/path")).rejects.toThrow("timeout exceeded");
  });

  it("Test 7: env object contains exactly PATH, HOME, USER, TMPDIR, TERM and NOT DATABASE_URL", async () => {
    mockExecFileFn.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: null, stdout: string) => void;
      cb(null, "result");
      return {} as ReturnType<typeof execFile>;
    });

    await analyzeProjectDirectory("/valid/path");

    const callOptions = mockExecFileFn.mock.calls[0][2] as { env: Record<string, unknown> };
    const envKeys = Object.keys(callOptions.env);
    expect(envKeys).toEqual(expect.arrayContaining(["PATH", "HOME", "USER", "TMPDIR", "TERM"]));
    expect(envKeys).not.toContain("DATABASE_URL");
    expect(envKeys).not.toContain("NODE_OPTIONS");
    // Exactly those 5 keys
    expect(envKeys.length).toBe(5);
  });
});
