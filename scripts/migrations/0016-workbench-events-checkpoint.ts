/** Record the lower bound for missing Workbench execution-event recovery. */

import type { PrismaClient } from "@prisma/client";

type MigrationClient = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe">;

const CONFIG_KEY = "workbench.eventsEnabledAt";
const WORKBENCH_MIGRATION_ID = "0014-workbench-events";

async function applyMigration(prisma: MigrationClient): Promise<void> {
  const existing = await prisma.$queryRawUnsafe<Array<{ value: string }>>(
    `SELECT "value" FROM "SystemConfig" WHERE "key" = ? LIMIT 1`,
    CONFIG_KEY,
  );
  if (existing.length > 0) return;

  let enabledAt = new Date();
  try {
    const applied = await prisma.$queryRawUnsafe<Array<{ appliedAt: Date | string }>>(
      `SELECT "appliedAt" FROM "AppliedMigration" WHERE "id" = ? LIMIT 1`,
      WORKBENCH_MIGRATION_ID,
    );
    if (applied[0]?.appliedAt) enabledAt = new Date(applied[0].appliedAt);
  } catch {
    // The normal runner always has the ledger. Standalone/manual migration
    // callers fall back to now rather than risk replaying unknown history.
  }

  await prisma.$executeRawUnsafe(
    `INSERT OR IGNORE INTO "SystemConfig" (` +
      `"id", "key", "value", "createdAt", "updatedAt"` +
      `) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    "workbench-events-enabled-at",
    CONFIG_KEY,
    JSON.stringify(enabledAt.toISOString()),
  );
}

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (transaction) => applyMigration(transaction));
}
