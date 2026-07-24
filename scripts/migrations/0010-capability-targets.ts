/**
 * Adds explicit capability targets and freezes the 0.2 defaults once.
 * All schema and data changes run in one transaction so a failed migration
 * cannot leave a partially populated fallback plan.
 */

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

const SLOTS = ["terminal", "summary", "dreaming", "analysis", "assistant"] as const;

type MigrationClient = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe">;
type Column = { name: string };
type ConfigRow = {
  id: string;
  slot: string;
  provider: string;
  mode: string;
  model: string | null;
  migrationStatus: string;
};
type ConnectionRow = {
  id: string;
  connectionKey: string | null;
  provider: string;
  enabled: boolean | number;
  testOk: boolean | number;
};
type CountRow = { count: number | bigint };

async function columns(prisma: MigrationClient, table: string): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Column[]>(`PRAGMA table_info("${table}")`);
  return new Set(rows.map((row) => row.name));
}

async function ensureBaseTables(prisma: MigrationClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AiCapabilityConfig" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "slot" TEXT NOT NULL,
      "provider" TEXT NOT NULL DEFAULT 'claude',
      "mode" TEXT NOT NULL DEFAULT 'cli',
      "model" TEXT,
      "migrationStatus" TEXT NOT NULL DEFAULT 'pending',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "AiCapabilityConfig_slot_key" ON "AiCapabilityConfig"("slot")`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProviderConnection" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "connectionKey" TEXT,
      "name" TEXT NOT NULL DEFAULT '',
      "kind" TEXT NOT NULL DEFAULT 'cli',
      "provider" TEXT NOT NULL,
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "testStatus" TEXT NOT NULL DEFAULT 'untested',
      "testOk" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ProviderConnection_connectionKey_key" ON "ProviderConnection"("connectionKey")`,
  );
}

