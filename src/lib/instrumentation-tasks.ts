import { execFileSync } from "child_process";
import { initDb, db } from "@/lib/db";
import { logger } from "@/lib/logger";

const log = logger.create("instrumentation");

/**
 * Mark stale RUNNING executions as FAILED at server startup.
 * These are orphaned from a previous server crash or restart.
 *
 * Also reap any orphaned CLI process groups left behind by a hard crash —
 * the DB rows are marked FAILED here, but the OS processes they spawned only
 * die if we explicitly kill their groups (see orphan-reaper.ts).
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

  try {
    const {
      recoverMissingWorkbenchExecutionEvents,
      recoverWorkbenchEventClaims,
    } = await import("@/lib/workbench/coordinator");
    const recoveredClaims = await recoverWorkbenchEventClaims();
    if (recoveredClaims > 0) {
      log.warn(`Recovered ${recoveredClaims} stale Workbench event claim(s)`);
    }
    const missing = await recoverMissingWorkbenchExecutionEvents();
    if (missing.recovered > 0 || missing.failed > 0 || missing.remaining > 0) {
      log.warn(
        `Workbench missing-event recovery ran ${missing.batches} batch(es), ` +
        `scanned ${missing.scanned}, recovered ${missing.recovered}, ` +
        `failed ${missing.failed}, remaining ${missing.remaining}, ` +
        `truncated ${missing.truncated}`,
      );
    }
  } catch (error) {
    log.error("Workbench event startup recovery failed", error);
  }

  try {
    const { recoverQueuedGatewayWork, retryGatewayDeliveries } = await import("@/lib/harness/gateway-router");
    const [queued, deliveries] = await Promise.all([
      recoverQueuedGatewayWork(),
      retryGatewayDeliveries(),
    ]);
    if (queued.scanned > 0 || deliveries.scanned > 0) {
      log.info(
        `Gateway recovery scanned ${queued.scanned} queued request(s) and ${deliveries.scanned} delivery row(s); ` +
        `started ${queued.started}, delivered ${deliveries.delivered}, failed ${queued.failed + deliveries.failed}`,
      );
    }
  } catch (error) {
    log.error("Gateway session startup recovery failed", error);
  }

  try {
    const { reapOrphanedProcesses } = await import("@/lib/pty/orphan-reaper");
    const killed = await reapOrphanedProcesses();
    if (killed > 0) {
      log.warn(`Reaped ${killed} orphaned CLI process group(s) from a previous run`);
    }
  } catch (error) {
    log.error("Orphan process reaping failed", error);
  }
}

/**
 * Ensure at least one workspace exists.
 * The last workspace cannot be deleted, so this only runs on first launch.
 */
export async function ensureDefaultWorkspace() {
  try {
    await initDb();
    const count = await db.workspace.count();
    if (count === 0) {
      await db.workspace.create({ data: { name: "Default Workspace" } });
      log.info("Created default workspace");
    }
  } catch (error) {
    log.error("Failed to ensure default workspace", error);
  }
}

/**
 * Ensure the builtin "Tower" label exists, and that it is the *only* label
 * carrying `isBuiltin`.
 *
 * Used for system workbench tasks (hidden from kanban board).
 */
export async function ensureTowerLabel() {
  try {
    await initDb();
    const { TOWER_LABEL_NAME, TOWER_LABEL_COLOR } = await import("@/lib/constants");
    const existing = await db.label.findFirst({
      where: { name: TOWER_LABEL_NAME, isBuiltin: true },
    });
    if (!existing) {
      await db.label.create({
        data: { name: TOWER_LABEL_NAME, color: TOWER_LABEL_COLOR, isBuiltin: true },
      });
      log.info("Created builtin Tower label");
    }
    // `isBuiltin` is purely a "cannot edit/delete" guard, and Tower is the only
    // label that needs it. Older installs also flagged 需求 / 缺陷, which locks
    // them out of branch-prefix editing and deletion. Clear the flag wherever it
    // was never meant to be — idempotent, and user-created labels never set it.
    const { count } = await db.label.updateMany({
      where: { isBuiltin: true, name: { not: TOWER_LABEL_NAME } },
      data: { isBuiltin: false },
    });
    if (count > 0) log.info(`Cleared stale isBuiltin flag on ${count} label(s)`);
  } catch (error) {
    log.error("Failed to ensure Tower label", error);
  }
}

/**
 * Find or create the Tower system task for a project.
 * Uses label-based lookup (not title) to survive project renames.
 */
export async function ensureTowerTask(projectId: string, projectName: string): Promise<string> {
  const { TOWER_LABEL_NAME } = await import("@/lib/constants");

  // Find by Tower label (rename-safe)
  const existing = await db.task.findFirst({
    where: {
      projectId,
      labels: { some: { label: { name: TOWER_LABEL_NAME, isBuiltin: true } } },
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Create with label
  const towerLabel = await db.label.findFirst({
    where: { name: TOWER_LABEL_NAME, isBuiltin: true },
  });

  const task = await db.task.create({
    data: {
      title: `${projectName}-Tower`,
      description: `Project workbench for ${projectName}`,
      projectId,
      status: "TODO",
      priority: "LOW",
      order: 0,
      ...(towerLabel ? { labels: { create: { labelId: towerLabel.id } } } : {}),
    },
    select: { id: true },
  });
  return task.id;
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
