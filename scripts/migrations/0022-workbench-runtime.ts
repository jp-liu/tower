/** Add the persisted Workbench operational runtime projection. */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "WorkbenchRuntime" (
      "taskId" TEXT NOT NULL PRIMARY KEY,
      "executionId" TEXT,
      "generation" INTEGER NOT NULL DEFAULT 1,
      "state" TEXT NOT NULL DEFAULT 'STARTING',
      "activeBatchId" TEXT,
      "pendingEvents" INTEGER NOT NULL DEFAULT 0,
      "oldestPendingAt" DATETIME,
      "lastHeartbeatAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastTurnCompletedAt" DATETIME,
      "blockedReason" TEXT,
      "lastError" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "WorkbenchRuntime_taskId_fkey"
        FOREIGN KEY ("taskId") REFERENCES "Task" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "WorkbenchRuntime_state_lastHeartbeatAt_idx" ` +
      `ON "WorkbenchRuntime"("state", "lastHeartbeatAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "WorkbenchRuntime_executionId_idx" ` +
      `ON "WorkbenchRuntime"("executionId")`,
  );
}
