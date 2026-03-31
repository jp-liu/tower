// @vitest-environment node
import { describe, it, expect } from "vitest";
import { safeResolvePath } from "@/lib/fs-security";

describe("safeResolvePath", () => {
  const base = "/tmp/worktree";

  it("returns resolved path for valid subpath", () => {
    const result = safeResolvePath(base, "src/index.ts");
    expect(result).toBe("/tmp/worktree/src/index.ts");
  });

  it("allows exact base match (relative='.')", () => {
    const result = safeResolvePath(base, ".");
    expect(result).toBe("/tmp/worktree");
  });

  it("throws on path traversal with ../", () => {
    expect(() => safeResolvePath(base, "../etc/passwd")).toThrow("Path traversal");
  });

  it("throws on nested path traversal", () => {
    expect(() => safeResolvePath(base, "sub/../../etc")).toThrow("Path traversal");
  });

  it("works with trailing-slash base", () => {
    const result = safeResolvePath("/tmp/worktree/", "src/file.ts");
    expect(result).toBe("/tmp/worktree/src/file.ts");
  });

  it("does not allow a sibling directory", () => {
    expect(() => safeResolvePath(base, "../worktree2/file.ts")).toThrow("Path traversal");
  });
});
