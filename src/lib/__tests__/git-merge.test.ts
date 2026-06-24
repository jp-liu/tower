import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mergeBranchIntoBase } from "@/lib/git-merge";

/**
 * Real-git integration tests for mergeBranchIntoBase. The regression we guard
 * against: a clean working tree (nothing to stash) must NOT abort the merge
 * with "No stash entries found" / get reported as "Merge failed".
 */
describe("mergeBranchIntoBase", () => {
  let repo: string;

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf-8" }).trim();

  const commitFile = (name: string, content: string, message: string) => {
    writeFileSync(join(repo, name), content);
    git("add", name);
    git("commit", "-m", message);
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "tower-merge-test-"));
    git("init", "-b", "main");
    git("config", "user.email", "test@tower.local");
    git("config", "user.name", "Tower Test");
    // Base commit on main.
    commitFile("README.md", "base\n", "init");
    // Task branch with one extra commit.
    git("checkout", "-b", "task/abc");
    commitFile("feature.txt", "feature work\n", "feat: add feature");
    git("checkout", "main");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("merges a clean worktree without throwing (the regression case)", () => {
    // main is clean, currently checked out — exactly the reported scenario.
    const { commitHash } = mergeBranchIntoBase({
      localPath: repo,
      baseBranch: "main",
      worktreeBranch: "task/abc",
    });

    expect(commitHash).toMatch(/^[0-9a-f]{7,}$/);
    // Base branch now contains the task's file.
    expect(readFileSync(join(repo, "feature.txt"), "utf-8")).toBe(
      "feature work\n"
    );
    // No stash was created or left behind.
    expect(git("stash", "list")).toBe("");
  });

  it("merges when checked out on a different branch and restores it", () => {
    // Simulate non-worktree mode: sitting on the task branch (clean, all
    // committed) and merging it into main.
    git("checkout", "task/abc");

    const { commitHash } = mergeBranchIntoBase({
      localPath: repo,
      baseBranch: "main",
      worktreeBranch: "task/abc",
    });

    expect(commitHash).toMatch(/^[0-9a-f]{7,}$/);
    // Original branch restored.
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("task/abc");
    // main advanced to include the merge.
    expect(git("branch", "--contains", "main").includes("main")).toBe(true);
    expect(git("stash", "list")).toBe("");
  });

  it("preserves uncommitted tracked changes via stash round-trip", () => {
    // Dirty the main checkout with a tracked modification before merging.
    writeFileSync(join(repo, "README.md"), "base\nlocal edit\n");
    expect(git("status", "--porcelain")).not.toBe("");

    const { commitHash } = mergeBranchIntoBase({
      localPath: repo,
      baseBranch: "main",
      worktreeBranch: "task/abc",
    });

    expect(commitHash).toMatch(/^[0-9a-f]{7,}$/);
    // The local edit is popped back into the working tree.
    expect(readFileSync(join(repo, "README.md"), "utf-8")).toBe(
      "base\nlocal edit\n"
    );
    // Merge still landed.
    expect(readFileSync(join(repo, "feature.txt"), "utf-8")).toBe(
      "feature work\n"
    );
    // Stash consumed by the pop.
    expect(git("stash", "list")).toBe("");
  });

  it("does not report merge failure when the autostash pop conflicts", () => {
    // Local uncommitted edit to README on the same lines the task branch also
    // changed. The merge will rewrite README, so the post-merge `git stash pop`
    // conflicts. That cleanup failure must NOT be surfaced as a merge failure —
    // the merge itself already succeeded.
    git("checkout", "task/abc");
    writeFileSync(join(repo, "README.md"), "base\ntask edit\n");
    git("add", "README.md");
    git("commit", "-m", "task: edit readme");
    git("checkout", "main");

    // Uncommitted local change to the same file in the main checkout.
    writeFileSync(join(repo, "README.md"), "base\nlocal edit\n");
    expect(git("status", "--porcelain")).not.toBe("");

    let result: { commitHash: string } | undefined;
    expect(() => {
      result = mergeBranchIntoBase({
        localPath: repo,
        baseBranch: "main",
        worktreeBranch: "task/abc",
      });
    }).not.toThrow();

    // Merge landed and a commit hash was returned despite the pop conflict.
    expect(result?.commitHash).toMatch(/^[0-9a-f]{7,}$/);
    expect(readFileSync(join(repo, "feature.txt"), "utf-8")).toBe(
      "feature work\n"
    );
  });

  it("is idempotent when the branch is already merged (no stale stash pop)", () => {
    // First merge.
    mergeBranchIntoBase({
      localPath: repo,
      baseBranch: "main",
      worktreeBranch: "task/abc",
    });
    // Second merge: nothing to do, working tree clean — must not throw.
    expect(() =>
      mergeBranchIntoBase({
        localPath: repo,
        baseBranch: "main",
        worktreeBranch: "task/abc",
      })
    ).not.toThrow();
    expect(git("stash", "list")).toBe("");
  });
});
