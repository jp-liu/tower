/** Add Tower-managed CLI plugin configuration without touching existing rows. */

import type { PrismaClient } from "@prisma/client";

type Column = { name: string };

const COLUMNS = [
  ["commandOverride", "TEXT"],
  ["baseArgsJson", "TEXT NOT NULL DEFAULT '[]'"],
  ["envVarsJson", "TEXT NOT NULL DEFAULT '[]'"],
  ["settingsJson", "TEXT NOT NULL DEFAULT '{}'"],
  ["resolvedCommand", "TEXT"],
  ["resolvedVersion", "TEXT"],
] as const;

export async function up(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Column[]>(`PRAGMA table_info("ProviderConnection")`);
  const existing = new Set(rows.map((row) => row.name));
  for (const [name, definition] of COLUMNS) {
    if (existing.has(name)) continue;
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "ProviderConnection" ADD COLUMN "${name}" ${definition}`,
    );
  }
}
