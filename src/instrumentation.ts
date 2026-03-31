export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await pruneOrphanedWorktrees();
  }
}

async function pruneOrphanedWorktrees() {
  const { execFileSync } = await import("child_process");
  const { initDb, db } = await import("@/lib/db");

  try {
    await initDb();

    // D-08: Query all GIT projects with non-null localPath
    const gitProjects = await db.project.findMany({
      where: {
        type: "GIT",
        localPath: { not: null },
      },
      select: { id: true, localPath: true, name: true },
    });

    for (const project of gitProjects) {
      // D-09: Process each project independently — one failure does not block others
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
    // D-09: Top-level failure (DB connection etc.) must not block server startup
    console.error(
      "[instrumentation] Worktree prune startup task failed:",
      error
    );
  }
}
