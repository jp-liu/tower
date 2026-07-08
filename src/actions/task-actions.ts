"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { setTaskLabels } from "@/actions/label-actions";
import { removeWorktree, stripTowerLinkedStatus } from "@/lib/worktree";
import { z } from "zod";
import { createTaskSchema, updateTaskSchema, taskStatusSchema } from "@/lib/schemas";
import { logger } from "@/lib/logger";
import { visibleTaskWhere, archivedTaskWhere } from "@/lib/task-archive";
import { getArchiveDelayDays } from "@/actions/config-actions";
import type { TaskStatus, Priority } from "@prisma/client";

const log = logger.create("task-actions");

export async function createTask(data: {
  title: string;
  description?: string;
  projectId: string;
  priority?: Priority;
  status?: TaskStatus;
  labelIds?: string[];
  baseBranch?: string;
  subPath?: string;
  versionId?: string;
}) {
  const v = createTaskSchema.parse(data);
  const task = await db.task.create({
    data: {
      title: v.title,
      description: v.description,
      projectId: v.projectId,
      priority: (v.priority as Priority) ?? "MEDIUM",
      status: (v.status as TaskStatus) ?? "TODO",
      baseBranch: v.baseBranch ?? null,
      subPath: v.subPath ?? null,
      versionId: v.versionId ?? null,
    },
  });
  // Set labels
  if (v.labelIds && v.labelIds.length > 0) {
    await db.taskLabel.createMany({
      data: v.labelIds.map((labelId) => ({ taskId: task.id, labelId })),
    });
  }
  revalidatePath("/workspaces");
  return task;
}

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  taskStatusSchema.parse(status);

  // Completing/cancelling a task whose execution is still RUNNING (e.g. Mission
  // Control's Complete/merge on a live card): finalize the execution
  // synchronously so getActiveExecutionsAcrossWorkspaces() stops returning it
  // immediately. Otherwise the PTY's async onExit is the only thing that flips
  // RUNNING→COMPLETED, and the 4s Missions poll re-adds the just-closed card as
  // an empty box until it fires. Runs before completeWorktreeReturn so its
  // COMPLETED-execution lookup (merge-commit recording) also finds this row.
  // Mirrors stopPtyExecution; the PTY onExit guard then no-ops (status !== RUNNING).
  if (status === "DONE" || status === "CANCELLED") {
    await db.taskExecution.updateMany({
      where: { taskId, status: "RUNNING" },
      data: { status: "COMPLETED", endedAt: new Date() },
    });
  }

  // Worktree completion: a worktree task reaching DONE runs the unified return
  // flow (merge into base + tear down worktree) BEFORE the status flip, so a
  // merge conflict / uncommitted changes abort (throw) without marking the task
  // done. Applies to every trigger — UI merge route, MCP move_task, orchestrator
  // — so completion leaves zero residue no matter who calls it. Returns
  // completed:false for direct tasks (no worktree on disk) → fall through.
  let worktreeCompleted = false;
  if (status === "DONE") {
    const pre = await db.task.findUnique({
      where: { id: taskId },
      include: { project: true },
    });
    if (pre?.baseBranch && pre.project?.localPath) {
      const { completeWorktreeReturn } = await import("@/lib/task-completion");
      const outcome = await completeWorktreeReturn(taskId, pre.project.localPath, pre.baseBranch);
      worktreeCompleted = outcome.completed;
    }
  }

  const task = await db.task.update({
    where: { id: taskId },
    // 进入 DONE 记录时间戳作为归档基准；离开 DONE 清空（编辑已完成任务不会重置倒计时）。
    data: { status, doneAt: status === "DONE" ? new Date() : null },
    include: { project: true },
  });

  // Direct mode DONE: record current HEAD as mergeCommit for diff archive.
  // Worktree tasks record their merge commit inside completeWorktreeReturn, so
  // skip here when that already ran.
  if (status === "DONE" && !worktreeCompleted && !task.baseBranch && task.project?.localPath) {
    try {
      const { execFileSync } = await import("child_process");
      const headCommit = execFileSync(
        "git", ["rev-parse", "HEAD"],
        { cwd: task.project.localPath, encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (headCommit) {
        const latestExec = await db.taskExecution.findFirst({
          where: { taskId },
          orderBy: { createdAt: "desc" },
        });
        if (latestExec) {
          await db.taskExecution.update({
            where: { id: latestExec.id },
            data: { mergeCommit: headCommit },
          });
        }
      }
    } catch {
      // Best effort
    }
  }

  // Dreaming: run insight analysis when task is DONE (not on every stop)
  if (status === "DONE") {
    import("@/lib/execution-summary").then(({ captureTaskDreaming }) => {
      captureTaskDreaming(taskId).catch(() => {});
    }).catch(() => {});

    // Auto-generate a change overview note ("任务笔记"). Worktree completion
    // already captured this before tearing down the worktree; only direct
    // tasks (which keep their tree) still need it here — fire-and-forget is
    // safe as there is no cleanup race for them.
    if (!worktreeCompleted) {
      import("@/lib/task-overview").then(({ captureTaskOverview }) => {
        captureTaskOverview(taskId).catch(() => {});
      }).catch(() => {});
    }
  }

  // Terminal states: kill PTY before any filesystem cleanup so the live
  // process doesn't end up with a deleted cwd (zombie). Must run BEFORE
  // removeWorktree below. Worktree completion already killed it.
  if ((status === "DONE" && !worktreeCompleted) || status === "CANCELLED") {
    try {
      const { destroySession } = await import("@/lib/pty/session-store");
      destroySession(taskId);
    } catch (error) {
      log.error("PTY session destroy failed", error, { taskId });
    }
  }

  // Capture a change overview BEFORE the worktree is removed, so a cancelled
  // task's partial work is preserved as a "任务笔记" note — useful experience
  // when the task is later restarted. Awaited (only the fast git-gather part)
  // so it runs before removeWorktree yanks the diff source. Never blocks cancel.
  if (status === "CANCELLED" && task.project?.localPath) {
    try {
      const { captureTaskOverview } = await import("@/lib/task-overview");
      await captureTaskOverview(taskId, { kind: "cancelled" });
    } catch (error) {
      log.error("Task overview capture failed", error, { taskId });
    }
  }

  // LC-01: Auto-cleanup worktree on CANCELLED (per D-03, D-04: only for GIT projects)
  if (status === "CANCELLED" && task.project?.localPath) {
    try {
      await removeWorktree(task.project.localPath, taskId);
    } catch (error) {
      log.error("Worktree cleanup failed", error, { taskId });
    }
  }

  // Status is already persisted above — this cache invalidation is a
  // fire-and-forget side effect. When called from the standalone MCP server
  // (move_task) there's no Next.js generation store, so revalidatePath throws
  // "Invariant: static generation store missing". Never let that failure make
  // a successful status transition report as an error to the caller.
  try {
    revalidatePath("/workspaces");
  } catch (error) {
    log.error("revalidatePath failed (non-fatal)", error, { taskId });
  }
  return task;
}

export async function updateTask(
  taskId: string,
  data: {
    title?: string;
    description?: string;
    priority?: Priority;
    labelIds?: string[];
    baseBranch?: string;
    subPath?: string;
    previewCommandOverride?: string | null;
    previewPortOverride?: number | null;
    versionId?: string | null;
  }
) {
  const v = updateTaskSchema.parse(data);
  const { labelIds, ...updateData } = v;
  const task = await db.task.update({
    where: { id: taskId },
    data: updateData,
  });
  // Update labels if provided
  if (labelIds !== undefined) {
    await setTaskLabels(taskId, labelIds);
  }
  revalidatePath("/workspaces");
  return task;
}

export async function toggleTaskPinned(taskId: string) {
  z.string().cuid().parse(taskId);
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { pinned: true },
  });
  const updated = await db.task.update({
    where: { id: taskId },
    data: { pinned: !task.pinned },
  });
  revalidatePath("/workspaces");
  return updated;
}

