/** Add fenced, renewable leases to durable Workbench batches. */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("WorkbenchBatch")`,
  );
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("generation")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "WorkbenchBatch" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1`,
    );
  }
  if (!names.has("leaseToken")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkbenchBatch" ADD COLUMN "leaseToken" TEXT`);
  }
  if (!names.has("leaseExpiresAt")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkbenchBatch" ADD COLUMN "leaseExpiresAt" DATETIME`);
  }
  if (!names.has("lastHeartbeatAt")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "WorkbenchBatch" ADD COLUMN "lastHeartbeatAt" DATETIME`);
  }
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "WorkbenchBatch_state_leaseExpiresAt_idx" ` +
      `ON "WorkbenchBatch"("state", "leaseExpiresAt")`,
  );
}
