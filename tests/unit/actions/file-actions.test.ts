// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as childProcess from "child_process";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("fs/promises");
vi.mock("fs");
vi.mock("child_process");

let mockIgnoreInstance: { add: ReturnType<typeof vi.fn>; ignores: ReturnType<typeof vi.fn> };

vi.mock("ignore", () => {
  return {
    default: vi.fn(() => mockIgnoreInstance),
  };
});

vi.mock("@/lib/fs-security", () => ({
  safeResolvePath: vi.fn((base: string, rel: string) => {
    const nodePath = require("path");
    const resolved = nodePath.resolve(base, rel);
    if (!resolved.startsWith(base)) throw new Error("Path traversal attempt");
    return resolved;
  }),
}));

import {
  listDirectory,
  createFile,
  createDirectory,
  renameEntry,
  deleteEntry,
  getGitStatus,
} from "@/actions/file-actions";
import { safeResolvePath } from "@/lib/fs-security";

function makeDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
  };
}

describe("listDirectory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fresh ignore mock for each test — default: filters .git and node_modules
    mockIgnoreInstance = {
      add: vi.fn().mockReturnThis(),
      ignores: vi.fn((rel: string) => rel === ".git" || rel.startsWith(".git/") || rel === "node_modules"),
    };
    vi.mocked(fsSync.existsSync).mockReturnValue(false);
  });

  it("returns sorted entries with isDirectory flag", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      makeDirent("zebra.ts", false),
      makeDirent("alpha", true),
      makeDirent("beta.ts", false),
    ] as any);

    const entries = await listDirectory("/worktree", ".");
    expect(entries[0].isDirectory).toBe(true);
    expect(entries[0].name).toBe("alpha");
    expect(entries[1].name).toBe("beta.ts");
    expect(entries[2].name).toBe("zebra.ts");
    entries.forEach((e) => {
      expect(e).toHaveProperty("name");
      expect(e).toHaveProperty("relativePath");
      expect(e).toHaveProperty("isDirectory");
    });
  });

  it("filters gitignored entries", async () => {
    vi.mocked(fsSync.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFile).mockResolvedValue("node_modules\n" as any);
    vi.mocked(fs.readdir).mockResolvedValue([
      makeDirent("src", true),
      makeDirent("node_modules", true),
    ] as any);

    const entries = await listDirectory("/worktree", ".");
    const names = entries.map((e) => e.name);
    expect(names).not.toContain("node_modules");
    expect(names).toContain("src");
  });

  it("always filters .git/ directory", async () => {
    vi.mocked(fsSync.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdir).mockResolvedValue([
      makeDirent(".git", true),
      makeDirent("src", true),
    ] as any);

    const entries = await listDirectory("/worktree", ".");
    const names = entries.map((e) => e.name);
    expect(names).not.toContain(".git");
    expect(names).toContain("src");
  });

  it("returns directories before files, then alphabetical", async () => {
    vi.mocked(fsSync.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdir).mockResolvedValue([
      makeDirent("zebra.ts", false),
      makeDirent("mango", true),
      makeDirent("apple.ts", false),
      makeDirent("banana", true),
    ] as any);

    const entries = await listDirectory("/worktree", ".");
    expect(entries[0].name).toBe("banana");
    expect(entries[0].isDirectory).toBe(true);
    expect(entries[1].name).toBe("mango");
    expect(entries[1].isDirectory).toBe(true);
    expect(entries[2].name).toBe("apple.ts");
    expect(entries[2].isDirectory).toBe(false);
    expect(entries[3].name).toBe("zebra.ts");
    expect(entries[3].isDirectory).toBe(false);
  });
});

