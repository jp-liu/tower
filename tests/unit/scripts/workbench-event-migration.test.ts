import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../../../scripts/migrations/0014-workbench-events";

const tempDirs: string[] = [];

async function database(): Promise<PrismaClient> {
  const dir = await mkdtemp(join(tmpdir(), "tower-workbench-migration-"));
  tempDirs.push(dir);
  const prisma = new PrismaClient({ datasourceUrl: `file:${join(dir, "migration.db")}` });
  await prisma.$executeRawUnsafe(`CREATE TABLE "Task" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "TaskExecution" ("id" TEXT NOT NULL PRIMARY KEY)`);
  return prisma;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("0014 Workbench event migration", () => {
  it("creates the durable inbox and indexes idempotently", async () => {
    const prisma = await database();
    try {
      await up(prisma);
      await up(prisma);
      const table = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = 'WorkbenchEvent'`,
      );
      const indexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT "name" FROM "sqlite_master" WHERE "type" = 'index' AND "tbl_name" = 'WorkbenchEvent' ORDER BY "name"`,
      );
      expect(table).toEqual([{ name: "WorkbenchEvent" }]);
      expect(indexes.map((row) => row.name)).toContain("WorkbenchEvent_dedupKey_key");
      expect(indexes.map((row) => row.name)).toContain("WorkbenchEvent_parentTaskId_state_priority_createdAt_idx");
    } finally {
      await prisma.$disconnect();
    }
  });
});
