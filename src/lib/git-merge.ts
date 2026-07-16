import { execFileSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { logger } from "@/lib/logger";

const log = logger.create("git-merge");

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
 * @throws Error with an actionable message when the repo is not in a clean
 *         state to operate on.
 */
export function assertMainRepoReady(localPath: string): void {
  const gitDir = resolveGitDir(localPath);

  const lockPath = path.join(gitDir, "index.lock");
  if (existsSync(lockPath)) {
    throw new Error(
      `The main repo has a Git lock file (${lockPath}) - another git process may be running, ` +
        `or a previous git command crashed and left it behind. ` +
        `Make sure no git operation is in progress, delete the lock file, then retry.`
    );
  }

  if (existsSync(path.join(gitDir, "MERGE_HEAD"))) {
    throw new Error(
      `The main repo is in an unfinished merge state (MERGE_HEAD exists). ` +
        `Run git merge --abort in ${localPath}, or finish the current merge, then retry.`
    );
  }

  if (
    existsSync(path.join(gitDir, "rebase-merge")) ||
    existsSync(path.join(gitDir, "rebase-apply"))
  ) {
    throw new Error(
      `The main repo is in an unfinished rebase state. ` +
        `Run git rebase --abort in ${localPath}, or finish the current rebase, then retry.`
    );
  }
}

/**
 * Files left unmerged (conflict markers written) after a failed `git stash pop`.
 * Best-effort: an empty list just means the message omits the file names.
 */
function unmergedFiles(localPath: string, timeoutMs: number): string[] {
  try {
    const out = execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=U"],
      { cwd: localPath, encoding: "utf-8", timeout: timeoutMs, stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    return out ? out.split("\n") : [];
  } catch {
    return [];
  }
}

/**
 * Condenses git's failure output to the line(s) that actually diagnose it.
 *
 * A conflicting `git stash pop` reports ~9 lines (to stdout — hence
 * `describeGitError` picking it up): "Auto-merging", the CONFLICT lines, then a
 * full `git status` hint block. Splicing that whole dump into a one-line warning
 * buries the recovery steps, so keep the CONFLICT lines when present and fall
 * back to the first line for any other failure, where it is the only diagnostic.
 */
function condenseGitOutput(raw: string): string {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const conflicts = lines.filter((l) => l.startsWith("CONFLICT"));
  return (conflicts.length ? conflicts : lines.slice(0, 1)).join("; ");
}

/**
 * Builds the user-facing warning for a failed post-merge `git stash pop`.
 *
 * The merge already landed, so this is NOT an error — but the user is left with
 * a working tree carrying conflict markers and a stash entry git silently kept.
 * Everything needed to self-recover goes in the message, since the MCP layer and
 * the merge dialog both only surface a plain string: that the stash survives,
 * its marker, where to look, and which files conflicted.
 */
function describeStashPopFailure(
  localPath: string,
  timeoutMs: number,
  error: unknown
): string {
  const files = unmergedFiles(localPath, timeoutMs);
  const conflicts = files.length ? `Conflicting files: ${files.join(", ")}. ` : "";
  return (
    `Merge succeeded, but restoring the main repo's stashed changes failed (git stash pop): ` +
    `${condenseGitOutput(describeGitError(error))}. ` +
    `Your uncommitted changes are NOT lost - they are still in the stash (marked ${STASH_MARKER}). ${conflicts}` +
    `Run \`git stash list\` in ${localPath} to see it, resolve the conflict markers in your working tree, ` +
    `then run \`git stash pop\` to restore the changes.`
  );
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
 *  5. A failed stash pop is nonetheless *reported*: it comes back as
 *     `stashPopWarning` rather than an exception, so the caller can tell the
 *     user their changes are still stashed without failing the completion.
 *     "Must not mask a successful merge" means don't throw — not stay silent.
 *
 * @returns the short hash of the merge commit, plus `stashPopWarning` when the
 *   autostash could not be restored (merge still succeeded — see above).
 */
export function mergeBranchIntoBase({
  localPath,
  baseBranch,
  worktreeBranch,
  timeoutMs = 30000,
}: MergeBranchParams): { commitHash: string; stashPopWarning?: string } {
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
        `Failed to stash the main repo's working tree changes (git stash push): ${describeGitError(err)}. ` +
          `Run git status / git stash list in ${localPath} to inspect the working tree, then retry.`
      );
    }
    // Verify an entry was actually created before relying on it — `git stash
    // push` can be a no-op even when status reported changes, and popping a
    // non-existent stash would otherwise abort the whole merge.
    const stashList = execFileSync("git", ["stash", "list"], gitOpts);
    didStash = stashList.includes(STASH_MARKER);
  }

  let commitHash: string;
  let stashPopWarning: string | undefined;
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
        log.error("Restore original branch failed (non-fatal)", error, {
          localPath,
          originalBranch,
        });
      }
    }

    // Pop is cleanup: a failure here must not mask a successful merge, so it is
    // never thrown. It is still handed back as a warning — silently swallowing
    // it leaves the user with conflict markers and an orphaned stash they were
    // never told about.
    if (didStash) {
      try {
        execFileSync("git", ["stash", "pop"], gitOpts);
      } catch (error) {
        stashPopWarning = describeStashPopFailure(localPath, timeoutMs, error);
        log.warn("Stash pop after merge failed (non-fatal)", {
          localPath,
          stashMarker: STASH_MARKER,
          error: describeGitError(error),
        });
      }
    }
  }

  return { commitHash, ...(stashPopWarning ? { stashPopWarning } : {}) };
}
