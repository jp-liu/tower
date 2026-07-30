import type { PrismaClient } from "@prisma/client";

async function hasColumn(prisma: PrismaClient, table: string, column: string): Promise<boolean> {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`);
  return columns.some((item) => item.name === column);
}

export async function up(prisma: PrismaClient): Promise<void> {
  if (!await hasColumn(prisma, "GatewayDelivery", "presentation")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "GatewayDelivery" ADD COLUMN "presentation" TEXT`);
  }
}
