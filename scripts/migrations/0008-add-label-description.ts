/**
 * Add Label.description — a free-text hint on what kind of task a label fits.
 *
 * Read by create_task (MCP) so an agent picks a label by meaning instead of
 * guessing from its name. Backfills the built-in prd/bug starter labels so
 * existing installs get the guidance without a destructive re-seed (matched by
 * name, only when description is still empty — never clobbers a user edit).
 *
 * Additive raw SQL — never touches the notes_fts virtual tables (prisma db push
 * would hang). Idempotent: SQLite has no ADD COLUMN IF NOT EXISTS, so check
 * PRAGMA first.
 *
 * Table/column names hardcoded on purpose — a migration is a point-in-time
 * snapshot and must keep doing exactly what it did the day it shipped.
 */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  const cols = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("Label")`
  );
  const hasCol = Array.isArray(cols) && cols.some((c) => c.name === "description");
  if (!hasCol) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Label" ADD COLUMN "description" TEXT`);
    console.log("  added Label.description");
  }

  // Backfill the seeded starter labels; only touch rows without a description.
  await prisma.$executeRawUnsafe(
    `UPDATE "Label" SET "description" = '新功能、需求增强类任务' WHERE "name" = 'prd' AND ("description" IS NULL OR "description" = '')`
  );
  await prisma.$executeRawUnsafe(
    `UPDATE "Label" SET "description" = 'Bug 修复、缺陷修正类任务' WHERE "name" = 'bug' AND ("description" IS NULL OR "description" = '')`
  );
}
