import { execFileSync } from "child_process";
import { existsSync } from "fs";
import path from "path";

/** Unique marker so a tower-created autostash can be told apart from any
 *  pre-existing user stash (and verified to actually exist before popping). */
const STASH_MARKER = "tower-merge-temp";

/**
 * Extracts a human-readable diagnostic from an `execFileSync` failure.
 *
 * `execFileSync` throws an Error whose `.message` is the opaque
 * "Command failed: git ..." line. The actual git diagnostic lives in
 * `.stderr` (or occasionally `.stdout`). We prefer the real output so the
 * user sees *why* git failed instead of just *that* it failed.
 */
export function describeGitError(err: unknown): string {
  const e = err as {
    stderr?: string | Buffer | null;
    stdout?: string | Buffer | null;
    message?: string;
  };
  const stderr = (e?.stderr ?? "").toString().trim();
  const stdout = (e?.stdout ?? "").toString().trim();
  return stderr || stdout || e?.message?.trim() || "unknown git error";
}

/**
 * Runs a git command and, on failure, throws an Error carrying git's real
 * stderr/stdout instead of the opaque "Command failed" message.
 */
export function runGit(args: string[], cwd: string, timeout = 30000): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    throw new Error(describeGitError(err));
  }
}

/**
 * Resolves the absolute path of a repo's git directory, falling back to
 * `<localPath>/.git` if `git rev-parse` itself fails.
 */
export function resolveGitDir(localPath: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: localPath,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return path.join(localPath, ".git");
  }
}

/**
 * Preflight guard before mutating the main repo's working tree (stash/checkout/
 * merge). Detects the states that make `git stash push` fail with an opaque
 * "Command failed" and throws an actionable, user-facing error instead.
 *
 * @throws Error with a friendly Chinese message when the repo is not in a
 *         clean state to operate on.
 */
export function assertMainRepoReady(localPath: string): void {
  const gitDir = resolveGitDir(localPath);

  const lockPath = path.join(gitDir, "index.lock");
  if (existsSync(lockPath)) {
    throw new Error(
      `主仓库存在 Git 锁文件（${lockPath}），可能有其他 git 进程正在运行，或上次 git 操作异常退出残留。` +
        `请确认没有正在进行的 git 操作后，删除该 lock 文件再重试。`
    );
  }

  if (existsSync(path.join(gitDir, "MERGE_HEAD"))) {
    throw new Error(
      `主仓库正处于未完成的合并状态（存在 MERGE_HEAD）。` +
        `请先在 ${localPath} 执行 git merge --abort 或完成当前合并后再重试。`
    );
  }

  if (
    existsSync(path.join(gitDir, "rebase-merge")) ||
    existsSync(path.join(gitDir, "rebase-apply"))
  ) {
    throw new Error(
      `主仓库正处于未完成的 rebase 状态。` +
        `请先在 ${localPath} 执行 git rebase --abort 或完成当前 rebase 后再重试。`
    );
  }
}

export interface MergeBranchParams {
  /** Main checkout where the merge is performed. */
  localPath: string;
  /** Branch to merge into (the merge target). */
  baseBranch: string;
  /** Branch carrying the task's commits (the merge source). */
  worktreeBranch: string;
  /** Per-command timeout in ms (default 30s). */
  timeoutMs?: number;
}

/**
 * Merge `worktreeBranch` into `baseBranch` inside the checkout at `localPath`,
 * preserving the caller's current branch and any uncommitted tracked changes.
 *
 * The autostash dance is hardened against several failure modes:
 *
 *  1. Before touching the working tree we run {@link assertMainRepoReady} to
 *     detect a stale `index.lock` or an in-progress merge/rebase up front and
 *     report an actionable error instead of an opaque "Command failed".
 *  2. The `git stash push` goes through {@link runGit}, so when it does fail
 *     the caller sees git's real stderr rather than "Command failed: git …".
 *  3. We only pop a stash that was *actually created*. `git status` showing
 *     changes does not guarantee `git stash push` produced an entry, so we
 *     re-check `git stash list` for our marker instead of trusting a flag
 *     derived from the pre-stash status. This is the root fix for the
 *     "No stash entries found" abort on a clean worktree.
 *  4. Cleanup steps (restoring the original branch, popping the stash) are
 *     best-effort: their failure is logged but never thrown. By the time they
 *     run the merge has already succeeded, so a cleanup hiccup must not be
 *     reported back to the caller as "Merge failed".
 *
 * @returns the short hash of the resulting merge commit.
 */
export function mergeBranchIntoBase({
  localPath,
  baseBranch,
  worktreeBranch,
  timeoutMs = 30000,
}: MergeBranchParams): { commitHash: string } {
  const gitOpts = {
    encoding: "utf-8" as const,
    timeout: timeoutMs,
    cwd: localPath,
  };

  // Record current branch so we can return to it after the merge.
  const originalBranch = execFileSync(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    gitOpts
  ).trim();
  const needsCheckout = originalBranch !== baseBranch;

  // Stash uncommitted tracked changes so checkout/merge can proceed cleanly.
  // `git stash push` without `-u` ignores untracked files, so only tracked
  // modifications should influence the decision to stash.
  const status = execFileSync("git", ["status", "--porcelain"], gitOpts).trim();
  const hasTrackedChanges = status
    .split("\n")
    .some((line) => line.trim() !== "" && !line.startsWith("??"));

  let didStash = false;
  if (hasTrackedChanges) {
    // Preflight: a stale index.lock or an in-progress merge/rebase makes
    // `git stash push` fail with an opaque "Command failed". Detect up front.
    assertMainRepoReady(localPath);
    try {
      // runGit surfaces git's real stderr instead of "Command failed: …".
      runGit(["stash", "push", "-m", STASH_MARKER], localPath, timeoutMs);
    } catch (err) {
      throw new Error(
        `暂存主仓库工作区改动失败（git stash push）：${describeGitError(err)}。` +
          `请在 ${localPath} 执行 git status / git stash list 检查工作区状态后重试。`
      );
    }
    // Verify an entry was actually created before relying on it — `git stash
    // push` can be a no-op even when status reported changes, and popping a
    // non-existent stash would otherwise abort the whole merge.
    const stashList = execFileSync("git", ["stash", "list"], gitOpts);
    didStash = stashList.includes(STASH_MARKER);
  }

  let commitHash: string;
  try {
    if (needsCheckout) {
      execFileSync("git", ["checkout", baseBranch], gitOpts);
    }

    // Normal merge — preserves the task branch's commit history.
    execFileSync("git", ["merge", worktreeBranch, "--no-edit"], gitOpts);

    commitHash = execFileSync(
      "git",
      ["rev-parse", "--short", "HEAD"],
      gitOpts
    ).trim();
  } finally {
    // Restore the original branch before popping — the stash was created there.
    if (needsCheckout) {
      try {
        execFileSync("git", ["checkout", originalBranch], gitOpts);
      } catch (error) {
        console.error(
          "[merge] Restore original branch failed (non-fatal):",
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    // Pop is cleanup: a failure here must not mask a successful merge.
    if (didStash) {
      try {
        execFileSync("git", ["stash", "pop"], gitOpts);
      } catch (error) {
        console.error(
          "[merge] Stash pop after merge failed (non-fatal):",
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  return { commitHash };
}
