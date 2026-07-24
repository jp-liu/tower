/**
 * Evolves the provider-status cache into concrete CLI/API connection instances.
 * The migration is deliberately idempotent and preserves every legacy row.
 */

import type { PrismaClient } from "@prisma/client";

type Column = { name: string };
type IndexRow = { name: string; unique: number; origin: string };
type MigrationClient = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe">;

async function columns(prisma: MigrationClient, table: string): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Column[]>(`PRAGMA table_info("${table}")`);
  return new Set(rows.map((row) => row.name));
}

async function hasLegacyProviderUniqueIndex(prisma: MigrationClient): Promise<boolean> {
  const indexes = await prisma.$queryRawUnsafe<IndexRow[]>(`PRAGMA index_list("ProviderConnection")`);
  for (const index of indexes) {
    if (!index.unique) continue;
    const fields = await prisma.$queryRawUnsafe<Column[]>(`PRAGMA index_info("${index.name}")`);
    if (fields.length === 1 && fields[0]?.name === "provider") return true;
  }
  return false;
}

async function createProviderConnectionTable(prisma: MigrationClient, table: string): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${table}" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "connectionKey" TEXT,
      "name" TEXT NOT NULL DEFAULT '',
      "kind" TEXT NOT NULL DEFAULT 'cli',
      "provider" TEXT NOT NULL,
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "testStatus" TEXT NOT NULL DEFAULT 'untested',
      "lastTestedAt" DATETIME,
      "testOk" BOOLEAN NOT NULL DEFAULT false,
      "version" TEXT,
      "mcpInstalled" BOOLEAN NOT NULL DEFAULT false,
      "hooksInstalled" BOOLEAN NOT NULL DEFAULT false,
      "skillsInstalled" BOOLEAN NOT NULL DEFAULT false,
      "installLog" TEXT,
      "presetId" TEXT,
      "baseUrl" TEXT,
      "defaultModelId" TEXT,
      "headersJson" TEXT NOT NULL DEFAULT '[]',
      "queryParamsJson" TEXT NOT NULL DEFAULT '[]',
      "roundRobinCursor" INTEGER NOT NULL DEFAULT 0,
      "diagnosticsJson" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
}

async function rebuildLegacyTable(prisma: MigrationClient): Promise<void> {
  await createProviderConnectionTable(prisma, "ProviderConnection_v03");
  await prisma.$executeRawUnsafe(`
    INSERT INTO "ProviderConnection_v03" (
      "id", "connectionKey", "name", "kind", "provider", "enabled", "testStatus",
      "lastTestedAt", "testOk", "version", "mcpInstalled", "hooksInstalled",
      "skillsInstalled", "installLog", "createdAt", "updatedAt"
    )
    SELECT
      "id", 'cli:' || "provider", "provider", 'cli', "provider", true,
      CASE WHEN "testOk" THEN 'connected'
           WHEN "lastTestedAt" IS NOT NULL THEN 'unavailable'
           ELSE 'untested' END,
      "lastTestedAt", "testOk", "version", "mcpInstalled", "hooksInstalled",
      "skillsInstalled", "installLog", "createdAt", "updatedAt"
    FROM "ProviderConnection"
  `);
  await prisma.$executeRawUnsafe(`DROP TABLE "ProviderConnection"`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "ProviderConnection_v03" RENAME TO "ProviderConnection"`);
}

async function addColumn(
  prisma: MigrationClient,
  existing: Set<string>,
  name: string,
  definition: string,
): Promise<void> {
  if (existing.has(name)) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE "ProviderConnection" ADD COLUMN "${name}" ${definition}`);
  existing.add(name);
}

export async function up(prisma: PrismaClient): Promise<void> {
  let existing = await columns(prisma, "ProviderConnection");
  if (existing.size === 0) {
    await createProviderConnectionTable(prisma, "ProviderConnection");
    existing = await columns(prisma, "ProviderConnection");
  }

  if (await hasLegacyProviderUniqueIndex(prisma)) {
    await prisma.$transaction(async (transaction) => {
      await rebuildLegacyTable(transaction);
    });
  } else {
    const current = await columns(prisma, "ProviderConnection");
    await addColumn(prisma, current, "connectionKey", "TEXT");
    await addColumn(prisma, current, "name", "TEXT NOT NULL DEFAULT ''");
    await addColumn(prisma, current, "kind", "TEXT NOT NULL DEFAULT 'cli'");
    await addColumn(prisma, current, "enabled", "BOOLEAN NOT NULL DEFAULT true");
    await addColumn(prisma, current, "testStatus", "TEXT NOT NULL DEFAULT 'untested'");
    await addColumn(prisma, current, "presetId", "TEXT");
    await addColumn(prisma, current, "baseUrl", "TEXT");
    await addColumn(prisma, current, "defaultModelId", "TEXT");
    await addColumn(prisma, current, "headersJson", "TEXT NOT NULL DEFAULT '[]'");
    await addColumn(prisma, current, "queryParamsJson", "TEXT NOT NULL DEFAULT '[]'");
    await addColumn(prisma, current, "roundRobinCursor", "INTEGER NOT NULL DEFAULT 0");
    await addColumn(prisma, current, "diagnosticsJson", "TEXT");
    await prisma.$executeRawUnsafe(`
      UPDATE "ProviderConnection"
      SET "connectionKey" = COALESCE("connectionKey", 'cli:' || "provider"),
          "name" = CASE WHEN "name" = '' THEN "provider" ELSE "name" END,
          "kind" = 'cli',
          "testStatus" = CASE WHEN "testOk" THEN 'connected'
                              WHEN "lastTestedAt" IS NOT NULL THEN 'unavailable'
                              ELSE 'untested' END
      WHERE "kind" = 'cli'
    `);
  }

  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ProviderConnection_connectionKey_key" ON "ProviderConnection"("connectionKey")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ProviderConnection_kind_provider_idx" ON "ProviderConnection"("kind", "provider")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ProviderConnection_kind_enabled_testStatus_idx" ON "ProviderConnection"("kind", "enabled", "testStatus")`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ApiConnectionKey" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "connectionId" TEXT NOT NULL,
      "label" TEXT,
      "value" TEXT NOT NULL,
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "order" INTEGER NOT NULL DEFAULT 0,
      "testStatus" TEXT NOT NULL DEFAULT 'untested',
      "lastTestedAt" DATETIME,
      "lastError" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "ApiConnectionKey_connectionId_fkey" FOREIGN KEY ("connectionId")
        REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ApiConnectionKey_connectionId_order_idx" ON "ApiConnectionKey"("connectionId", "order")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ApiConnectionKey_connectionId_enabled_testStatus_idx" ON "ApiConnectionKey"("connectionId", "enabled", "testStatus")`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ApiConnectionModel" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "connectionId" TEXT NOT NULL,
      "modelId" TEXT NOT NULL,
      "source" TEXT NOT NULL,
      "available" BOOLEAN NOT NULL DEFAULT true,
      "lastDiscoveredAt" DATETIME,
      "capabilitiesJson" TEXT,
      "metadataJson" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "ApiConnectionModel_connectionId_fkey" FOREIGN KEY ("connectionId")
        REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ApiConnectionModel_connectionId_modelId_key" ON "ApiConnectionModel"("connectionId", "modelId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ApiConnectionModel_connectionId_source_available_idx" ON "ApiConnectionModel"("connectionId", "source", "available")`,
  );
}
