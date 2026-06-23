import { execFileSync } from "child_process";

/** Unique marker so a tower-created autostash can be told apart from any
 *  pre-existing user stash (and verified to actually exist before popping). */
const STASH_MARKER = "tower-merge-temp";

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
 * The autostash dance is hardened against the "clean working tree" case:
 *
 *  1. We only pop a stash that was *actually created*. `git status` showing
 *     changes does not guarantee `git stash push` produced an entry, so we
 *     re-check `git stash list` for our marker instead of trusting a flag
 *     derived from the pre-stash status. This is the root fix for the
 *     "No stash entries found" abort on a clean worktree.
 *  2. Cleanup steps (restoring the original branch, popping the stash) are
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
    execFileSync("git", ["stash", "push", "-m", STASH_MARKER], gitOpts);
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
