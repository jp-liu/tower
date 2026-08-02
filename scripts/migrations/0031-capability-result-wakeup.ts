/** Add the durable publication marker for external capability results. */

import type { PrismaClient } from "@prisma/client";

type MigrationClient = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe">;

export async function up(prisma: MigrationClient): Promise<void> {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("CapabilityRequest")`,
  );
  if (!columns.some((column) => column.name === "resultEventPublishedAt")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "CapabilityRequest" ADD COLUMN "resultEventPublishedAt" DATETIME`,
    );
  }
}
