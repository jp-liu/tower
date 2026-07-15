"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { createLabelSchema, updateLabelSchema } from "@/lib/schemas";

// `isBuiltin` marks exactly one label: Tower's own marker on workbench tasks,
// whose name TOWER_LABEL_NAME is matched on and whose row nothing may touch
// (see ensureTowerLabel, which also clears the flag from every other label).
// Every other label — system-level (workspaceId null) or workspace-scoped — is
// the user's to rename, re-prefix and delete.
const isTowerLabel = (label: { isBuiltin: boolean }) => label.isBuiltin;

// Get all labels available for a workspace: system-level ones (workspaceId null
// → visible everywhere) plus the ones scoped to this workspace.
//
// Visibility keys off `workspaceId`, NOT `isBuiltin` — the latter is only the
// "this is Tower's own marker, hands off" bit.
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

// Update a label. Omitted fields are left alone; a null / "" branchPrefix clears
// it, dropping the label back to the configured default prefix.
export async function updateLabel(
  id: string,
  data: { name?: string; branchPrefix?: string | null }
) {
  const v = updateLabelSchema.parse({
    ...(data.name !== undefined && { name: data.name.trim() }),
    ...(data.branchPrefix !== undefined && { branchPrefix: data.branchPrefix?.trim() || null }),
  });
  const label = await db.label.findUnique({ where: { id } });
  if (!label) throw new Error("Label not found");
  // Refused server-side, not merely hidden in the UI: the Tower label is looked
  // up by name and carries no branch of its own.
  if (isTowerLabel(label)) throw new Error("Cannot edit the Tower label");
  const updated = await db.label.update({
    where: { id },
    data: {
      ...(v.name !== undefined && { name: v.name }),
      ...(v.branchPrefix !== undefined && { branchPrefix: v.branchPrefix }),
    },
  });
  revalidatePath("/workspaces");
  return updated;
}

// Delete a label. Only Tower's own marker is off limits.
export async function deleteLabel(id: string) {
  const label = await db.label.findUnique({ where: { id } });
  if (!label) throw new Error("Label not found");
  if (isTowerLabel(label)) throw new Error("Cannot delete the Tower label");
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
