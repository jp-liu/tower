/**
 * Backfill Task.doneAt for tasks finished before the "归档期限" feature shipped.
 *
 * The feature keeps a DONE task on the board for N days after it entered Done,
 * keyed on the new `doneAt` column. Tasks completed before this column existed
 * (doneAt = null) are treated as "already archived" by the board query and
 * vanish the moment a user upgrades. Use `updatedAt` as the best-available
 * proxy for when the task reached Done, so recently-finished work stays visible
 * for the configured window instead of disappearing on upgrade.
 *
 * Idempotent: only touches DONE rows where doneAt IS NULL. CANCELLED tasks
 * archive off `updatedAt` directly and need no doneAt. Raw SQL because Prisma
 * updateMany cannot set one column from another (doneAt = updatedAt).
 *
 * Table/column names hardcoded on purpose — a migration is a point-in-time
 * snapshot and must keep doing exactly what it did the day it shipped.
 */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  const count = await prisma.$executeRaw`
    UPDATE "Task" SET "doneAt" = "updatedAt"
    WHERE "status" = 'DONE' AND "doneAt" IS NULL
  `;
  if (count > 0) {
    console.log(`  backfilled doneAt for ${count} done task(s)`);
  }
}
