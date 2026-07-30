/** Add a durable task-to-human outbox and pending-delivery ask state. */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HarnessOutbound" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "dedupKey" TEXT NOT NULL,
      "taskId" TEXT NOT NULL,
      "executionId" TEXT,
      "harnessMessageId" TEXT NOT NULL,
      "gateway" TEXT NOT NULL,
      "downstream" TEXT,
      "dest" TEXT,
      "requestedTo" TEXT,
      "profile" TEXT,
      "scope" TEXT NOT NULL,
      "expectReply" INTEGER NOT NULL DEFAULT 0,
      "message" TEXT NOT NULL,
      "presentation" TEXT,
      "state" TEXT NOT NULL DEFAULT 'PENDING',
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "claimToken" TEXT,
      "claimExpiresAt" DATETIME,
      "platform" TEXT,
      "platformChatId" TEXT,
      "platformMessageId" TEXT,
      "lastError" TEXT,
      "nextAttemptAt" DATETIME,
      "deliveredAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "HarnessOutbound_taskId_fkey"
        FOREIGN KEY ("taskId") REFERENCES "Task" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "HarnessOutbound_harnessMessageId_fkey"
        FOREIGN KEY ("harnessMessageId") REFERENCES "HarnessMessage" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "HarnessOutbound_dedupKey_key" ON "HarnessOutbound"("dedupKey")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "HarnessOutbound_harnessMessageId_key" ON "HarnessOutbound"("harnessMessageId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "HarnessOutbound_state_nextAttemptAt_createdAt_idx" ` +
      `ON "HarnessOutbound"("state", "nextAttemptAt", "createdAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "HarnessOutbound_taskId_createdAt_idx" ` +
      `ON "HarnessOutbound"("taskId", "createdAt")`,
  );
}