async function ensureMigrationStatus(prisma: MigrationClient): Promise<void> {
  const existing = await columns(prisma, "AiCapabilityConfig");
  if (!existing.has("migrationStatus")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "AiCapabilityConfig" ADD COLUMN "migrationStatus" TEXT NOT NULL DEFAULT 'pending'`,
    );
  }
}

async function ensureTargetTables(prisma: MigrationClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AiCapabilityTarget" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "capabilityConfigId" TEXT NOT NULL,
      "connectionId" TEXT NOT NULL,
      "modelId" TEXT,
      "targetKey" TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "AiCapabilityTarget_capabilityConfigId_fkey" FOREIGN KEY ("capabilityConfigId")
        REFERENCES "AiCapabilityConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "AiCapabilityTarget_connectionId_fkey" FOREIGN KEY ("connectionId")
        REFERENCES "ProviderConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "AiCapabilityTarget_capabilityConfigId_targetKey_key" ` +
      `ON "AiCapabilityTarget"("capabilityConfigId", "targetKey")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "AiCapabilityTarget_capabilityConfigId_order_key" ` +
      `ON "AiCapabilityTarget"("capabilityConfigId", "order")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AiCapabilityTarget_connectionId_idx" ON "AiCapabilityTarget"("connectionId")`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AiCapabilityAttempt" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "requestId" TEXT NOT NULL,
      "correlationId" TEXT,
      "slot" TEXT NOT NULL,
      "targetId" TEXT NOT NULL,
      "connectionId" TEXT NOT NULL,
      "connectionRefId" TEXT,
      "modelId" TEXT,
      "startedAt" DATETIME NOT NULL,
      "durationMs" INTEGER NOT NULL,
      "result" TEXT NOT NULL,
      "errorCode" TEXT,
      "repaired" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AiCapabilityAttempt_connectionRefId_fkey" FOREIGN KEY ("connectionRefId")
        REFERENCES "ProviderConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AiCapabilityAttempt_requestId_startedAt_idx" ` +
      `ON "AiCapabilityAttempt"("requestId", "startedAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AiCapabilityAttempt_correlationId_idx" ON "AiCapabilityAttempt"("correlationId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AiCapabilityAttempt_slot_startedAt_idx" ON "AiCapabilityAttempt"("slot", "startedAt")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AiCapabilityAttempt_targetId_idx" ON "AiCapabilityAttempt"("targetId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AiCapabilityAttempt_connectionRefId_idx" ON "AiCapabilityAttempt"("connectionRefId")`,
  );
}

function targetKey(connectionId: string, modelId: string | null): string {
  return JSON.stringify([connectionId, modelId]);
}

async function findOrCreateCliConnection(
  prisma: MigrationClient,
  provider: string,
): Promise<ConnectionRow> {
  const key = `cli:${provider}`;
  const rows = await prisma.$queryRawUnsafe<ConnectionRow[]>(
    `SELECT "id", "connectionKey", "provider", "enabled", "testOk" FROM "ProviderConnection" ` +
      `WHERE "connectionKey" = ? LIMIT 1`,
    key,
  );
  if (rows[0]) return rows[0];
  const id = randomUUID();
  const now = new Date().toISOString();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProviderConnection" (` +
      `"id", "connectionKey", "name", "kind", "provider", "enabled", "testStatus", "testOk", "createdAt", "updatedAt"` +
      `) VALUES (?, ?, ?, 'cli', ?, true, 'untested', false, ?, ?)`,
    id,
    key,
    provider,
    provider,
    now,
    now,
  );
  return { id, connectionKey: key, provider, enabled: true, testOk: false };
}

async function defaultCliConnection(prisma: MigrationClient): Promise<ConnectionRow> {
  const connected = await prisma.$queryRawUnsafe<ConnectionRow[]>(
    `SELECT "id", "connectionKey", "provider", "enabled", "testOk" FROM "ProviderConnection" ` +
      `WHERE "kind" = 'cli' AND "enabled" = true AND "testOk" = true ` +
      `ORDER BY CASE WHEN "provider" = 'claude' THEN 0 ELSE 1 END, "provider" ASC, "createdAt" ASC`,
  );
  return connected[0] ?? findOrCreateCliConnection(prisma, "claude");
}

async function insertTarget(
  prisma: MigrationClient,
  configId: string,
  connectionId: string,
  modelId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AiCapabilityTarget" (` +
      `"id", "capabilityConfigId", "connectionId", "modelId", "targetKey", "order", "createdAt", "updatedAt"` +
      `) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    randomUUID(),
    configId,
    connectionId,
    modelId,
    targetKey(connectionId, modelId),
    now,
    now,
  );
}

async function migrateSlot(prisma: MigrationClient, slot: (typeof SLOTS)[number]): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<ConfigRow[]>(
    `SELECT "id", "slot", "provider", "mode", "model", "migrationStatus" ` +
      `FROM "AiCapabilityConfig" WHERE "slot" = ? LIMIT 1`,
    slot,
  );
  let config = rows[0];
  if (config) {
    const counts = await prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS "count" FROM "AiCapabilityTarget" WHERE "capabilityConfigId" = ?`,
      config.id,
    );
    if (Number(counts[0]?.count ?? 0) > 0) {
      if (config.migrationStatus === "pending") {
        await prisma.$executeRawUnsafe(
          `UPDATE "AiCapabilityConfig" SET "migrationStatus" = 'complete', "updatedAt" = ? WHERE "id" = ?`,
          new Date().toISOString(),
          config.id,
        );
      }
      return;
    }
    if (config.migrationStatus !== "pending") return;
    if (config.mode === "api") {
      await prisma.$executeRawUnsafe(
        `UPDATE "AiCapabilityConfig" SET "migrationStatus" = 'legacy_api_unmapped', "updatedAt" = ? WHERE "id" = ?`,
        new Date().toISOString(),
        config.id,
      );
      return;
    }
    const connection = await findOrCreateCliConnection(prisma, config.provider);
    await insertTarget(prisma, config.id, connection.id, config.model);
    await prisma.$executeRawUnsafe(
      `UPDATE "AiCapabilityConfig" SET "migrationStatus" = 'complete', "updatedAt" = ? WHERE "id" = ?`,
      new Date().toISOString(),
      config.id,
    );
    return;
  }

  const connection = await defaultCliConnection(prisma);
  const id = randomUUID();
  const now = new Date().toISOString();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AiCapabilityConfig" (` +
      `"id", "slot", "provider", "mode", "model", "migrationStatus", "createdAt", "updatedAt"` +
      `) VALUES (?, ?, ?, 'cli', NULL, 'defaulted', ?, ?)`,
    id,
    slot,
    connection.provider,
    now,
    now,
  );
  config = { id, slot, provider: connection.provider, mode: "cli", model: null, migrationStatus: "defaulted" };
  await insertTarget(prisma, config.id, connection.id, null);
}

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await ensureBaseTables(transaction);
    await ensureMigrationStatus(transaction);
    await ensureTargetTables(transaction);
    for (const slot of SLOTS) await migrateSlot(transaction, slot);
  });
}
