/** Add the durable Workbench batch acknowledgement lifecycle. */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WorkbenchBatch" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "parentTaskId" TEXT NOT NULL,
      "eventIds" TEXT NOT NULL,
      "prompt" TEXT NOT NULL,
      "state" TEXT NOT NULL DEFAULT 'CLAIMED',
      "dispatchAttempts" INTEGER NOT NULL DEFAULT 0,
      "dispatchedAt" DATETIME,
      "ackedAt" DATETIME,
      "resolvedAt" DATETIME,
      "lastError" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "WorkbenchBatch_parentTaskId_fkey"
        FOREIGN KEY ("parentTaskId") REFERENCES "Task" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "WorkbenchBatch_parentTaskId_state_createdAt_idx" ` +
      `ON "WorkbenchBatch"("parentTaskId", "state", "createdAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "WorkbenchBatch_state_dispatchedAt_idx" ` +
      `ON "WorkbenchBatch"("state", "dispatchedAt")`,
  );

  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("WorkbenchEvent")`,
  );
  if (!columns.some((column) => column.name === "batchId")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkbenchEvent" ADD COLUMN "batchId" TEXT`);
  }
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "WorkbenchEvent_batchId_idx" ON "WorkbenchEvent"("batchId")`,
  );
}
