import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import path from "path";
import os from "os";

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

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
  localPathRaw: string,
  taskId: string,
  baseBranch: string
): Promise<WorktreeResult> {
  const localPath = expandHome(localPathRaw);
  const worktreePath = path.join(localPath, ".worktrees", "task-" + taskId);
  const worktreeBranch = "task/" + taskId;

  // Ensure .worktrees directory exists
  await mkdir(path.join(localPath, ".worktrees"), { recursive: true });

  // Check if worktree already exists (reuse case)
  const worktreeList = execFileSync(
    "git", ["worktree", "list", "--porcelain"],
    { cwd: localPath, encoding: "utf-8", timeout: 10000 }
  );

  const worktreeLines = worktreeList.split("\n");
  const alreadyExists = worktreeLines.some(
    (line: string) => line === `worktree ${worktreePath}`
  );

  if (alreadyExists) {
    return { worktreePath, worktreeBranch };
  }

  // Check if the task branch already exists
  const branchList = execFileSync(
    "git", ["branch", "--list", worktreeBranch],
    { cwd: localPath, encoding: "utf-8", timeout: 5000 }
  ).trim();

  if (branchList) {
    // Branch exists: attach existing branch without -b flag (preserves previous work)
    execFileSync(
      "git", ["worktree", "add", worktreePath, worktreeBranch],
      { cwd: localPath, encoding: "utf-8", timeout: 30000 }
    );
  } else {
    // Resolve baseBranch — try local first, then remote (origin/xxx)
    let resolvedBase = baseBranch;
    try {
      execFileSync("git", ["rev-parse", "--verify", baseBranch], { cwd: localPath, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      // Local branch doesn't exist — try as remote tracking branch
      try {
        execFileSync("git", ["rev-parse", "--verify", `origin/${baseBranch}`], { cwd: localPath, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
        resolvedBase = `origin/${baseBranch}`;
      } catch {
        throw new Error(
          `Base branch '${baseBranch}' does not exist locally or on remote. Available branches: ` +
          execFileSync("git", ["branch", "-a", "--format=%(refname:short)"], { cwd: localPath, encoding: "utf-8", timeout: 5000 }).trim().split("\n").join(", ")
        );
      }
    }

    // Branch does not exist: create new branch from resolved base
    execFileSync(
      "git", ["worktree", "add", "-b", worktreeBranch, worktreePath, resolvedBase],
      { cwd: localPath, encoding: "utf-8", timeout: 30000 }
    );
  }

  return { worktreePath, worktreeBranch };
}

/**
 * Removes a git worktree and its associated task branch.
 *
 * Best-effort: skips steps that are already done (missing dir or branch).
 * Callers should wrap in try/catch — this function may throw on git errors.
 *
 * @param localPath - Absolute path to the project root (git repo)
 * @param taskId    - The task ID (used to derive worktree path and branch name)
 */
export async function removeWorktree(
  localPathRaw: string,
  taskId: string
): Promise<void> {
  const localPath = expandHome(localPathRaw);
  const worktreePath = path.join(localPath, ".worktrees", "task-" + taskId);
  const worktreeBranch = "task/" + taskId;

  // Clean up session symlinks in ~/.claude/projects/ for this worktree
  try {
    const { cleanupSessionSymlinks } = await import("@/lib/claude-session");
    cleanupSessionSymlinks(worktreePath);
  } catch {
    // Best effort
  }

  // D-11: Only remove worktree dir if it exists
  if (existsSync(worktreePath)) {
    execFileSync(
      "git", ["worktree", "remove", worktreePath, "--force"],
      { cwd: localPath, encoding: "utf-8", timeout: 30000 }
    );
  }

  // D-12: Only delete branch if it exists
  const branchExists = execFileSync(
    "git", ["branch", "--list", worktreeBranch],
    { cwd: localPath, encoding: "utf-8", timeout: 5000 }
  ).trim();

  if (branchExists) {
    execFileSync(
      "git", ["branch", "-D", worktreeBranch],
      { cwd: localPath, encoding: "utf-8", timeout: 5000 }
    );
  }
}
