import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from "fs";
import { tmpdir } from "os";
import path, { join } from "path";
import {
  mergeBranchIntoBase,
  describeGitError,
  runGit,
  resolveGitDir,
  assertMainRepoReady,
} from "@/lib/git-merge";

describe("describeGitError", () => {
  it("prefers stderr over the opaque message", () => {
    const err = {
      message: "Command failed: git stash push -m x",
      stderr: "fatal: Unable to create index.lock: File exists.\n",
      stdout: "",
    };
    expect(describeGitError(err)).toBe(
      "fatal: Unable to create index.lock: File exists."
    );
  });

  it("falls back to stdout, then message, then a default", () => {
    expect(describeGitError({ stdout: "some stdout\n" })).toBe("some stdout");
    expect(describeGitError({ message: "Command failed" })).toBe(
      "Command failed"
    );
    expect(describeGitError({})).toBe("unknown git error");
    expect(describeGitError(null)).toBe("unknown git error");
  });

  it("handles Buffer stderr", () => {
    expect(describeGitError({ stderr: Buffer.from("boom\n") })).toBe("boom");
  });
});

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tower-git-merge-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(path.join(dir, "a.txt"), "hello\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
  return dir;
}

describe("runGit", () => {
  let repo: string;
  beforeEach(() => {
    repo = initRepo();
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("returns trimmed stdout on success", () => {
    const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], repo);
    expect(branch.length).toBeGreaterThan(0);
    expect(branch).not.toMatch(/\n$/);
  });

  it("throws the real git stderr instead of 'Command failed'", () => {
    expect(() => runGit(["stash", "pop"], repo)).toThrow(/no stash|No stash/i);
  });
});

describe("resolveGitDir", () => {
  it("resolves the absolute .git dir for a repo", () => {
    const repo = initRepo();
    try {
      const gitDir = resolveGitDir(repo);
      expect(gitDir.endsWith(".git")).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("falls back to <path>/.git when not a repo", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tower-nogit-"));
    try {
      expect(resolveGitDir(dir)).toBe(path.join(dir, ".git"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("assertMainRepoReady", () => {
  let repo: string;
  beforeEach(() => {
    repo = initRepo();
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("passes for a clean repo", () => {
    expect(() => assertMainRepoReady(repo)).not.toThrow();
  });

  it("throws an actionable error when index.lock exists", () => {
    writeFileSync(path.join(repo, ".git", "index.lock"), "");
    expect(() => assertMainRepoReady(repo)).toThrow(/index\.lock/);
  });

  it("throws when a merge is in progress (MERGE_HEAD)", () => {
    writeFileSync(path.join(repo, ".git", "MERGE_HEAD"), "deadbeef\n");
    expect(() => assertMainRepoReady(repo)).toThrow(/merge --abort|MERGE_HEAD/);
  });

  it("throws when a rebase is in progress", () => {
    mkdirSync(path.join(repo, ".git", "rebase-merge"));
    expect(() => assertMainRepoReady(repo)).toThrow(/rebase --abort|rebase/);
  });
});

/**
 * Real-git integration tests for mergeBranchIntoBase. The regression we guard
 * against: a clean working tree (nothing to stash) must NOT abort the merge
 * with "No stash entries found" / get reported as "Merge failed".
 *
 * Timeout raised off vitest's 5s default: each case drives a real repo through
 * ~10 git subprocesses, which intermittently overruns 5s on a loaded machine and
 * fails the whole block on timing rather than behavior.
 */
describe("mergeBranchIntoBase", { timeout: 30_000 }, () => {
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

  /**
   * Sets up a guaranteed `git stash pop` conflict: a local uncommitted edit to
   * the same README lines the task branch also rewrote. The merge replaces
   * README, so popping the autostash back on top conflicts.
   */
  const setupPopConflict = () => {
    git("checkout", "task/abc");
    writeFileSync(join(repo, "README.md"), "base\ntask edit\n");
    git("add", "README.md");
    git("commit", "-m", "task: edit readme");
    git("checkout", "main");

    // Uncommitted local change to the same file in the main checkout.
    writeFileSync(join(repo, "README.md"), "base\nlocal edit\n");
    expect(git("status", "--porcelain")).not.toBe("");
  };

  it("does not report merge failure when the autostash pop conflicts", () => {
    // That cleanup failure must NOT be surfaced as a merge failure — the merge
    // itself already succeeded.
    setupPopConflict();

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

  it("warns the user when the autostash pop conflicts, instead of swallowing it", () => {
    // The regression this guards: the pop failure used to go to console.error
    // only, leaving the user with conflict markers and a stash they were never
    // told about. It must come back as an actionable warning.
    setupPopConflict();

    const { stashPopWarning } = mergeBranchIntoBase({
      localPath: repo,
      baseBranch: "main",
      worktreeBranch: "task/abc",
    });

    expect(stashPopWarning).toBeDefined();
    // Everything the user needs to self-recover: the stash survived, its
    // marker, where to look, and which file conflicted.
    expect(stashPopWarning).toContain("tower-merge-temp");
    expect(stashPopWarning).toContain("git stash list");
    expect(stashPopWarning).toContain("git stash pop");
    expect(stashPopWarning).toContain("README.md");

    // The warning tells the truth: git really did keep the stash entry, and the
    // working tree really is conflicted.
    expect(git("stash", "list")).toContain("tower-merge-temp");
    expect(git("status", "--porcelain")).toMatch(/^UU /m);
  });

  it("reports no warning when the autostash pops cleanly", () => {
    writeFileSync(join(repo, "README.md"), "base\nlocal edit\n");

    const { stashPopWarning } = mergeBranchIntoBase({
      localPath: repo,
      baseBranch: "main",
      worktreeBranch: "task/abc",
    });

    expect(stashPopWarning).toBeUndefined();
    expect(git("stash", "list")).toBe("");
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

  it("surfaces a friendly error when index.lock blocks the autostash", () => {
    // Dirty tracked change so the helper attempts to stash, then plant a stale
    // lock so `git stash push` fails. The opaque "Command failed" must become
    // an actionable message.
    writeFileSync(join(repo, "README.md"), "base\nlocal edit\n");
    writeFileSync(join(repo, ".git", "index.lock"), "");

    expect(() =>
      mergeBranchIntoBase({
        localPath: repo,
        baseBranch: "main",
        worktreeBranch: "task/abc",
      })
    ).toThrow(/index\.lock/);
  });
});
