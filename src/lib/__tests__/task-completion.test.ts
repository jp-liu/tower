import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Record what gets written back to the execution, and stub the side-effect
// imports so the real merge + worktree teardown run against a real repo without
// touching a DB, PTY, or the AI overview pipeline.
const execUpdate = vi.fn();
let latestExecution: { id: string; worktreeBranch: string } | null;

vi.mock("@/lib/db", () => ({
  db: {
    taskExecution: {
      findFirst: vi.fn(async () => latestExecution),
      update: vi.fn(async (args: unknown) => execUpdate(args)),
    },
  },
}));
vi.mock("@/lib/pty/session-store", () => ({ destroySession: vi.fn() }));
vi.mock("@/lib/task-overview", () => ({ captureTaskOverview: vi.fn(async () => {}) }));

import { completeWorktreeReturn, WorktreeDirtyError } from "@/lib/task-completion";

const TASK_ID = "ctaskcompletion0000000001";

/** A main repo with one commit on `main`. */
function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tower-completion-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  writeFileSync(path.join(dir, "a.txt"), "hello\n");
  git("add", ".");
  git("commit", "-qm", "init");
  return dir;
}

/** Adds the task worktree + branch, optionally with a commit on it. */
function addWorktree(repo: string, withCommit: boolean): string {
  const wt = path.join(repo, ".worktrees", "task-" + TASK_ID);
  execFileSync("git", ["worktree", "add", "-q", "-b", `task/${TASK_ID}`, wt, "main"], { cwd: repo });
  if (withCommit) {
    writeFileSync(path.join(wt, "b.txt"), "work\n");
    const git = (...a: string[]) => execFileSync("git", a, { cwd: wt });
    git("add", ".");
    git("commit", "-qm", "task work");
  }
  return wt;
}

describe("completeWorktreeReturn", () => {
  let repo: string;
  beforeEach(() => {
    execUpdate.mockReset();
    latestExecution = { id: "exec1", worktreeBranch: `task/${TASK_ID}` };
    repo = initRepo();
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("returns completed:false when there is no worktree (direct task)", async () => {
    const res = await completeWorktreeReturn(TASK_ID, repo, "main");
    expect(res).toEqual({ completed: false });
  });

  it("merges the branch into base and tears down the worktree", async () => {
    const wt = addWorktree(repo, true);
    const res = await completeWorktreeReturn(TASK_ID, repo, "main");

    expect(res.completed).toBe(true);
    // base branch now carries the task commit
    const files = execFileSync("git", ["ls-tree", "--name-only", "main"], { cwd: repo, encoding: "utf-8" });
    expect(files).toContain("b.txt");
    // worktree dir + local task branch are gone
    expect(existsSync(wt)).toBe(false);
    const branches = execFileSync("git", ["branch", "--list", `task/${TASK_ID}`], { cwd: repo, encoding: "utf-8" }).trim();
    expect(branches).toBe("");
    // dangling worktreePath was nulled out on the execution
    expect(execUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ worktreePath: null }) })
    );
  });

  it("refuses (and preserves the worktree) when there are uncommitted changes", async () => {
    const wt = addWorktree(repo, true);
    writeFileSync(path.join(wt, "dirty.txt"), "uncommitted\n");

    await expect(completeWorktreeReturn(TASK_ID, repo, "main")).rejects.toBeInstanceOf(WorktreeDirtyError);
    expect(existsSync(wt)).toBe(true); // not torn down — no data loss
  });
});
