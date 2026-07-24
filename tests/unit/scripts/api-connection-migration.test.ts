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
      await up(prisma);
      const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT "name" FROM sqlite_master WHERE type = 'table' ORDER BY "name"`,
      );
      expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining([
        "ProviderConnection",
        "ApiConnectionKey",
        "ApiConnectionModel",
      ]));
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
});