describe("createFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIgnoreInstance = {
      add: vi.fn().mockReturnThis(),
      ignores: vi.fn(() => false),
    };
  });

  it("creates file at validated path", async () => {
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await createFile("/worktree", "src/new-file.ts");
    expect(safeResolvePath).toHaveBeenCalledWith("/worktree", "src/new-file.ts");
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("new-file.ts"),
      "",
      { flag: "wx" }
    );
  });

  it("throws on path traversal", async () => {
    vi.mocked(safeResolvePath).mockImplementationOnce(() => {
      throw new Error("Path traversal attempt");
    });

    await expect(createFile("/worktree", "../../etc/passwd")).rejects.toThrow(
      "Path traversal attempt"
    );
  });
});

describe("createDirectory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIgnoreInstance = {
      add: vi.fn().mockReturnThis(),
      ignores: vi.fn(() => false),
    };
  });

  it("creates directory recursively", async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);

    await createDirectory("/worktree", "src/new/nested");
    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining("nested"),
      { recursive: true }
    );
  });
});

describe("renameEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIgnoreInstance = {
      add: vi.fn().mockReturnThis(),
      ignores: vi.fn(() => false),
    };
  });

  it("renames entry at validated path", async () => {
    vi.mocked(fs.rename).mockResolvedValue(undefined);

    await renameEntry("/worktree", "old-name.ts", "new-name.ts");

    expect(safeResolvePath).toHaveBeenCalledWith("/worktree", "old-name.ts");
    expect(safeResolvePath).toHaveBeenCalledWith("/worktree", "new-name.ts");
    expect(fs.rename).toHaveBeenCalledWith(
      expect.stringContaining("old-name.ts"),
      expect.stringContaining("new-name.ts")
    );
  });
});

describe("deleteEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIgnoreInstance = {
      add: vi.fn().mockReturnThis(),
      ignores: vi.fn(() => false),
    };
  });

  it("deletes file for valid path", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => false } as any);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);

    await deleteEntry("/worktree", "src/old-file.ts");
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining("old-file.ts"));
  });

  it("refuses to delete .git/ directory", async () => {
    await expect(deleteEntry("/worktree", ".git")).rejects.toThrow(
      "Cannot delete .git directory"
    );
    // stat and unlink/rm should NOT be called
    expect(fs.stat).not.toHaveBeenCalled();
    expect(fs.unlink).not.toHaveBeenCalled();
    expect(fs.rm).not.toHaveBeenCalled();
  });

  it("recursively deletes directories with rm({ recursive: true })", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(fs.rm).mockResolvedValue(undefined);

    await deleteEntry("/worktree", "src/old-dir");
    expect(fs.rm).toHaveBeenCalledWith(
      expect.stringContaining("old-dir"),
      { recursive: true, force: true }
    );
  });
});

describe("getGitStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIgnoreInstance = {
      add: vi.fn().mockReturnThis(),
      ignores: vi.fn(() => false),
    };
  });

  it("parses M, A, D lines from git diff output", async () => {
    vi.mocked(childProcess.execFileSync).mockReturnValue(
      "M\tsrc/modified.ts\nA\tsrc/added.ts\nD\tsrc/deleted.ts\n" as any
    );

    const result = await getGitStatus("/worktree", "main", "task/123");
    expect(result["src/modified.ts"]).toBe("M");
    expect(result["src/added.ts"]).toBe("A");
    expect(result["src/deleted.ts"]).toBe("D");
  });

  it("returns empty map on git error", async () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error("git: not a git repository");
    });

    const result = await getGitStatus("/worktree", "main", "task/123");
    expect(result).toEqual({});
  });

  it("ignores unrecognized status letters", async () => {
    vi.mocked(childProcess.execFileSync).mockReturnValue(
      "M\tsrc/modified.ts\nR100\told.ts\tnew.ts\nA\tsrc/added.ts\n" as any
    );

    const result = await getGitStatus("/worktree", "main", "task/123");
    expect(Object.keys(result)).toHaveLength(2);
    expect(result["src/modified.ts"]).toBe("M");
    expect(result["src/added.ts"]).toBe("A");
  });
});
