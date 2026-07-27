import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { up as createWorkbenchEvents } from "../../../scripts/migrations/0014-workbench-events";
import { up } from "../../../scripts/migrations/0015-workbench-execution-review-key";

const tempDirs: string[] = [];

async function database(): Promise<PrismaClient> {
  const dir = await mkdtemp(join(tmpdir(), "tower-workbench-guard-migration-"));
  tempDirs.push(dir);
  const prisma = new PrismaClient({ datasourceUrl: `file:${join(dir, "migration.db")}` });
  await prisma.$executeRawUnsafe(`CREATE TABLE "Task" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE "TaskExecution" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await createWorkbenchEvents(prisma);
  await prisma.$executeRawUnsafe(`INSERT INTO "Task" ("id") VALUES ('parent'), ('child')`);
  await prisma.$executeRawUnsafe(`INSERT INTO "TaskExecution" ("id") VALUES ('exec')`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "WorkbenchEvent" (
      "id", "parentTaskId", "sourceTaskId", "executionId", "kind", "dedupKey", "payload", "state", "createdAt", "updatedAt"
    ) VALUES
      ('event-1', 'parent', 'child', 'exec', 'CHILD_REVIEW_REQUIRED', 'stop-1', '{}', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('event-2', 'parent', 'child', 'exec', 'CHILD_REVIEW_REQUIRED', 'stop-2', '{}', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  return prisma;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("0015 Workbench execution review guard migration", () => {
  it("adds the nullable guard and unique index idempotently after 0014", async () => {
    const prisma = await database();
    try {
      await up(prisma);
      await up(prisma);
      const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("WorkbenchEvent")`,
      );
      const indexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT "name" FROM "sqlite_master" WHERE "type" = 'index' AND "tbl_name" = 'WorkbenchEvent'`,
      );
      expect(columns.map((column) => column.name)).toContain("executionReviewKey");
      expect(indexes.map((row) => row.name)).toContain("WorkbenchEvent_executionReviewKey_key");
      const events = await prisma.workbenchEvent.findMany({ orderBy: { id: "asc" } });
      expect(events.map((event) => event.executionReviewKey)).toEqual([
        "execution-review:child:exec",
        null,
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });
});
