"use server";

import path from "node:path";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { providerRegistry } from "@/lib/ai/providers";

function getAllowedCommands(): string[] {
  const fromRegistry = providerRegistry.getAllowedCommands();
  return [...new Set([...fromRegistry, "claude-code"])];
}

const BLOCKED_ENV_KEYS = new Set([
  "PATH", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES",
  "LD_LIBRARY_PATH", "HOME", "SHELL", "USER",
  "DYLD_LIBRARY_PATH", "NODE_OPTIONS",
]);

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
  // Validate command against allowlist
  if (data.command !== undefined) {
    const basename = path.basename(data.command);
    const allowed = getAllowedCommands();
    if (!allowed.includes(basename)) {
      throw new Error(
        `command must be one of: ${allowed.join(", ")} (got: ${basename})`
      );
    }
  }

  // Validate baseArgs — must be JSON array of strings, no shell metacharacters
  if (data.baseArgs !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.baseArgs);
    } catch {
      throw new Error("baseArgs 格式无效，必须是 JSON 数组");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("baseArgs 格式无效，必须是 JSON 数组");
    }
    for (const arg of parsed) {
      if (typeof arg !== "string") {
        throw new Error("baseArgs 中每个元素必须是字符串");
      }
      if (/[;&|`$()]/.test(arg)) {
        throw new Error(`baseArgs 包含不允许的字符: ${arg}`);
      }
    }
  }

  // Validate envVars — must be JSON object, block dangerous keys
  if (data.envVars !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.envVars);
    } catch {
      throw new Error("envVars 格式无效，必须是 JSON 对象");
    }
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
      throw new Error("envVars 格式无效，必须是 JSON 对象");
    }
    for (const key of Object.keys(parsed as Record<string, unknown>)) {
      if (BLOCKED_ENV_KEYS.has(key.toUpperCase())) {
        throw new Error(`envVars 不允许设置系统关键变量: ${key}`);
      }
    }
  }

  try {
    const updated = await db.cliProfile.update({
      where: { id },
      data,
    });
    revalidatePath("/settings");
    return updated;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2025") {
      throw new Error("CLI Profile 不存在，请检查配置");
    }
    throw err;
  }
}
