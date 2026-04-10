import { execFileSync } from "child_process";
import { initDb, db } from "@/lib/db";
import { logger } from "@/lib/logger";

const log = logger.create("instrumentation");

/**
 * Mark stale RUNNING executions as FAILED at server startup.
 * These are orphaned from a previous server crash or restart.
 */
export async function cleanupStaleExecutions() {
  try {
    await initDb();
    const result = await db.taskExecution.updateMany({
      where: { status: "RUNNING" },
      data: { status: "FAILED", endedAt: new Date() },
    });
    if (result.count > 0) {
      log.warn(`Cleaned up ${result.count} stale RUNNING execution(s)`);
    }
  } catch (error) {
    log.error("Stale execution cleanup failed", error);
  }
}

/**
 * Prune orphaned git worktrees for all GIT projects at server startup.
 * This file is ONLY imported via dynamic import inside instrumentation.ts
 * when NEXT_RUNTIME === "nodejs", so Node.js modules are safe to use.
 */
export async function pruneOrphanedWorktrees() {
  try {
    await initDb();

    const gitProjects = await db.project.findMany({
      where: {
        type: "GIT",
        localPath: { not: null },
      },
      select: { id: true, localPath: true, name: true },
    });

    for (const project of gitProjects) {
      try {
        execFileSync("git", ["worktree", "prune"], {
          cwd: project.localPath!,
          encoding: "utf-8",
          timeout: 10000,
        });
      } catch (error) {
        log.error(`git worktree prune failed for "${project.name}"`, error, { localPath: project.localPath! });
      }
    }
  } catch (error) {
    log.error("Worktree prune startup task failed", error);
  }
}
