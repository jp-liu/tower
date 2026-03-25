"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

// Get all labels available for a workspace (builtin + workspace-specific)
export async function getLabelsForWorkspace(workspaceId: string) {
  return db.label.findMany({
    where: {
      OR: [
        { isBuiltin: true },
        { workspaceId },
      ],
    },
    orderBy: [{ isBuiltin: "desc" }, { name: "asc" }],
  });
}

// Create a custom label for a workspace
export async function createLabel(data: {
  name: string;
  color: string;
  workspaceId: string;
}) {
  const label = await db.label.create({
    data: {
      name: data.name,
      color: data.color,
      workspaceId: data.workspaceId,
    },
  });
  revalidatePath("/workspaces");
  return label;
}

// Delete a custom label (not builtin)
export async function deleteLabel(id: string) {
  await db.label.delete({ where: { id } });
  revalidatePath("/workspaces");
}

// Set labels on a task (replace all)
export async function setTaskLabels(taskId: string, labelIds: string[]) {
  // Delete existing
  await db.taskLabel.deleteMany({ where: { taskId } });
  // Create new
  if (labelIds.length > 0) {
    await db.taskLabel.createMany({
      data: labelIds.map((labelId) => ({ taskId, labelId })),
    });
  }
  revalidatePath("/workspaces");
}

// Get labels for a task
export async function getTaskLabels(taskId: string) {
  const taskLabels = await db.taskLabel.findMany({
    where: { taskId },
    include: { label: true },
  });
  return taskLabels.map((tl) => tl.label);
}