export async function deleteTask(taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });

  // Kill PTY first — removeWorktree --force would otherwise yank the cwd
  // from under the live process and leave it as a zombie.
  try {
    const { destroySession } = await import("@/lib/pty/session-store");
    destroySession(taskId);
  } catch {
    // best-effort
  }

  if (task?.project?.localPath) {
    try {
      await removeWorktree(task.project.localPath, taskId);
    } catch {
      // best-effort cleanup
    }
  }

  await db.task.delete({ where: { id: taskId } });
  revalidatePath("/workspaces");
}

export async function getProjectTasks(projectId: string) {
  const days = await getArchiveDelayDays();
  return db.task.findMany({
    where: {
      projectId,
      ...visibleTaskWhere(days),
    },
    orderBy: [{ pinned: "desc" }, { order: "asc" }, { createdAt: "desc" }],
  });
}

export async function searchTasks(query: string) {
  if (!query.trim()) return [];
  return db.task.findMany({
    where: {
      OR: [
        { title: { contains: query } },
        { description: { contains: query } },
      ],
    },
    include: {
      project: {
        include: { workspace: true },
      },
    },
    take: 20,
    orderBy: { updatedAt: "desc" },
  });
}

export async function getArchivedTasks(projectId: string) {
  const days = await getArchiveDelayDays();
  return db.task.findMany({
    where: {
      projectId,
      ...archivedTaskWhere(days),
    },
    include: {
      labels: { include: { label: true } },
      version: { select: { id: true, number: true, name: true } },
      executions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Check if a task's worktree has uncommitted changes.
 * Returns { clean: true } or { clean: false, files: string[] }
 */
export async function checkWorktreeClean(taskId: string): Promise<{
  clean: boolean;
  files: string[];
  hasCommits: boolean;
  lastCommitMessage: string | null;
  commitLog: string[];
  hasWorktree: boolean;
  baseBranch: string;
}> {
  const { execFileSync } = await import("child_process");
  const { existsSync } = await import("fs");

  const task = await db.task.findUnique({ where: { id: taskId } });
  const execution = await db.taskExecution.findFirst({
    where: { taskId },
    orderBy: { createdAt: "desc" },
  });

  const baseBranch = task?.baseBranch || "main";

  if (!execution?.worktreePath || !existsSync(execution.worktreePath)) {
    return { clean: true, files: [], hasCommits: false, lastCommitMessage: null, commitLog: [], hasWorktree: false, baseBranch };
  }

  const cwd = execution.worktreePath;

  try {
    // Check uncommitted files
    const status = execFileSync(
      "git", ["status", "--porcelain"],
      { cwd, encoding: "utf-8", timeout: 5000 }
    ).trim();
    const rawFiles = status ? status.split("\n").map((l) => l.trim()).filter(Boolean) : [];
    // Drop Tower-injected dependency symlinks (node_modules/.next): a `.gitignore`
    // written as `node_modules/` (trailing slash) matches dirs only, so git
    // reports the symlink as untracked and would otherwise block completion.
    const files = stripTowerLinkedStatus(rawFiles, cwd);
    const clean = files.length === 0;

    // Check if there are commits on the task branch beyond the fork point
    let hasCommits = false;
    let lastCommitMessage: string | null = null;
    let commitLog: string[] = [];
    try {
      const forkPoint = execFileSync(
        "git", ["merge-base", baseBranch, "HEAD"],
        { cwd, encoding: "utf-8", timeout: 5000 }
      ).trim();
      const commitCount = execFileSync(
        "git", ["rev-list", "--count", `${forkPoint}..HEAD`],
        { cwd, encoding: "utf-8", timeout: 5000 }
      ).trim();
      hasCommits = parseInt(commitCount, 10) > 0;
      if (hasCommits) {
        lastCommitMessage = execFileSync(
          "git", ["log", "-1", "--format=%B"],
          { cwd, encoding: "utf-8", timeout: 5000 }
        ).trim();
        const log = execFileSync(
          "git", ["log", "--oneline", `${forkPoint}..HEAD`],
          { cwd, encoding: "utf-8", timeout: 5000 }
        ).trim();
        commitLog = log ? log.split("\n").filter(Boolean) : [];
      }
    } catch {
      // ignore — fallback to no commits
    }

    return { clean, files, hasCommits, lastCommitMessage, commitLog, hasWorktree: true, baseBranch };
  } catch {
    return { clean: true, files: [], hasCommits: false, lastCommitMessage: null, commitLog: [], hasWorktree: true, baseBranch };
  }
}

export async function commitWorktreeChanges(taskId: string, message: string): Promise<{ hash: string }> {
  const { execFileSync } = await import("child_process");
  const { existsSync } = await import("fs");

  const execution = await db.taskExecution.findFirst({
    where: { taskId },
    orderBy: { createdAt: "desc" },
  });

  if (!execution?.worktreePath || !existsSync(execution.worktreePath)) {
    throw new Error("No active worktree for this task");
  }

  const cwd = execution.worktreePath;

  // Stage all changes
  execFileSync("git", ["add", "-A"], { cwd, timeout: 10000 });

  // Check if there's anything staged
  const status = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf-8", timeout: 5000 }).trim();
  if (!status) {
    throw new Error("No changes to commit");
  }

  // Commit with the provided message
  execFileSync("git", ["commit", "-m", message], { cwd, encoding: "utf-8", timeout: 15000 });

  // Get the commit hash
  const hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf-8", timeout: 5000 }).trim();

  return { hash };
}

export async function getTaskOverview(taskId: string) {
  if (!/^c[a-z0-9]{20,30}$/.test(taskId)) return null;
  return db.task.findUnique({
    where: { id: taskId },
    include: {
      labels: { include: { label: true } },
      version: { select: { id: true, number: true, name: true } },
      project: {
        select: { id: true, name: true, type: true, localPath: true, workspaceId: true },
      },
      executions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { summary: true, status: true, endedAt: true, gitStats: true, worktreePath: true },
      },
      _count: { select: { assets: true } },
    },
  });
}

export type TaskOverviewData = NonNullable<Awaited<ReturnType<typeof getTaskOverview>>>;

export async function getArchivedTaskCount(projectId: string) {
  const days = await getArchiveDelayDays();
  return db.task.count({
    where: {
      projectId,
      ...archivedTaskWhere(days),
    },
  });
}
