import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../../../scripts/migrations/0013-assistant-sessions";

const tempDirs: string[] = [];

async function database(): Promise<PrismaClient> {
  const dir = await mkdtemp(join(tmpdir(), "tower-assistant-migration-"));
  tempDirs.push(dir);
  return new PrismaClient({ datasourceUrl: `file:${join(dir, "migration.db")}` });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("0013 Assistant session migration", () => {
  it("creates the provider-neutral tables on an empty database and is repeatable", async () => {
    const prisma = await database();
    try {
      await up(prisma);
      await up(prisma);
      const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" LIKE 'Assistant%' ORDER BY "name"`,
      );
      expect(tables.map((table) => table.name)).toEqual(["AssistantMessage", "AssistantSession", "AssistantTurn"]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("preserves unrelated legacy data while adding the next migration", async () => {
    const prisma = await database();
    try {
      await prisma.$executeRawUnsafe(`CREATE TABLE "LegacyConfig" ("id" TEXT PRIMARY KEY, "value" TEXT NOT NULL)`);
      await prisma.$executeRawUnsafe(`INSERT INTO "LegacyConfig" ("id", "value") VALUES ('assistant.model', 'sonnet')`);
      await up(prisma);
      const rows = await prisma.$queryRawUnsafe<Array<{ value: string }>>(`SELECT "value" FROM "LegacyConfig"`);
      expect(rows).toEqual([{ value: "sonnet" }]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("rolls back every new table when an existing partial table is incompatible", async () => {
    const prisma = await database();
    try {
      await prisma.$executeRawUnsafe(`CREATE VIEW "AssistantMessage" AS SELECT 'legacy' AS "id"`);

      await expect(up(prisma)).rejects.toThrow();

      const tables = await prisma.$queryRawUnsafe<Array<{ name: string; type: string }>>(
        `SELECT "name", "type" FROM "sqlite_master" WHERE "name" LIKE 'Assistant%' ORDER BY "name"`,
      );
      expect(tables).toEqual([{ name: "AssistantMessage", type: "view" }]);
    } finally {
      await prisma.$disconnect();
    }
  });
});
