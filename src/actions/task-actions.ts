"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { setTaskLabels } from "@/actions/label-actions";
import { removeWorktree } from "@/lib/worktree";
import type { TaskStatus, Priority } from "@prisma/client";

export async function createTask(data: {
  title: string;
  description?: string;
  projectId: string;
  priority?: Priority;
  status?: TaskStatus;
  labelIds?: string[];
  baseBranch?: string;
}) {
  const task = await db.task.create({
    data: {
      title: data.title,
      description: data.description,
      projectId: data.projectId,
      priority: data.priority ?? "MEDIUM",
      status: data.status ?? "TODO",
      baseBranch: data.baseBranch ?? null,
    },
  });
  // Set labels
  if (data.labelIds && data.labelIds.length > 0) {
    await db.taskLabel.createMany({
      data: data.labelIds.map((labelId) => ({ taskId: task.id, labelId })),
    });
  }
  revalidatePath("/workspaces");
  return task;
}

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const task = await db.task.update({
    where: { id: taskId },
    data: { status },
  });

  // LC-01: Auto-cleanup worktree on CANCELLED (per D-03)
  if (status === "CANCELLED") {
    // Load project to get localPath (per D-04: only for GIT projects)
    const taskWithProject = await db.task.findUnique({
      where: { id: taskId },
      include: { project: true },
    });
    if (taskWithProject?.project?.localPath) {
      try {
        await removeWorktree(taskWithProject.project.localPath, taskId);
      } catch (error) {
        console.error("[updateTaskStatus] Worktree cleanup failed:", error);
      }
    }
  }

  revalidatePath("/workspaces");
  return task;
}

export async function updateTask(
  taskId: string,
  data: { title?: string; description?: string; priority?: Priority; labelIds?: string[]; baseBranch?: string }
) {
  const { labelIds, ...updateData } = data;
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
