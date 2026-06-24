import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  describeGitError,
  runGit,
  resolveGitDir,
  assertMainRepoReady,
} from "@/lib/git-merge";

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
    expect(describeGitError({ message: "Command failed" })).toBe("Command failed");
    expect(describeGitError({})).toBe("unknown git error");
    expect(describeGitError(null)).toBe("unknown git error");
  });

  it("handles Buffer stderr", () => {
    expect(describeGitError({ stderr: Buffer.from("boom\n") })).toBe("boom");
  });
});

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
