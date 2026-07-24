// @vitest-environment node
import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../../../scripts/migrations/0009-api-connections";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("0009 API connection migration", () => {
  it("creates the connection tables on an empty database and remains repeat-safe", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tower-api-migration-empty-"));
    tempDirs.push(dir);
    const prisma = new PrismaClient({ datasourceUrl: `file:${join(dir, "empty.db")}` });
    try {
      await up(prisma);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "ProviderConnection" (
          "id", "connectionKey", "name", "kind", "provider", "enabled", "testStatus",
          "testOk", "presetId", "baseUrl", "defaultModelId", "headersJson",
          "queryParamsJson", "roundRobinCursor", "diagnosticsJson", "updatedAt"
        ) VALUES (
          'api-null-key', NULL, 'Local API', 'api', 'openai-compatible', false, 'partial',
          true, 'custom', 'http://localhost:11434/custom/v2', 'local-model', '[{"id":"h1"}]',
          '[{"id":"q1"}]', 7, '{"source":"test"}', CURRENT_TIMESTAMP
        )
      `);
      await up(prisma);
      const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT "name" FROM sqlite_master WHERE type = 'table' ORDER BY "name"`,
      );
      expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining([
        "ProviderConnection",
        "ApiConnectionKey",
        "ApiConnectionModel",
      ]));
      const apiRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "ProviderConnection" WHERE "id" = 'api-null-key'`,
      );
      expect(apiRows[0]).toMatchObject({
        connectionKey: null,
        name: "Local API",
        kind: "api",
        provider: "openai-compatible",
        enabled: false,
        testStatus: "partial",
        testOk: true,
        presetId: "custom",
        baseUrl: "http://localhost:11434/custom/v2",
        defaultModelId: "local-model",
        headersJson: '[{"id":"h1"}]',
        queryParamsJson: '[{"id":"q1"}]',
        roundRobinCursor: 7,
        diagnosticsJson: '{"source":"test"}',
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("backfills legacy CLI rows, removes provider uniqueness, and is repeat-safe", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tower-api-migration-"));
    tempDirs.push(dir);
    const prisma = new PrismaClient({ datasourceUrl: `file:${join(dir, "legacy.db")}` });
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "ProviderConnection" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "provider" TEXT NOT NULL UNIQUE,
          "lastTestedAt" DATETIME,
          "testOk" BOOLEAN NOT NULL DEFAULT false,
          "version" TEXT,
          "mcpInstalled" BOOLEAN NOT NULL DEFAULT false,
          "hooksInstalled" BOOLEAN NOT NULL DEFAULT false,
          "skillsInstalled" BOOLEAN NOT NULL DEFAULT false,
          "installLog" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL
        )
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "ProviderConnection" (
          "id", "provider", "lastTestedAt", "testOk", "version", "updatedAt"
        ) VALUES ('legacy-claude', 'claude', CURRENT_TIMESTAMP, true, '1.2.3', CURRENT_TIMESTAMP)
      `);

      await up(prisma);
      await up(prisma);

      const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "ProviderConnection" WHERE "id" = 'legacy-claude'`,
      );
      expect(rows[0]).toMatchObject({
        id: "legacy-claude",
        connectionKey: "cli:claude",
        kind: "cli",
        provider: "claude",
        enabled: true,
        testStatus: "connected",
        version: "1.2.3",
      });

      await prisma.$executeRawUnsafe(`
        INSERT INTO "ProviderConnection" (
          "id", "name", "kind", "provider", "updatedAt"
        ) VALUES ('api-one', 'One', 'api', 'openai-compatible', CURRENT_TIMESTAMP),
                 ('api-two', 'Two', 'api', 'openai-compatible', CURRENT_TIMESTAMP)
      `);
      const count = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS count FROM "ProviderConnection" WHERE "provider" = 'openai-compatible'`,
      );
      expect(Number(count[0]?.count)).toBe(2);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("rolls back the legacy table rebuild when copying legacy data fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tower-api-migration-rollback-"));
    tempDirs.push(dir);
    const prisma = new PrismaClient({ datasourceUrl: `file:${join(dir, "rollback.db")}` });
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "ProviderConnection" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "provider" TEXT UNIQUE,
          "lastTestedAt" DATETIME,
          "testOk" BOOLEAN NOT NULL DEFAULT false,
          "version" TEXT,
          "mcpInstalled" BOOLEAN NOT NULL DEFAULT false,
          "hooksInstalled" BOOLEAN NOT NULL DEFAULT false,
          "skillsInstalled" BOOLEAN NOT NULL DEFAULT false,
          "installLog" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL
        )
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "ProviderConnection" ("id", "provider", "updatedAt")
        VALUES ('invalid-legacy', NULL, CURRENT_TIMESTAMP)
      `);

      await expect(up(prisma)).rejects.toThrow();

      const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT "name" FROM sqlite_master WHERE type = 'table' AND "name" LIKE 'ProviderConnection%'`,
      );
      expect(tables.map((table) => table.name)).toEqual(["ProviderConnection"]);
      const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("ProviderConnection")`,
      );
      expect(columns.map((column) => column.name)).not.toContain("connectionKey");
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string; provider: string | null }>>(
        `SELECT "id", "provider" FROM "ProviderConnection"`,
      );
      expect(rows).toEqual([{ id: "invalid-legacy", provider: null }]);
    } finally {
      await prisma.$disconnect();
    }
  });
});
