"use server";

import { db } from "@/lib/db";
import { CONFIG_DEFAULTS } from "@/lib/config-defaults";
import { matchGitPathRule, gitUrlToLocalPath, type GitPathRule } from "@/lib/git-url";
import { detectShells, detectTerminalApps, type DetectedShell, type DetectedTerminalApp } from "@/lib/platform";
import { getActiveWsPort } from "@/lib/pty/ws-server";

export async function getConfigValue<T>(key: string, defaultValue: T): Promise<T> {
  const row = await db.systemConfig.findUnique({ where: { key } });
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

export async function setConfigValue(key: string, value: unknown): Promise<void> {
  await db.systemConfig.upsert({
    where: { key },
    create: { key, value: JSON.stringify(value) },
    update: { value: JSON.stringify(value) },
  });
  // Note: revalidatePath("/settings") omitted — settings page is a client component,
  // revalidatePath has no effect. Real reactivity is Phase 14 (CFG-02).
}

export async function resolveGitLocalPath(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const rules = await getConfigValue<GitPathRule[]>("git.pathMappingRules", []);
    const matched = matchGitPathRule(trimmed, rules);
    if (matched) return matched;
    return gitUrlToLocalPath(trimmed);
  } catch {
    return gitUrlToLocalPath(trimmed);
  }
}

export async function getConfigValues(keys: string[]): Promise<Record<string, unknown>> {
  const rows = await db.systemConfig.findMany({
    where: { key: { in: keys } },
  });
  const stored = Object.fromEntries(
    rows.map((r) => {
      try {
        return [r.key, JSON.parse(r.value)];
      } catch {
        return [r.key, null];
      }
    })
  );
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = key in stored ? stored[key] : (CONFIG_DEFAULTS[key]?.defaultValue ?? null);
  }
  return result;
}

export async function getAvailableShells(): Promise<DetectedShell[]> {
  return detectShells();
}

export async function getAvailableTerminalApps(): Promise<DetectedTerminalApp[]> {
  return detectTerminalApps();
}

export async function getPlatformInfo(): Promise<{ platform: NodeJS.Platform }> {
  return { platform: process.platform };
}

/**
 * Get the actual WebSocket port the server is listening on.
 * May differ from config if the preferred port was occupied.
 */
export async function getActualWsPort(): Promise<number> {
  const active = getActiveWsPort();
  if (active !== null) return active;
  // Fallback to configured value if server hasn't started yet
  const httpPort = parseInt(process.env.PORT || "3000", 10);
  return getConfigValue<number>("terminal.wsPort", httpPort + 1);
}
