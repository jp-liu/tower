"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import type { TaskStatus, Priority } from "@prisma/client";

export async function createTask(data: {
  title: string;
  description?: string;
  projectId: string;
  priority?: Priority;
  status?: TaskStatus;
}) {
  const task = await db.task.create({
    data: {
      title: data.title,
      description: data.description,
      projectId: data.projectId,
      priority: data.priority ?? "MEDIUM",
      status: data.status ?? "TODO",
    },
  });
  revalidatePath("/workspaces");
  return task;
}

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const task = await db.task.update({
    where: { id: taskId },
    data: { status },
  });
  revalidatePath("/workspaces");
  return task;
}

export async function updateTask(
  taskId: string,
  data: { title?: string; description?: string; priority?: Priority }
) {
  const task = await db.task.update({
    where: { id: taskId },
    data,
  });
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
