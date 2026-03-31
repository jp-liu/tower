import { execSync } from "child_process";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import path from "path";

export interface WorktreeResult {
  worktreePath: string;
  worktreeBranch: string;
}

/**
 * Creates a git worktree for the given task, or reuses one if it already exists.
 *
 * @param localPath  - Absolute path to the project root (git repo)
 * @param taskId     - The task ID (used to derive worktree path and branch name)
 * @param baseBranch - The branch to base the new task branch on
 * @returns WorktreeResult with the worktree path and branch name
 * @throws If git worktree add fails with a non-recoverable error
 */
export async function createWorktree(
  localPath: string,
  taskId: string,
  baseBranch: string
): Promise<WorktreeResult> {
  const worktreePath = path.join(localPath, ".worktrees", "task-" + taskId);
  const worktreeBranch = "task/" + taskId;

  // Ensure .worktrees directory exists
  await mkdir(path.join(localPath, ".worktrees"), { recursive: true });

  // Check if worktree already exists (reuse case)
  const worktreeList = execSync("git worktree list --porcelain", {
    cwd: localPath,
    encoding: "utf-8",
    timeout: 10000,
  });

  const worktreeLines = worktreeList.split("\n");
  const alreadyExists = worktreeLines.some(
    (line) => line === `worktree ${worktreePath}`
  );

  if (alreadyExists) {
    return { worktreePath, worktreeBranch };
  }

  // Check if the task branch already exists
  const branchList = execSync(`git branch --list task/${taskId}`, {
    cwd: localPath,
    encoding: "utf-8",
    timeout: 5000,
  }).trim();

  if (branchList) {
    // Branch exists: attach existing branch without -b flag (preserves previous work)
    execSync(`git worktree add "${worktreePath}" ${worktreeBranch}`, {
      cwd: localPath,
      encoding: "utf-8",
      timeout: 30000,
    });
  } else {
    // Branch does not exist: create new branch from baseBranch
    execSync(
      `git worktree add -b ${worktreeBranch} "${worktreePath}" ${baseBranch}`,
      {
        cwd: localPath,
        encoding: "utf-8",
        timeout: 30000,
      }
    );
  }

  return { worktreePath, worktreeBranch };
}

/**
 * Removes a git worktree and its associated task branch.
 *
 * Best-effort: skips steps that are already done (missing dir or branch).
 * Never throws — callers should catch and log errors independently.
 *
 * @param localPath - Absolute path to the project root (git repo)
 * @param taskId    - The task ID (used to derive worktree path and branch name)
 */
export async function removeWorktree(
  localPath: string,
  taskId: string
): Promise<void> {
  const worktreePath = path.join(localPath, ".worktrees", "task-" + taskId);
  const worktreeBranch = "task/" + taskId;

  // D-11: Only remove worktree dir if it exists
  if (existsSync(worktreePath)) {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: localPath,
      encoding: "utf-8",
      timeout: 30000,
    });
  }

  // D-12: Only delete branch if it exists
  const branchExists = execSync(`git branch --list ${worktreeBranch}`, {
    cwd: localPath,
    encoding: "utf-8",
    timeout: 5000,
  }).trim();

  if (branchExists) {
    execSync(`git branch -D ${worktreeBranch}`, {
      cwd: localPath,
      encoding: "utf-8",
      timeout: 5000,
    });
  }
}
