/** Add the per-Job callback credential hash used by the OpenClaw completion hook. */

import type { PrismaClient } from "@prisma/client";

type MigrationClient = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe">;

export async function up(prisma: MigrationClient): Promise<void> {
  const columns = new Set((await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("CapabilityRequest")`,
  )).map((column) => column.name));
  if (!columns.has("callbackTokenHash")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "CapabilityRequest" ADD COLUMN "callbackTokenHash" TEXT`,
    );
  }
}
