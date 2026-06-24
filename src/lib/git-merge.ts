import { execFileSync } from "child_process";
import { existsSync } from "fs";
import path from "path";

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
export function runGit(
  args: string[],
  cwd: string,
  timeout = 30000
): string {
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
