/**
 * Resolves the (cwd, ref, head) tuple needed to diff a task against its base.
 *
 * Used by:
 *   - /api/tasks/[taskId]/diff       — produces the changed-files list
 *   - /api/tasks/[taskId]/diff-file  — produces before/after content for one
 *                                       file (Monaco DiffEditor source)
 *
 * Single source of truth; the two routes were diverging before this extract.
 */

import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { db } from "@/lib/db";

export interface ResolvedDiffSource {
  /** Directory to run `git` from (worktree if active, else project's localPath). */
  diffCwd: string;
  /** Ref/range that represents the "before" side. May be a single SHA
   *  (worktree mode) or a "<fork>..<end>" range (DONE state). */
  diffTarget: string;
  /** "Before" commit SHA — always a single ref usable with `git show <sha>:<file>`. */
  baseRef: string;
  /** "After" commit SHA when the task is merged; null while the task is
   *  still live (after-content lives in the working tree instead). */
  endRef: string | null;
  /** Live worktree path if one is on disk — when set, after-content for
   *  untracked / uncommitted edits must be read from this directory. */
  worktreePath: string | null;
}

export type ResolveResult =
  | { kind: "ok"; data: ResolvedDiffSource }
  | { kind: "empty" }
  | { kind: "branch-deleted" }
  | { kind: "error"; status: number; message: string };

export async function resolveTaskDiffSource(
  taskId: string
): Promise<ResolveResult> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });

  if (!task) return { kind: "error", status: 404, message: "Task not found" };
  if (!task.project?.localPath) {
    return { kind: "error", status: 400, message: "Project has no local path" };
  }

  const baseBranch = task.baseBranch || "main";
  const localPath = task.project.localPath;

  const latestExecution = await db.taskExecution.findFirst({
    where: { taskId },
    orderBy: { createdAt: "desc" },
  });
  if (!latestExecution) return { kind: "empty" };

  const { forkCommit, mergeCommit, branchTipCommit, worktreeBranch, worktreePath } =
    latestExecution;

  if (mergeCommit && forkCommit) {
    // DONE — diff fork..branchTip (or fork..merge as fallback).
    const endCommit = branchTipCommit || mergeCommit;
    return {
      kind: "ok",
      data: {
        diffCwd: localPath,
        diffTarget: `${forkCommit}..${endCommit}`,
        baseRef: forkCommit,
        endRef: endCommit,
        worktreePath: null,
      },
    };
  }
  if (forkCommit && worktreePath && existsSync(worktreePath)) {
    return {
      kind: "ok",
      data: {
        diffCwd: worktreePath,
        diffTarget: forkCommit,
        baseRef: forkCommit,
        endRef: null,
        worktreePath,
      },
    };
  }
  if (forkCommit && !worktreePath) {
    return {
      kind: "ok",
      data: {
        diffCwd: localPath,
        diffTarget: forkCommit,
        baseRef: forkCommit,
        endRef: null,
        worktreePath: null,
      },
    };
  }
  if (worktreeBranch) {
    try {
      const mb = execFileSync(
        "git",
        ["merge-base", baseBranch, worktreeBranch],
        { cwd: localPath, encoding: "utf-8", timeout: 5000 }
      ).trim();
      const wtp = worktreePath && existsSync(worktreePath) ? worktreePath : localPath;
      return {
        kind: "ok",
        data: {
          diffCwd: wtp,
          diffTarget: mb,
          baseRef: mb,
          endRef: null,
          worktreePath: worktreePath && existsSync(worktreePath) ? worktreePath : null,
        },
      };
    } catch {
      return { kind: "branch-deleted" };
    }
  }
  return { kind: "empty" };
}
