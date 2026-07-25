/** Add Tower-owned, provider-neutral Assistant sessions and messages. */

import type { PrismaClient } from "@prisma/client";

type MigrationClient = Pick<PrismaClient, "$executeRawUnsafe">;

async function applyMigration(prisma: MigrationClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AssistantSession" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL DEFAULT 'New Session',
      "workspaceId" TEXT,
      "workspaceNameSnapshot" TEXT,
      "projectId" TEXT,
      "projectNameSnapshot" TEXT,
      "versionId" TEXT,
      "versionNameSnapshot" TEXT,
      "legacySource" TEXT,
      "legacyId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AssistantSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "AssistantSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "AssistantSession_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AssistantTurn" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "clientTurnId" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'STREAMING',
      "userMessageId" TEXT,
      "assistantMessageId" TEXT,
      "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "completedAt" DATETIME,
      CONSTRAINT "AssistantTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AssistantMessage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "turnId" TEXT,
      "sequence" INTEGER NOT NULL,
      "role" TEXT NOT NULL,
      "partsJson" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'COMPLETE',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AssistantMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "AssistantMessage_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "AssistantTurn" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);

  const statements = [
    `CREATE UNIQUE INDEX IF NOT EXISTS "AssistantSession_legacySource_legacyId_key" ON "AssistantSession"("legacySource", "legacyId")`,
    `CREATE INDEX IF NOT EXISTS "AssistantSession_lastMessageAt_idx" ON "AssistantSession"("lastMessageAt")`,
    `CREATE INDEX IF NOT EXISTS "AssistantSession_workspaceId_idx" ON "AssistantSession"("workspaceId")`,
    `CREATE INDEX IF NOT EXISTS "AssistantSession_projectId_idx" ON "AssistantSession"("projectId")`,
    `CREATE INDEX IF NOT EXISTS "AssistantSession_versionId_idx" ON "AssistantSession"("versionId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "AssistantTurn_sessionId_clientTurnId_key" ON "AssistantTurn"("sessionId", "clientTurnId")`,
    `CREATE INDEX IF NOT EXISTS "AssistantTurn_sessionId_startedAt_idx" ON "AssistantTurn"("sessionId", "startedAt")`,
    `CREATE INDEX IF NOT EXISTS "AssistantTurn_status_idx" ON "AssistantTurn"("status")`,
    `CREATE INDEX IF NOT EXISTS "AssistantMessage_sessionId_createdAt_idx" ON "AssistantMessage"("sessionId", "createdAt")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "AssistantMessage_sessionId_sequence_key" ON "AssistantMessage"("sessionId", "sequence")`,
    `CREATE INDEX IF NOT EXISTS "AssistantMessage_turnId_idx" ON "AssistantMessage"("turnId")`,
    `CREATE INDEX IF NOT EXISTS "AssistantMessage_status_idx" ON "AssistantMessage"("status")`,
  ];
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
}

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (transaction) => applyMigration(transaction));
}
