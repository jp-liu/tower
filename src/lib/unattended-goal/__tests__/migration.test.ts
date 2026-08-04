// @vitest-environment node
import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../../../../scripts/migrations/0029-unattended-goal-runtime";

const clients: PrismaClient[] = [];
const directories: string[] = [];

async function database(): Promise<PrismaClient> {
  const directory = await mkdtemp(join(tmpdir(), "tower-unattended-goal-migration-"));
  directories.push(directory);
  const client = new PrismaClient({
    datasourceUrl: `file:${join(directory, "unattended-goal.db")}`,
  });
  clients.push(client);
  await client.$executeRawUnsafe(`
    CREATE TABLE "Task" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "unattended" INTEGER NOT NULL DEFAULT 0
    )
  `);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("0029 unattended goal runtime migration", () => {
  it("backfills active runs, remains idempotent, and cleans projections with their task", async () => {
    const prisma = await database();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Task" ("id", "unattended") VALUES ('active', 1), ('attended', 0)`,
    );

    await up(prisma);
    await up(prisma);

    const rows = await prisma.$queryRawUnsafe<Array<{
      taskId: string;
      state: string;
      lastEventKind: string;
    }>>(
      `SELECT "taskId", "state", "lastEventKind" FROM "UnattendedGoalRuntime" ORDER BY "taskId"`,
    );
    expect(rows).toEqual([{
      taskId: "active",
      state: "ACTIVE",
      lastEventKind: "LEGACY_BACKFILL",
    }]);

    await prisma.$executeRawUnsafe(`DELETE FROM "Task" WHERE "id" = 'active'`);
    const remaining = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS "count" FROM "UnattendedGoalRuntime"`,
    );
    expect(Number(remaining[0]?.count)).toBe(0);
  });
});
