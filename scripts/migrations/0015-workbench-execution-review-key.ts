/** Add the cross-producer execution review guard to the Workbench inbox. */

import type { PrismaClient } from "@prisma/client";

type MigrationClient = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe">;

async function applyMigration(prisma: MigrationClient): Promise<void> {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("WorkbenchEvent")`,
  );
  if (!columns.some((column) => column.name === "executionReviewKey")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "WorkbenchEvent" ADD COLUMN "executionReviewKey" TEXT`,
    );
  }
  // Databases that ran 0014 from the previous release candidate can already
  // contain stop-hook rows. Give one review/decision row per execution the
  // guard before enabling the unique index, so a later success fallback sees it.
  await prisma.$executeRawUnsafe(`
    UPDATE "WorkbenchEvent"
    SET "executionReviewKey" = 'execution-review:' || "sourceTaskId" || ':' || "executionId"
    WHERE "executionReviewKey" IS NULL
      AND "executionId" IS NOT NULL
      AND "kind" IN ('CHILD_REVIEW_REQUIRED', 'CHILD_DECISION_REQUIRED')
      AND "id" IN (
        SELECT MIN("id")
        FROM "WorkbenchEvent"
        WHERE "executionId" IS NOT NULL
          AND "kind" IN ('CHILD_REVIEW_REQUIRED', 'CHILD_DECISION_REQUIRED')
        GROUP BY "sourceTaskId", "executionId"
      )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "WorkbenchEvent_executionReviewKey_key" ON "WorkbenchEvent"("executionReviewKey")`,
  );
}

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (transaction) => applyMigration(transaction));
}
