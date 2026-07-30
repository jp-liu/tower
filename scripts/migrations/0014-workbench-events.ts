/** Add the durable Workbench child-event inbox. */

import type { PrismaClient } from "@prisma/client";

type MigrationClient = Pick<PrismaClient, "$executeRawUnsafe">;

async function applyMigration(prisma: MigrationClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WorkbenchEvent" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "parentTaskId" TEXT NOT NULL,
      "sourceTaskId" TEXT NOT NULL,
      "executionId" TEXT,
      "kind" TEXT NOT NULL,
      "priority" TEXT NOT NULL DEFAULT 'NORMAL',
      "dedupKey" TEXT NOT NULL,
      "payload" TEXT NOT NULL,
      "state" TEXT NOT NULL DEFAULT 'PENDING',
      "claimToken" TEXT,
      "claimedAt" DATETIME,
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "lastError" TEXT,
      "consumedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "WorkbenchEvent_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "WorkbenchEvent_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "WorkbenchEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "TaskExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);

  const statements = [
    `CREATE UNIQUE INDEX IF NOT EXISTS "WorkbenchEvent_dedupKey_key" ON "WorkbenchEvent"("dedupKey")`,
    `CREATE INDEX IF NOT EXISTS "WorkbenchEvent_parentTaskId_state_priority_createdAt_idx" ON "WorkbenchEvent"("parentTaskId", "state", "priority", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "WorkbenchEvent_sourceTaskId_idx" ON "WorkbenchEvent"("sourceTaskId")`,
    `CREATE INDEX IF NOT EXISTS "WorkbenchEvent_executionId_idx" ON "WorkbenchEvent"("executionId")`,
    `CREATE INDEX IF NOT EXISTS "WorkbenchEvent_state_claimedAt_idx" ON "WorkbenchEvent"("state", "claimedAt")`,
  ];
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
}

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (transaction) => applyMigration(transaction));
}
