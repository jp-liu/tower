import type { PrismaClient } from "@prisma/client";

interface ForeignKeyRow {
  table: string;
  from: string;
  to: string;
  on_delete: string;
}

async function hasRequiredForeignKeys(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<ForeignKeyRow[]>(
    `PRAGMA foreign_key_list("GatewayTaskLink")`,
  );
  return rows.some((row) =>
    row.table === "GatewayInbound"
      && row.from === "inboundId"
      && row.to === "id"
      && row.on_delete.toUpperCase() === "CASCADE"
  ) && rows.some((row) =>
    row.table === "Task"
      && row.from === "taskId"
      && row.to === "id"
      && row.on_delete.toUpperCase() === "CASCADE"
  );
}

export async function up(prisma: PrismaClient): Promise<void> {
  if (await hasRequiredForeignKeys(prisma)) return;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "GatewayTaskLink_v028"`);
    await tx.$executeRawUnsafe(`
      CREATE TABLE "GatewayTaskLink_v028" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "inboundId" TEXT NOT NULL,
        "taskId" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "GatewayTaskLink_inboundId_fkey"
          FOREIGN KEY ("inboundId") REFERENCES "GatewayInbound" ("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "GatewayTaskLink_taskId_fkey"
          FOREIGN KEY ("taskId") REFERENCES "Task" ("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    // Copy only valid links. Older builds allowed either endpoint to disappear,
    // and preserving such rows would reintroduce the unrecoverable orphan.
    await tx.$executeRawUnsafe(`
      INSERT INTO "GatewayTaskLink_v028" ("id", "inboundId", "taskId", "createdAt")
      SELECT link."id", link."inboundId", link."taskId", link."createdAt"
      FROM "GatewayTaskLink" AS link
      INNER JOIN "GatewayInbound" AS inbound ON inbound."id" = link."inboundId"
      INNER JOIN "Task" AS task ON task."id" = link."taskId"
    `);
    await tx.$executeRawUnsafe(`DROP TABLE "GatewayTaskLink"`);
    await tx.$executeRawUnsafe(`ALTER TABLE "GatewayTaskLink_v028" RENAME TO "GatewayTaskLink"`);
    await tx.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "GatewayTaskLink_inboundId_key" ON "GatewayTaskLink"("inboundId")`,
    );
    await tx.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "GatewayTaskLink_taskId_key" ON "GatewayTaskLink"("taskId")`,
    );
  });
}
