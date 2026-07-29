/** Enforce one Tower runtime owner per data directory. */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TowerRuntimeLease" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "ownerId" TEXT NOT NULL,
      "pid" INTEGER NOT NULL,
      "port" INTEGER,
      "generation" INTEGER NOT NULL DEFAULT 1,
      "expiresAt" DATETIME NOT NULL,
      "lastHeartbeatAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "TowerRuntimeLease_expiresAt_idx" ON "TowerRuntimeLease"("expiresAt")`,
  );
}
