/** Add the minimal capability correlation and bounded grant stores. */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CapabilityGrant" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "taskId" TEXT NOT NULL,
      "capability" TEXT NOT NULL,
      "risk" TEXT NOT NULL,
      "targetKind" TEXT NOT NULL,
      "targetFingerprint" TEXT NOT NULL,
      "issuer" TEXT NOT NULL,
      "maxUses" INTEGER NOT NULL,
      "usedCount" INTEGER NOT NULL DEFAULT 0,
      "expiresAt" DATETIME NOT NULL,
      "revokedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "CapabilityGrant_taskId_capability_expiresAt_idx" ` +
      `ON "CapabilityGrant"("taskId", "capability", "expiresAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "CapabilityGrant_expiresAt_revokedAt_idx" ` +
      `ON "CapabilityGrant"("expiresAt", "revokedAt")`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CapabilityRequest" (
      "requestId" TEXT NOT NULL PRIMARY KEY,
      "taskId" TEXT NOT NULL,
      "schemaVersion" INTEGER NOT NULL DEFAULT 1,
      "capability" TEXT NOT NULL,
      "lane" TEXT NOT NULL,
      "risk" TEXT NOT NULL,
      "authorizationRef" TEXT,
      "inputDigest" TEXT NOT NULL,
      "inputsJson" TEXT NOT NULL,
      "state" TEXT NOT NULL DEFAULT 'PENDING',
      "gateway" TEXT,
      "jobRef" TEXT,
      "outboundId" TEXT,
      "revision" TEXT,
      "resultSummary" TEXT,
      "evidenceJson" TEXT,
      "lastError" TEXT,
      "completedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "CapabilityRequest_taskId_state_updatedAt_idx" ` +
      `ON "CapabilityRequest"("taskId", "state", "updatedAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "CapabilityRequest_state_updatedAt_idx" ` +
      `ON "CapabilityRequest"("state", "updatedAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "CapabilityRequest_jobRef_idx" ON "CapabilityRequest"("jobRef")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "CapabilityRequest_outboundId_idx" ON "CapabilityRequest"("outboundId")`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS "CapabilityRuntime_task_delete"
    AFTER DELETE ON "Task"
    BEGIN
      DELETE FROM "CapabilityGrant" WHERE "taskId" = OLD."id";
      DELETE FROM "CapabilityRequest" WHERE "taskId" = OLD."id";
    END
  `);
}
