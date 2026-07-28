import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "GatewayTaskLink" (` +
      `"id" TEXT NOT NULL PRIMARY KEY, "inboundId" TEXT NOT NULL, ` +
      `"taskId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  );
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "GatewayTaskLink_inboundId_key" ON "GatewayTaskLink"("inboundId")`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "GatewayTaskLink_taskId_key" ON "GatewayTaskLink"("taskId")`);
}
