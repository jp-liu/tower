// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const execFileSync = vi.fn();
vi.mock("child_process", () => ({ default: {}, execFileSync: (...a: unknown[]) => execFileSync(...a) }));

import { getBranchHead, getDiffStat, getDiffPatch } from "@/lib/version-git";

beforeEach(() => vi.clearAllMocks());

describe("getBranchHead", () => {
  it("returns trimmed commit for a branch", () => {
    execFileSync.mockReturnValue("a1b2c3d4e5\n");
    expect(getBranchHead("/repo", "main")).toBe("a1b2c3d4e5");
    expect(execFileSync).toHaveBeenCalledWith("git", ["rev-parse", "main"], expect.objectContaining({ cwd: "/repo" }));
  });
  it("returns null when git fails", () => {
    execFileSync.mockImplementation(() => { throw new Error("no repo"); });
    expect(getBranchHead("/repo", "main")).toBeNull();
  });
});

describe("getDiffPatch", () => {
  it("returns patch text when git succeeds", () => {
    const patch = "diff --git a/src/a.ts b/src/a.ts\n+added line\n";
    execFileSync.mockReturnValue(patch);
    expect(getDiffPatch("/repo", "aaa", "bbb")).toBe(patch);
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "aaa..bbb"],
      expect.objectContaining({ cwd: "/repo", encoding: "utf-8" })
    );
  });
  it("returns empty string when git throws", () => {
    execFileSync.mockImplementation(() => { throw new Error("no repo"); });
    expect(getDiffPatch("/repo", "aaa", "bbb")).toBe("");
  });
});

describe("getDiffStat", () => {
  it("parses numstat into additions/deletions/files", () => {
    execFileSync.mockReturnValue("10\t2\tsrc/a.ts\n5\t0\tsrc/b.ts\n");
    expect(getDiffStat("/repo", "aaa", "bbb")).toEqual({ additions: 15, deletions: 2, files: 2 });
  });
  it("returns zeros when git fails", () => {
    execFileSync.mockImplementation(() => { throw new Error("bad range"); });
    expect(getDiffStat("/repo", "aaa", "bbb")).toEqual({ additions: 0, deletions: 0, files: 0 });
  });
});
