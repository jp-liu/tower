/** Persist the repository safety mode used by remote project provisioning. */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("Project")`,
  );
  if (!columns.some((column) => column.name === "accessMode")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Project" ADD COLUMN "accessMode" TEXT NOT NULL DEFAULT 'NORMAL'`,
    );
  }
}
