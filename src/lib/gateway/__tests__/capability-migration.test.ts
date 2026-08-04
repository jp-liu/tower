// @vitest-environment node
import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../../../../scripts/migrations/0030-capability-runtime";
import { up as addResultWakeup } from "../../../../scripts/migrations/0031-capability-result-wakeup";
import { up as addCompletionCallback } from "../../../../scripts/migrations/0033-capability-completion-callback";

const clients: PrismaClient[] = [];
const directories: string[] = [];

async function database(): Promise<PrismaClient> {
  const directory = await mkdtemp(join(tmpdir(), "tower-capability-migration-"));
  directories.push(directory);
  const client = new PrismaClient({ datasourceUrl: `file:${join(directory, "capability.db")}` });
  clients.push(client);
  await client.$executeRawUnsafe(`
    CREATE TABLE "Task" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL
    )
  `);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("0030 capability runtime migration", () => {
  it("is idempotent and cleans grants and correlations when the Core task is deleted", async () => {
    const prisma = await database();
    await up(prisma);
    await up(prisma);
    await addResultWakeup(prisma);
    await addResultWakeup(prisma);
    await addCompletionCallback(prisma);
    await addCompletionCallback(prisma);
    await prisma.$executeRawUnsafe(`INSERT INTO "Task" ("id", "title") VALUES ('task-1', 'Task')`);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "CapabilityGrant" (
        "id", "taskId", "capability", "risk", "targetKind", "targetFingerprint",
        "issuer", "maxUses", "expiresAt"
      ) VALUES (
        'grant-1', 'task-1', 'human.message.send', 'R2', 'OWNER_HOME_ROUTE',
        'fingerprint', 'TOWER_UI', 1, '2099-01-01T00:00:00.000Z'
      )
    `);
    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `PRAGMA table_info("CapabilityRequest")`,
    );
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "resultEventPublishedAt",
      "callbackTokenHash",
    ]));
    await prisma.$executeRawUnsafe(`
      INSERT INTO "CapabilityRequest" (
        "requestId", "taskId", "capability", "lane", "risk", "authorizationRef",
        "inputDigest", "inputsJson"
      ) VALUES (
        'request-1', 'task-1', 'human.message.send', 'DIRECT', 'R2', 'grant-1',
        'digest', '{"message":"hello"}'
      )
    `);

    await prisma.$executeRawUnsafe(`DELETE FROM "Task" WHERE "id" = 'task-1'`);
    const [grants, requests] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS "count" FROM "CapabilityGrant"`),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS "count" FROM "CapabilityRequest"`),
    ]);
    expect(Number(grants[0]?.count)).toBe(0);
    expect(Number(requests[0]?.count)).toBe(0);
  });
});
