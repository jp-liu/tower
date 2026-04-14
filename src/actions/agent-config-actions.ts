"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function getAgentConfigs() {
  return db.agentConfig.findMany({ orderBy: { agent: "asc" } });
}

export async function getDefaultAgentConfig() {
  return db.agentConfig.findFirst({ where: { isDefault: true } });
}

export async function updateAgentConfig(
  id: string,
  data: {
    appendPrompt?: string;
    settings?: string;
    isDefault?: boolean;
  }
) {
  const config = await db.agentConfig.update({
    where: { id },
    data,
  });
  revalidatePath("/settings");
  return config;
}

export async function createAgentConfig(data: {
  agent: string;
  configName: string;
  appendPrompt?: string;
  settings?: string;
}) {
  const config = await db.agentConfig.create({ data });
  revalidatePath("/settings");
  return config;
}

export async function deleteAgentConfig(id: string) {
  await db.agentConfig.delete({ where: { id } });
  revalidatePath("/settings");
}
