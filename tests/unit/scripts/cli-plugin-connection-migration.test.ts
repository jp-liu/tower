import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../../../scripts/migrations/0011-cli-plugin-connections";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("0011 CLI plugin connection migration", () => {
  it("adds managed CLI fields idempotently and preserves built-in rows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tower-cli-plugin-migration-"));
    tempDirs.push(dir);
    const prisma = new PrismaClient({ datasourceUrl: `file:${join(dir, "migration.db")}` });
    try {
      await prisma.$executeRawUnsafe(`
      CREATE TABLE "ProviderConnection" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "connectionKey" TEXT,
        "name" TEXT NOT NULL DEFAULT '',
        "kind" TEXT NOT NULL DEFAULT 'cli',
        "provider" TEXT NOT NULL,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "updatedAt" DATETIME NOT NULL
      )
    `);
      await prisma.$executeRawUnsafe(`
      INSERT INTO "ProviderConnection" ("id", "connectionKey", "name", "provider", "updatedAt")
      VALUES ('builtin', 'cli:claude', 'Claude', 'claude', CURRENT_TIMESTAMP)
    `);

      await up(prisma);
      await up(prisma);

      const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("ProviderConnection")`,
      );
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "commandOverride",
        "baseArgsJson",
        "envVarsJson",
        "settingsJson",
        "resolvedCommand",
        "resolvedVersion",
      ]));
      const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM "ProviderConnection" WHERE "id" = 'builtin'`,
      );
      expect(rows[0]).toMatchObject({
        connectionKey: "cli:claude",
        baseArgsJson: "[]",
        envVarsJson: "[]",
        settingsJson: "{}",
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
