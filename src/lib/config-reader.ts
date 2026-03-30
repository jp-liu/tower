/**
 * Thin config reader for non-Next.js server modules (process-manager, adapters).
 * Does NOT use "use server" or next/cache — safe to import from any Node.js context.
 * Mirrors the getConfigValue logic from config-actions.ts without Next.js dependencies.
 */
import { db } from "@/lib/db";

export async function readConfigValue<T>(key: string, defaultValue: T): Promise<T> {
  const row = await db.systemConfig.findUnique({ where: { key } });
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}
