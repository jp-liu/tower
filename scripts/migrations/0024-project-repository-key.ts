/** Add the normalized remote-repository identity used for concurrent deduplication. */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("Project")`,
  );
  if (!columns.some((column) => column.name === "repositoryKey")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Project" ADD COLUMN "repositoryKey" TEXT`);
  }
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Project_repositoryKey_key" ON "Project"("repositoryKey")`,
  );
}
