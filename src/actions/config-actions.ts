"use server";

import { db } from "@/lib/db";
import { CONFIG_DEFAULTS } from "@/lib/config-defaults";

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
