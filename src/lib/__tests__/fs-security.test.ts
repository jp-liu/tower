import path from "path";
import { describe, expect, it } from "vitest";
import { safeResolvePath } from "@/lib/fs-security";

describe("safeResolvePath", () => {
  describe("posix", () => {
    const base = "/home/user/repo/.worktrees/task-1";

    it("resolves a nested relative path", () => {
      expect(safeResolvePath(base, "docs/design.md", path.posix)).toBe(
        `${base}/docs/design.md`
      );
    });

    it("allows non-ASCII (Chinese) filenames", () => {
      const rel = "docs/BE2-学生明细与特教校级标记-设计.md";
      expect(safeResolvePath(base, rel, path.posix)).toBe(`${base}/${rel}`);
    });

    it("allows the base itself ('.')", () => {
      expect(safeResolvePath(base, ".", path.posix)).toBe(base);
    });

    it("rejects parent traversal", () => {
      expect(() => safeResolvePath(base, "../../etc/passwd", path.posix)).toThrow(
        /Path traversal attempt/
      );
    });

    it("rejects an absolute escape", () => {
      expect(() => safeResolvePath(base, "/etc/passwd", path.posix)).toThrow(
        /Path traversal attempt/
      );
    });

    it("does not treat a sibling prefix as inside the base", () => {
      // "/home/user/repo/.worktrees/task-1-evil" must NOT be considered inside
      // "/home/user/repo/.worktrees/task-1" — the old startsWith check was fine
      // here, but path.relative guards it regardless.
      expect(() =>
        safeResolvePath(base, "../task-1-evil/secret", path.posix)
      ).toThrow(/Path traversal attempt/);
    });
  });

  describe("win32 (regression: forward-slash / drive-case mismatch)", () => {
    it("accepts a base with forward slashes and a forward-slash relative path", () => {
      // Reproduces the reported bug: worktree base stored POSIX-style while
      // path.resolve emits backslashes — the old startsWith comparison failed.
      const base = "D:/repo/.worktrees/task-1";
      const rel = "docs/BE2-学生明细与特教校级标记-设计.md";
      const out = safeResolvePath(base, rel, path.win32);
      expect(out).toBe("D:\\repo\\.worktrees\\task-1\\docs\\BE2-学生明细与特教校级标记-设计.md");
    });

    it("accepts a mixed-separator relative path", () => {
      const base = "D:\\repo\\.worktrees\\task-1";
      const out = safeResolvePath(base, "docs/sub\\file.md", path.win32);
      expect(out).toBe("D:\\repo\\.worktrees\\task-1\\docs\\sub\\file.md");
    });

    it("ignores drive-letter casing differences", () => {
      const base = "d:\\repo\\.worktrees\\task-1";
      const out = safeResolvePath(base, "docs/design.md", path.win32);
      // path.relative on win32 compares case-insensitively, so this is allowed.
      expect(out.toLowerCase()).toBe(
        "d:\\repo\\.worktrees\\task-1\\docs\\design.md"
      );
    });

    it("still rejects parent traversal on win32", () => {
      const base = "D:/repo/.worktrees/task-1";
      expect(() =>
        safeResolvePath(base, "..\\..\\Windows\\System32", path.win32)
      ).toThrow(/Path traversal attempt/);
    });

    it("rejects a different-drive absolute path", () => {
      const base = "D:/repo/.worktrees/task-1";
      expect(() => safeResolvePath(base, "C:\\Windows", path.win32)).toThrow(
        /Path traversal attempt/
      );
    });
  });
});
