// @vitest-environment node
import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../../../../scripts/migrations/0017-gateway-sessions";

const clients: PrismaClient[] = [];
const directories: string[] = [];

async function database(): Promise<PrismaClient> {
  const directory = await mkdtemp(join(tmpdir(), "tower-gateway-migration-"));
  directories.push(directory);
  const client = new PrismaClient({ datasourceUrl: `file:${join(directory, "gateway.db")}` });
  clients.push(client);
  return client;
}

async function schemaObjects(prisma: PrismaClient, type: "table" | "index") {
  return prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT "name" FROM "sqlite_master" WHERE "type" = ? ORDER BY "name"`,
    type,
  );
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("0017 gateway sessions migration", () => {
  it("creates gateway tables and unique indexes idempotently", async () => {
    const prisma = await database();

    await up(prisma);
    await up(prisma);

    const tables = (await schemaObjects(prisma, "table")).map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining([
      "HarnessDelivery",
      "GatewaySession",
      "GatewayInbound",
      "GatewayDelivery",
    ]));
    const indexes = (await schemaObjects(prisma, "index")).map((row) => row.name);
    expect(indexes).toEqual(expect.arrayContaining([
      "HarnessDelivery_platformMessageId_key",
      "GatewaySession_bindingKey_key",
      "GatewayInbound_dedupKey_key",
      "GatewayDelivery_dedupKey_key",
    ]));
    expect(indexes.filter((name) => name === "GatewayInbound_dedupKey_key")).toHaveLength(1);
  });

  it("preserves an existing HarnessDelivery table, indexes, and rows", async () => {
    const prisma = await database();
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "HarnessDelivery" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "harnessMessageId" TEXT NOT NULL,
        "taskId" TEXT NOT NULL,
        "platform" TEXT NOT NULL,
        "chatId" TEXT NOT NULL,
        "platformMessageId" TEXT NOT NULL,
        "scope" TEXT NOT NULL,
        "expectReply" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "HarnessDelivery_platformMessageId_key" ON "HarnessDelivery"("platformMessageId")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX "HarnessDelivery_taskId_idx" ON "HarnessDelivery"("taskId")`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "HarnessDelivery" (` +
        `"id", "harnessMessageId", "taskId", "platform", "chatId", "platformMessageId", "scope", "expectReply"` +
        `) VALUES ('legacy-delivery', 'legacy-message', 'legacy-task', 'feishu', 'oc_legacy', 'om_legacy', 'work', 1)`,
    );

    await up(prisma);
    await up(prisma);

    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      platformMessageId: string;
      expectReply: number;
    }>>(`SELECT "id", "platformMessageId", "expectReply" FROM "HarnessDelivery"`);
    expect(rows).toEqual([{ id: "legacy-delivery", platformMessageId: "om_legacy", expectReply: 1 }]);
    const indexes = (await schemaObjects(prisma, "index")).map((row) => row.name);
    expect(indexes.filter((name) => name === "HarnessDelivery_platformMessageId_key")).toHaveLength(1);
    expect(indexes.filter((name) => name === "HarnessDelivery_taskId_idx")).toHaveLength(1);
  });
});
