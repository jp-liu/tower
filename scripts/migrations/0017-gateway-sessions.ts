/** Add durable gateway bindings, inbound envelopes, and retryable deliveries. */

import type { PrismaClient } from "@prisma/client";

type MigrationClient = Pick<PrismaClient, "$executeRawUnsafe">;

async function applyMigration(prisma: MigrationClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HarnessDelivery" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "harnessMessageId" TEXT NOT NULL,
      "taskId" TEXT NOT NULL,
      "platform" TEXT NOT NULL,
      "chatId" TEXT NOT NULL,
      "platformMessageId" TEXT NOT NULL,
      "scope" TEXT NOT NULL,
      "expectReply" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "HarnessDelivery_platformMessageId_key" ON "HarnessDelivery"("platformMessageId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "HarnessDelivery_taskId_idx" ON "HarnessDelivery"("taskId")`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GatewaySession" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "bindingKey" TEXT NOT NULL,
      "gateway" TEXT NOT NULL,
      "platform" TEXT NOT NULL,
      "chatId" TEXT NOT NULL,
      "threadId" TEXT,
      "rootMessageId" TEXT,
      "senderId" TEXT,
      "kind" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "projectId" TEXT NOT NULL,
      "workbenchTaskId" TEXT,
      "assistantSessionId" TEXT,
      "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "GatewaySession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  for (const statement of [
    `CREATE UNIQUE INDEX IF NOT EXISTS "GatewaySession_bindingKey_key" ON "GatewaySession"("bindingKey")`,
    `CREATE INDEX IF NOT EXISTS "GatewaySession_platform_chatId_threadId_status_idx" ON "GatewaySession"("platform", "chatId", "threadId", "status")`,
    `CREATE INDEX IF NOT EXISTS "GatewaySession_projectId_kind_status_idx" ON "GatewaySession"("projectId", "kind", "status")`,
    `CREATE INDEX IF NOT EXISTS "GatewaySession_senderId_lastActivityAt_idx" ON "GatewaySession"("senderId", "lastActivityAt")`,
  ]) await prisma.$executeRawUnsafe(statement);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GatewayInbound" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "dedupKey" TEXT NOT NULL,
      "sessionId" TEXT,
      "gateway" TEXT NOT NULL,
      "platform" TEXT NOT NULL,
      "chatId" TEXT NOT NULL,
      "senderId" TEXT,
      "platformMessageId" TEXT NOT NULL,
      "threadId" TEXT,
      "rootMessageId" TEXT,
      "replyToMessageId" TEXT,
      "intent" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "state" TEXT NOT NULL DEFAULT 'RECEIVED',
      "createdTaskId" TEXT,
      "response" TEXT,
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "lastError" TEXT,
      "processedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "GatewayInbound_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GatewaySession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  for (const statement of [
    `CREATE UNIQUE INDEX IF NOT EXISTS "GatewayInbound_dedupKey_key" ON "GatewayInbound"("dedupKey")`,
    `CREATE INDEX IF NOT EXISTS "GatewayInbound_platform_chatId_platformMessageId_idx" ON "GatewayInbound"("platform", "chatId", "platformMessageId")`,
    `CREATE INDEX IF NOT EXISTS "GatewayInbound_sessionId_state_createdAt_idx" ON "GatewayInbound"("sessionId", "state", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "GatewayInbound_senderId_processedAt_idx" ON "GatewayInbound"("senderId", "processedAt")`,
    `CREATE INDEX IF NOT EXISTS "GatewayInbound_createdTaskId_idx" ON "GatewayInbound"("createdTaskId")`,
  ]) await prisma.$executeRawUnsafe(statement);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GatewayDelivery" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "dedupKey" TEXT NOT NULL,
      "sessionId" TEXT NOT NULL,
      "inboundId" TEXT,
      "kind" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "state" TEXT NOT NULL DEFAULT 'PENDING',
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "platformMessageId" TEXT,
      "lastError" TEXT,
      "nextAttemptAt" DATETIME,
      "deliveredAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "GatewayDelivery_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GatewaySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "GatewayDelivery_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "GatewayInbound" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  for (const statement of [
    `CREATE UNIQUE INDEX IF NOT EXISTS "GatewayDelivery_dedupKey_key" ON "GatewayDelivery"("dedupKey")`,
    `CREATE INDEX IF NOT EXISTS "GatewayDelivery_state_nextAttemptAt_createdAt_idx" ON "GatewayDelivery"("state", "nextAttemptAt", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "GatewayDelivery_sessionId_createdAt_idx" ON "GatewayDelivery"("sessionId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "GatewayDelivery_inboundId_idx" ON "GatewayDelivery"("inboundId")`,
  ]) await prisma.$executeRawUnsafe(statement);
}

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (transaction) => applyMigration(transaction));
}
