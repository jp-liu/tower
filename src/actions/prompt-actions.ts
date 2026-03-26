"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function getPrompts(workspaceId?: string) {
  return db.agentPrompt.findMany({
    where: workspaceId
      ? { OR: [{ workspaceId }, { workspaceId: null }] }
      : {},
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

export async function getPromptById(id: string) {
  return db.agentPrompt.findUnique({ where: { id } });
}

export async function createPrompt(data: {
  name: string;
  description?: string;
  content: string;
  isDefault?: boolean;
  workspaceId?: string;
}) {
  const prompt = await db.agentPrompt.create({ data });
  revalidatePath("/workspaces");
  revalidatePath("/settings");
  return prompt;
}

export async function updatePrompt(
  id: string,
  data: { name?: string; description?: string; content?: string; isDefault?: boolean }
) {
  const prompt = await db.agentPrompt.update({ where: { id }, data });
  revalidatePath("/workspaces");
  revalidatePath("/settings");
  return prompt;
}

export async function deletePrompt(id: string) {
  await db.agentPrompt.delete({ where: { id } });
  revalidatePath("/workspaces");
  revalidatePath("/settings");
}
