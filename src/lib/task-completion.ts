import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { db } from "@/lib/db";
import { checkConflicts } from "@/lib/diff-parser";
import { mergeBranchIntoBase } from "@/lib/git-merge";
import { removeWorktree, stripTowerLinkedStatus, worktreePathFor } from "@/lib/worktree";
import { logger } from "@/lib/logger";

const log = logger.create("task-completion");

/** Thrown when a worktree has uncommitted changes — merging would lose them. */
export class WorktreeDirtyError extends Error {
  constructor(public files: string[]) {
    super("Worktree has uncommitted changes");
    this.name = "WorktreeDirtyError";
  }
}

/** Thrown when the task branch conflicts with base — merge cannot proceed. */
export class MergeConflictError extends Error {
  constructor(public conflictFiles: string[]) {
    super("Merge conflicts detected");
    this.name = "MergeConflictError";
  }
}

/**
 * Unified return flow for completing a **worktree** task: merge its branch into
 * base, then tear down the worktree + local branch. Shared by every DONE
 * trigger — the UI merge route AND `updateTaskStatus` (MCP `move_task`,
 * orchestrators) — so completion leaves zero residue no matter who calls it.
 *
 * Runs BEFORE the caller flips status to DONE, so a conflict / dirty worktree
 * aborts (throws) without marking the task done.
 *
 * @returns `{ completed: false }` when there is no worktree on disk (a direct
 *   task, or one already cleaned up) — the caller should fall back to its
 *   direct-mode DONE handling. `{ completed: true, commitHash }` otherwise.
 * @throws {WorktreeDirtyError} uncommitted changes present (would be lost).
 * @throws {MergeConflictError} task branch conflicts with base.
 */
export async function completeWorktreeReturn(
  taskId: string,
  localPath: string,
  baseBranch: string
): Promise<{ completed: boolean; commitHash?: string }> {
  const worktreePath = worktreePathFor(localPath, taskId);
  if (!existsSync(worktreePath)) {
    return { completed: false };
  }

  const latestExecution = await db.taskExecution.findFirst({
    where: { taskId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
  });
  const worktreeBranch = latestExecution?.worktreeBranch ?? `task/${taskId}`;

  // Refuse on uncommitted changes: they live in the worktree, not the branch,
  // so a merge wouldn't carry them and `removeWorktree --force` would delete
  // them. The UI blocks this pre-dialog; enforce here for programmatic callers.
  const statusOut = execFileSync("git", ["status", "--porcelain"], {
    cwd: worktreePath,
    encoding: "utf-8",
    timeout: 5000,
  }).trim();
  const dirtyFiles = stripTowerLinkedStatus(
    statusOut ? statusOut.split("\n") : [],
    worktreePath
  );
  if (dirtyFiles.length > 0) {
    throw new WorktreeDirtyError(dirtyFiles);
  }

  // Pre-merge conflict check — abort before mutating the main working tree.
  const { hasConflicts, conflictFiles } = checkConflicts(localPath, baseBranch, worktreeBranch);
  if (hasConflicts) {
    throw new MergeConflictError(conflictFiles);
  }

  // Record the branch tip BEFORE merge — used for an accurate post-merge diff.
  let branchTipCommit: string | undefined;
  try {
    branchTipCommit = execFileSync("git", ["rev-parse", worktreeBranch], {
      cwd: localPath,
      encoding: "utf-8",
      timeout: 30000,
    }).trim();
  } catch {
    // Best effort — diff falls back gracefully.
  }

  const { commitHash } = mergeBranchIntoBase({ localPath, baseBranch, worktreeBranch });

  // Persist mergeCommit/branchTipCommit for the diff archive, and null out
  // worktreePath so it isn't a dangling reference once the dir is removed.
  if (latestExecution) {
    try {
      await db.taskExecution.update({
        where: { id: latestExecution.id },
        data: {
          ...(commitHash ? { mergeCommit: commitHash } : {}),
          ...(branchTipCommit ? { branchTipCommit } : {}),
          worktreePath: null,
        },
      });
    } catch (error) {
      log.error("Failed to record merge commit", error, { taskId });
    }
  }

  // Kill PTY before filesystem teardown so the live process doesn't end up with
  // a deleted cwd (zombie).
  try {
    const { destroySession } = await import("@/lib/pty/session-store");
    destroySession(taskId);
  } catch (error) {
    log.error("PTY session destroy failed", error, { taskId });
  }

  // Capture the change-overview note while the diff is still resolvable (only
  // the fast git-gather is awaited; the AI summary runs in the background).
  try {
    const { captureTaskOverview } = await import("@/lib/task-overview");
    await captureTaskOverview(taskId);
  } catch (error) {
    log.error("Task overview capture failed", error, { taskId });
  }

  // Tear down the worktree dir + local task branch.
  try {
    await removeWorktree(localPath, taskId);
  } catch (error) {
    log.error("Worktree cleanup failed", error, { taskId });
  }

  return { completed: true, commitHash };
}
