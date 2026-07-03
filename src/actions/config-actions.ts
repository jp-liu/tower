"use server";

import { db } from "@/lib/db";
import { CONFIG_DEFAULTS } from "@/lib/config-defaults";
import {
  ARCHIVE_DELAY_KEY,
  DEFAULT_ARCHIVE_DELAY_DAYS,
  normalizeArchiveDelayDays,
} from "@/lib/task-archive";
import { matchGitPathRule, gitUrlToLocalPath, type GitPathRule } from "@/lib/git-url";
import { detectShells, detectTerminalApps, detectEditors, type DetectedShell, type DetectedTerminalApp, type DetectedEditor } from "@/lib/platform";
// NOTE: `@/lib/pty/ws-server` is imported lazily inside getActualWsPort (below),
// not statically — it transitively pulls node-pty, whose native prebuild fails
// to load in the esbuild-bundled MCP server (dist/mcp-server.cjs). A static
// import here poisons every consumer of config-actions (e.g. task-actions →
// updateTaskStatus / move_task), crashing them at module-eval before any DB
// work runs. Keep the node-pty dependency out of the import graph.

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

/** 读取「归档期限（天）」配置，规整到 [0, 365]，非法值回退默认值。 */
export async function getArchiveDelayDays(): Promise<number> {
  const raw = await getConfigValue<number>(ARCHIVE_DELAY_KEY, DEFAULT_ARCHIVE_DELAY_DAYS);
  return normalizeArchiveDelayDays(raw);
}

/**
 * Where a resolved local path came from:
 * - `rule`     — matched a user-defined git.pathMappingRules entry
 * - `fallback` — no rule matched (or none configured); derived from the
 *                built-in default convention (gitUrlToLocalPath)
 * - `empty`    — no URL provided
 */
export type GitLocalPathSource = "rule" | "fallback" | "empty";

/**
 * Resolve a git URL to a local path AND report whether a user rule actually
 * matched. Lets the UI distinguish "your rule decided this" from "we guessed
 * with the default convention" — without that signal, an empty rule set looks
 * identical to a working one whenever the default happens to agree.
 */
export async function resolveGitLocalPathWithSource(
  url: string
): Promise<{ path: string; source: GitLocalPathSource }> {
  const trimmed = url.trim();
  if (!trimmed) return { path: "", source: "empty" };
  try {
    const rules = await getConfigValue<GitPathRule[]>("git.pathMappingRules", []);
    const matched = matchGitPathRule(trimmed, rules);
    if (matched) return { path: matched, source: "rule" };
    return { path: gitUrlToLocalPath(trimmed), source: "fallback" };
  } catch {
    return { path: gitUrlToLocalPath(trimmed), source: "fallback" };
  }
}

export async function resolveGitLocalPath(url: string): Promise<string> {
  const { path } = await resolveGitLocalPathWithSource(url);
  return path;
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

export async function getAvailableEditors(): Promise<DetectedEditor[]> {
  return detectEditors();
}

export async function getPlatformInfo(): Promise<{ platform: NodeJS.Platform }> {
  return { platform: process.platform };
}

/**
 * Get the actual WebSocket port the server is listening on.
 * May differ from config if the preferred port was occupied.
 */
export async function getActualWsPort(): Promise<number> {
  const { getActiveWsPort } = await import("@/lib/pty/ws-server");
  const active = getActiveWsPort();
  if (active !== null) return active;
  // Fallback to configured value if server hasn't started yet
  const httpPort = parseInt(process.env.PORT || "3000", 10);
  return getConfigValue<number>("terminal.wsPort", httpPort + 1);
}
