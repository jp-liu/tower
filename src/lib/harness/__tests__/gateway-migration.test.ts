// @vitest-environment node
import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../../../../scripts/migrations/0017-gateway-sessions";
import { up as addGatewayPresentation } from "../../../../scripts/migrations/0018-gateway-delivery-presentation";
import {
  HISTORICAL_SENT_UNVERIFIED_DELIVERIES,
  up as quarantineHistoricalGatewayDeliveries,
} from "../../../../scripts/migrations/0020-gateway-sent-unverified";

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

describe("0018 gateway delivery presentation migration", () => {
  it("adds the persisted presentation payload idempotently", async () => {
    const prisma = await database();
    await up(prisma);

    await addGatewayPresentation(prisma);
    await addGatewayPresentation(prisma);

    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("GatewayDelivery")`);
    expect(columns.map((column) => column.name)).toContain("presentation");
  });
});

describe("0020 gateway sent-unverified migration", () => {
  it("quarantines only the five exact platform sends and remains idempotent", async () => {
    const prisma = await database();
    await prisma.$executeRawUnsafe(`CREATE TABLE "Project" ("id" TEXT NOT NULL PRIMARY KEY)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "Project" ("id") VALUES ('project')`);
    await up(prisma);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "GatewaySession" (` +
      `"id", "bindingKey", "gateway", "platform", "chatId", "kind", "projectId"` +
      `) VALUES ('session', 'binding', 'openclaw', 'feishu', 'oc_group', 'PROJECT_WORK', 'project')`,
    );
    for (const [id, platformMessageId] of HISTORICAL_SENT_UNVERIFIED_DELIVERIES) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "GatewayDelivery" (` +
        `"id", "dedupKey", "sessionId", "kind", "content", "state", "attempts", "platformMessageId", "lastError"` +
        `) VALUES (?, ?, 'session', 'DISCUSSION_REPLY', 'sent content', 'FAILED', 1, ?, 'contract mismatch')`,
        id,
        `dedup:${id}`,
        platformMessageId,
      );
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "GatewayDelivery" (` +
      `"id", "dedupKey", "sessionId", "kind", "content", "state", "attempts", "platformMessageId", "nextAttemptAt"` +
      `) VALUES ('retryable', 'dedup:retryable', 'session', 'FINAL_RESULT', 'not sent', 'FAILED', 1, NULL, CURRENT_TIMESTAMP)`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "GatewayDelivery" (` +
      `"id", "dedupKey", "sessionId", "kind", "content", "state", "attempts", "platformMessageId", "nextAttemptAt"` +
      `) VALUES ('other-sent', 'dedup:other-sent', 'session', 'FINAL_RESULT', 'other sent', 'FAILED', 1, ?, CURRENT_TIMESTAMP)`,
      HISTORICAL_SENT_UNVERIFIED_DELIVERIES[0][1],
    );

    await quarantineHistoricalGatewayDeliveries(prisma);
    await quarantineHistoricalGatewayDeliveries(prisma);

    const quarantined = await prisma.$queryRawUnsafe<Array<{
      id: string;
      state: string;
      platformMessageId: string | null;
      nextAttemptAt: string | null;
      lastError: string | null;
    }>>(
      `SELECT "id", "state", "platformMessageId", "nextAttemptAt", "lastError" ` +
      `FROM "GatewayDelivery" WHERE "state" = 'SENT_UNVERIFIED' ORDER BY "id"`,
    );
    expect(quarantined.map((row) => [row.id, row.platformMessageId])).toEqual(
      [...HISTORICAL_SENT_UNVERIFIED_DELIVERIES].sort(([left], [right]) => left.localeCompare(right)),
    );
    expect(quarantined.every((row) => row.nextAttemptAt === null)).toBe(true);
    expect(quarantined.every((row) => row.lastError?.includes("manual review required"))).toBe(true);

    const untouched = await prisma.$queryRawUnsafe<Array<{ id: string; state: string; nextAttemptAt: string | null }>>(
      `SELECT "id", "state", "nextAttemptAt" FROM "GatewayDelivery" ` +
      `WHERE "id" IN ('retryable', 'other-sent') ORDER BY "id"`,
    );
    expect(untouched).toEqual([
      { id: "other-sent", state: "FAILED", nextAttemptAt: expect.anything() },
      { id: "retryable", state: "FAILED", nextAttemptAt: expect.anything() },
    ]);

    const [exactId] = HISTORICAL_SENT_UNVERIFIED_DELIVERIES[0];
    await prisma.$executeRawUnsafe(
      `UPDATE "GatewayDelivery" SET "state" = 'FAILED', "platformMessageId" = 'om_wrong', "nextAttemptAt" = CURRENT_TIMESTAMP WHERE "id" = ?`,
      exactId,
    );
    await quarantineHistoricalGatewayDeliveries(prisma);
    const mismatched = await prisma.$queryRawUnsafe<Array<{ state: string; platformMessageId: string }>>(
      `SELECT "state", "platformMessageId" FROM "GatewayDelivery" WHERE "id" = ?`,
      exactId,
    );
    expect(mismatched).toEqual([{ state: "FAILED", platformMessageId: "om_wrong" }]);
  });
});
