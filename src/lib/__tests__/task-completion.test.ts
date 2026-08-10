import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// These tests drive real git: init, commit, worktree add, merge, worktree
// remove. That costs ~2s on an idle machine but 8s+ once the full suite runs
// them alongside 15 other workers — past vitest's 5s default, which surfaced as
// "flaky" failures that always passed when the file was run on its own.
vi.setConfig({ testTimeout: 30_000 });

// Record what gets written back to the execution, and stub the side-effect
// imports so the real merge + worktree teardown run against a real repo without
// touching a DB, PTY, or the AI overview pipeline.
const execUpdate = vi.fn();
const destroySession = vi.hoisted(() => vi.fn());
const lifecycleEvents: string[] = [];
let latestExecution: { id: string; worktreeBranch: string; status: string } | null;

vi.mock("@/lib/db", () => ({
  db: {
    taskExecution: {
      findFirst: vi.fn(async () => latestExecution),
      update: vi.fn(async (args: unknown) => execUpdate(args)),
    },
  },
}));
vi.mock("@/lib/pty/session-store", () => ({ destroySession }));
vi.mock("@/lib/task-overview", () => ({ captureTaskOverview: vi.fn(async () => {}) }));

import { completeWorktreeReturn, WorktreeDirtyError, MergeConflictError } from "@/lib/task-completion";

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
function addWorktree(repo: string, withCommit: boolean, branch = `task/${TASK_ID}`): string {
  const wt = path.join(repo, ".worktrees", "task-" + TASK_ID);
  execFileSync("git", ["worktree", "add", "-q", "-b", branch, wt, "main"], { cwd: repo });
  if (withCommit) {
    writeFileSync(path.join(wt, "b.txt"), "work\n");
    const git = (...a: string[]) => execFileSync("git", a, { cwd: wt });
    git("add", ".");
    git("commit", "-qm", "task work");
  }
  return wt;
}

describe("completion error messages are actionable for the agent", () => {
  it("MergeConflictError names files + tells the agent to merge base in the worktree", () => {
    const e = new MergeConflictError(["src/a.ts"], "main");
    expect(e.message).toContain("src/a.ts");
    expect(e.message).toContain("git merge main");
  });
  it("WorktreeDirtyError names files + points to commit / .gitignore", () => {
    const e = new WorktreeDirtyError(["tmp.log"]);
    expect(e.message).toContain("tmp.log");
    expect(e.message).toContain(".gitignore");
  });
});

describe("completeWorktreeReturn", () => {
  let repo: string;
  beforeEach(() => {
    execUpdate.mockReset();
    destroySession.mockReset();
    lifecycleEvents.length = 0;
    execUpdate.mockImplementation(async () => {
      lifecycleEvents.push("execution-completed");
    });
    destroySession.mockImplementation(() => {
      lifecycleEvents.push("session-destroyed");
    });
    latestExecution = { id: "exec1", worktreeBranch: `task/${TASK_ID}`, status: "RUNNING" };
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
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          endedAt: expect.any(Date),
          worktreePath: null,
        }),
      })
    );
    expect(destroySession).toHaveBeenCalledWith(TASK_ID);
    expect(lifecycleEvents).toEqual(["execution-completed", "session-destroyed"]);
  });

  it("merges and tears down a branch whose name came from a naming rule", async () => {
    // A label-based rule gave this worktree a custom prefix; the name is only
    // knowable from the execution record, never re-derivable from the taskId.
    const branch = `feat/${TASK_ID}`;
    latestExecution = { id: "exec1", worktreeBranch: branch, status: "RUNNING" };
    const wt = addWorktree(repo, true, branch);

    const res = await completeWorktreeReturn(TASK_ID, repo, "main");

    expect(res.completed).toBe(true);
    const files = execFileSync("git", ["ls-tree", "--name-only", "main"], { cwd: repo, encoding: "utf-8" });
    expect(files).toContain("b.txt");
    expect(existsSync(wt)).toBe(false);
    const branches = execFileSync("git", ["branch", "--list", branch], { cwd: repo, encoding: "utf-8" }).trim();
    expect(branches).toBe("");
  });

  it("refuses (and preserves the worktree) when there are uncommitted changes", async () => {
    const wt = addWorktree(repo, true);
    writeFileSync(path.join(wt, "dirty.txt"), "uncommitted\n");

    await expect(completeWorktreeReturn(TASK_ID, repo, "main")).rejects.toBeInstanceOf(WorktreeDirtyError);
    expect(existsSync(wt)).toBe(true); // not torn down — no data loss
  });

  it("preserves the live worktree on conflict and completes after the conflict is committed", async () => {
    const wt = addWorktree(repo, false);
    writeFileSync(path.join(wt, "a.txt"), "task change\n");
    execFileSync("git", ["add", "a.txt"], { cwd: wt });
    execFileSync("git", ["commit", "-qm", "task change"], { cwd: wt });

    writeFileSync(path.join(repo, "a.txt"), "base change\n");
    execFileSync("git", ["add", "a.txt"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "base change"], { cwd: repo });

    await expect(completeWorktreeReturn(TASK_ID, repo, "main"))
      .rejects.toMatchObject({ conflictFiles: ["a.txt"] });
    expect(existsSync(wt)).toBe(true);
    expect(destroySession).not.toHaveBeenCalled();
    expect(execUpdate).not.toHaveBeenCalled();

    expect(() => execFileSync("git", ["merge", "main"], { cwd: wt })).toThrow();
    writeFileSync(path.join(wt, "a.txt"), "resolved change\n");
    execFileSync("git", ["add", "a.txt"], { cwd: wt });
    execFileSync("git", ["commit", "-qm", "resolve main conflict"], { cwd: wt });

    const result = await completeWorktreeReturn(TASK_ID, repo, "main");
    expect(result.completed).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(destroySession).toHaveBeenCalledTimes(1);
  });
});
