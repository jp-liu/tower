"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { createLabelSchema } from "@/lib/schemas";
import { isValidBranchPrefix } from "@/lib/worktree-branch";

// Get all labels available for a workspace: system-level ones (workspaceId null
// → visible everywhere) plus the ones scoped to this workspace.
//
// Visibility keys off `workspaceId`, NOT `isBuiltin` — the latter is only a
// "cannot be edited or deleted" protection bit (currently just the Tower label).
// A system-level label is freely creatable and deletable.
export async function getLabelsForWorkspace(workspaceId: string) {
  return db.label.findMany({
    where: {
      OR: [
        { workspaceId: null },
        { workspaceId },
      ],
    },
    orderBy: [{ isBuiltin: "desc" }, { name: "asc" }],
  });
}

// Create a label. `workspaceId: null` makes it system-level (every workspace).
export async function createLabel(data: {
  name: string;
  color: string;
  workspaceId: string | null;
  branchPrefix?: string | null;
}) {
  const v = createLabelSchema.parse(data);
  const label = await db.label.create({
    data: {
      name: v.name,
      color: v.color,
      workspaceId: v.workspaceId,
      branchPrefix: v.branchPrefix ?? null,
    },
  });
  revalidatePath("/workspaces");
  return label;
}

// Update a label's worktree branch prefix. Pass null / "" to clear it, which
// drops the label back to the configured default prefix.
export async function updateLabelBranchPrefix(id: string, branchPrefix: string | null) {
  const prefix = branchPrefix?.trim() || null;
  if (prefix !== null && !isValidBranchPrefix(prefix)) {
    throw new Error("Invalid branch prefix");
  }
  const label = await db.label.findUnique({ where: { id } });
  if (!label) throw new Error("Label not found");
  if (label.isBuiltin) throw new Error("Cannot edit builtin labels");
  const updated = await db.label.update({
    where: { id },
    data: { branchPrefix: prefix },
  });
  revalidatePath("/workspaces");
  return updated;
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
