"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { setTaskLabels } from "@/actions/label-actions";
import { removeWorktree } from "@/lib/worktree";
import { createTaskSchema, updateTaskSchema, taskStatusSchema } from "@/lib/schemas";
import { logger } from "@/lib/logger";
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
  const task = await db.task.update({
    where: { id: taskId },
    data: { status },
    include: { project: true },
  });

  // LC-01: Auto-cleanup worktree on CANCELLED (per D-03, D-04: only for GIT projects)
  if (status === "CANCELLED" && task.project?.localPath) {
    try {
      await removeWorktree(task.project.localPath, taskId);
    } catch (error) {
      log.error("Worktree cleanup failed", error, { taskId });
    }
  }

  revalidatePath("/workspaces");
  return task;
}

export async function updateTask(
  taskId: string,
  data: { title?: string; description?: string; priority?: Priority; labelIds?: string[]; baseBranch?: string; subPath?: string }
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

export async function deleteTask(taskId: string) {
  // Clean up worktree + PTY session before deleting DB record
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });

  if (task?.project?.localPath) {
    try {
      await removeWorktree(task.project.localPath, taskId);
    } catch {
      // best-effort cleanup
    }
  }

  // Kill any running PTY session
  try {
    const { destroySession } = await import("@/lib/pty/session-store");
    destroySession(taskId);
  } catch {
    // best-effort
  }

  await db.task.delete({ where: { id: taskId } });
  revalidatePath("/workspaces");
}

export async function getProjectTasks(projectId: string) {
  return db.task.findMany({
    where: { projectId },
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return db.task.findMany({
    where: {
      projectId,
      status: { in: ["DONE", "CANCELLED"] },
      updatedAt: { lt: today },
    },
    include: {
      labels: { include: { label: true } },
      executions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getArchivedTaskCount(projectId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return db.task.count({
    where: {
      projectId,
      status: { in: ["DONE", "CANCELLED"] },
      updatedAt: { lt: today },
    },
  });
}
