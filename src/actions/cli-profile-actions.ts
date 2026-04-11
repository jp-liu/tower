"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function getDefaultCliProfile() {
  const profile = await db.cliProfile.findFirst({ where: { isDefault: true } });
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.name,
    command: profile.command,
    baseArgs: profile.baseArgs,
    envVars: profile.envVars,
  };
}

export async function updateCliProfile(
  id: string,
  data: { command?: string; baseArgs?: string; envVars?: string }
) {
  if (data.baseArgs !== undefined) {
    try {
      const parsed = JSON.parse(data.baseArgs);
      if (!Array.isArray(parsed)) {
        throw new Error("baseArgs must be a JSON array");
      }
    } catch {
      throw new Error("baseArgs 格式无效，必须是 JSON 数组");
    }
  }

  if (data.envVars !== undefined) {
    try {
      const parsed = JSON.parse(data.envVars);
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
        throw new Error("envVars must be a JSON object");
      }
    } catch {
      throw new Error("envVars 格式无效，必须是 JSON 对象");
    }
  }

  const updated = await db.cliProfile.update({
    where: { id },
    data,
  });

  revalidatePath("/settings");
  return updated;
}
