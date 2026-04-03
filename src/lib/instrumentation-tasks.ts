import { execFileSync } from "child_process";
import { initDb, db } from "@/lib/db";

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
        console.error(
          `[instrumentation] git worktree prune failed for project "${project.name}" (${project.localPath}):`,
          error
        );
      }
    }
  } catch (error) {
    console.error(
      "[instrumentation] Worktree prune startup task failed:",
      error
    );
  }
}
