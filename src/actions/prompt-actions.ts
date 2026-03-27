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

const MAX_PROMPT_CONTENT_LENGTH = 100_000;

export async function createPrompt(data: {
  name: string;
  description?: string;
  content: string;
  isDefault?: boolean;
  workspaceId?: string;
}) {
  if (data.content.length > MAX_PROMPT_CONTENT_LENGTH) {
    throw new Error(`Prompt content exceeds maximum length of ${MAX_PROMPT_CONTENT_LENGTH} characters`);
  }
  const prompt = await db.agentPrompt.create({ data });
  revalidatePath("/workspaces");
  revalidatePath("/settings");
  return prompt;
}

export async function updatePrompt(
  id: string,
  data: { name?: string; description?: string; content?: string; isDefault?: boolean }
) {
  if (data.content && data.content.length > MAX_PROMPT_CONTENT_LENGTH) {
    throw new Error(`Prompt content exceeds maximum length of ${MAX_PROMPT_CONTENT_LENGTH} characters`);
  }
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

export async function setDefaultPrompt(promptId: string, workspaceId?: string) {
  return db.$transaction(async (tx) => {
    // Clear all existing defaults in scope
    const whereClause = workspaceId
      ? { workspaceId, isDefault: true }
      : { isDefault: true };
    await tx.agentPrompt.updateMany({
      where: whereClause,
      data: { isDefault: false },
    });
    // Set new default
    const prompt = await tx.agentPrompt.update({
      where: { id: promptId },
      data: { isDefault: true },
    });
    revalidatePath("/workspaces");
    revalidatePath("/settings");
    return prompt;
  });
}
