"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { createLabelSchema } from "@/lib/schemas";

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
  const v = createLabelSchema.parse(data);
  const label = await db.label.create({
    data: {
      name: v.name,
      color: v.color,
      workspaceId: v.workspaceId,
    },
  });
  revalidatePath("/workspaces");
  return label;
}

// Delete a custom label (not builtin)
export async function deleteLabel(id: string) {
  const label = await db.label.findUnique({ where: { id } });
  if (!label) throw new Error("Label not found");
  if (label.isBuiltin) throw new Error("Cannot delete builtin labels");
  await db.label.delete({ where: { id } });
  revalidatePath("/workspaces");
}

// Set labels on a task (replace all) — wrapped in transaction for atomicity
export async function setTaskLabels(taskId: string, labelIds: string[]) {
  await db.$transaction(async (tx) => {
    await tx.taskLabel.deleteMany({ where: { taskId } });
    if (labelIds.length > 0) {
      await tx.taskLabel.createMany({
        data: labelIds.map((labelId) => ({ taskId, labelId })),
      });
    }
  });
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
