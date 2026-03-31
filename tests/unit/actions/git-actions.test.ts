// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";

let getProjectBranchesFn: (localPath: string) => Promise<string[]>;

beforeAll(async () => {
  // Dynamic import: git-actions.ts uses "use server" directive
  const mod = await import("@/actions/git-actions");
  getProjectBranchesFn = mod.getProjectBranches;
});

describe("getProjectBranches", () => {
  it("returns an array containing 'main' for the current project root", async () => {
    const branches = await getProjectBranchesFn(process.cwd());
    expect(Array.isArray(branches)).toBe(true);
    expect(branches.length).toBeGreaterThan(0);
    expect(branches).toContain("main");
  });

  it("returns empty array for empty string input", async () => {
    const branches = await getProjectBranchesFn("");
    expect(branches).toEqual([]);
  });

  it("returns empty array for nonexistent path without throwing", async () => {
    const branches = await getProjectBranchesFn("/nonexistent/path/xyz");
    expect(branches).toEqual([]);
  });

  it("returns empty array for whitespace-only input", async () => {
    const branches = await getProjectBranchesFn("   ");
    expect(branches).toEqual([]);
  });
});
