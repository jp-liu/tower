// @vitest-environment node
import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../../../../scripts/migrations/0029-unattended-goal-runtime";
import { up as addCapabilities } from "../../../../scripts/migrations/0030-capability-runtime";
import { up as addGoalPolicy } from "../../../../scripts/migrations/0032-unattended-goal-policy";
import { up as addFinalNotification } from "../../../../scripts/migrations/0036-unattended-final-notification";
import { up as decoupleNotificationState } from "../../../../scripts/migrations/0037-decouple-goal-notification-state";

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

describe("unattended goal migrations", () => {
  it("backfills active runs, upgrades idempotently, and cleans module-owned rows with their task", async () => {
    const prisma = await database();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Task" ("id", "unattended") VALUES ('active', 1), ('attended', 0)`,
    );

    await up(prisma);
    await up(prisma);
    await addGoalPolicy(prisma);
    await addGoalPolicy(prisma);
    await addCapabilities(prisma);
    await addFinalNotification(prisma);
    await addFinalNotification(prisma);

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

    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `PRAGMA table_info("UnattendedGoalRuntime")`,
    );
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "blockedReason",
      "maxDurationMs",
      "maxProviderTurns",
      "nextWakeAt",
      "wakeGeneration",
      "blockEventPublishedAt",
      "ownerNotificationRequestId",
      "ownerNotificationState",
    ]));
    await prisma.$executeRawUnsafe(`
      INSERT INTO "UnattendedGoalProgressFact" (
        "id", "taskId", "kind", "outcome", "dedupKey"
      ) VALUES ('fact-1', 'active', 'PROVIDER_TURN_COMPLETED', 'TURN', 'turn-1')
    `);

    await prisma.$executeRawUnsafe(`DELETE FROM "Task" WHERE "id" = 'active'`);
    const [runtimeRows, factRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS "count" FROM "UnattendedGoalRuntime"`,
      ),
      prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS "count" FROM "UnattendedGoalProgressFact"`,
      ),
    ]);
    expect(Number(runtimeRows[0]?.count)).toBe(0);
    expect(Number(factRows[0]?.count)).toBe(0);
  });

  it("ends completed Goals that were blocked only by notification delivery", async () => {
    const prisma = await database();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Task" ("id", "unattended") VALUES ('completed-notify-failed', 0), ('real-blocker', 0)`,
    );
    await up(prisma);
    await addCapabilities(prisma);
    await addGoalPolicy(prisma);
    await addFinalNotification(prisma);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "UnattendedGoalRuntime" (
        "taskId", "state", "lastEventKind", "activatedAt", "blockedAt", "blockedReason",
        "ownerNotificationKind", "ownerNotificationState", "updatedAt"
      ) VALUES
        (
          'completed-notify-failed', 'BLOCKED', 'TERMINAL_COMPLETED', CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP, 'Final OWNER notification has not been confirmed',
          'COMPLETED', 'FAILED', CURRENT_TIMESTAMP
        ),
        (
          'real-blocker', 'BLOCKED', 'TERMINAL_FAILED', CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP, 'The task terminal exited with a failure',
          'BLOCKED', 'SUCCEEDED', CURRENT_TIMESTAMP
        )
    `);

    await decoupleNotificationState(prisma);
    await decoupleNotificationState(prisma);

    const rows = await prisma.$queryRawUnsafe<Array<{
      taskId: string;
      state: string;
      endedAt: Date | null;
      blockedAt: Date | null;
      blockedReason: string | null;
    }>>(`
      SELECT "taskId", "state", "endedAt", "blockedAt", "blockedReason"
      FROM "UnattendedGoalRuntime"
      ORDER BY "taskId"
    `);
    expect(rows).toEqual([
      expect.objectContaining({
        taskId: "completed-notify-failed",
        state: "ENDED",
        endedAt: expect.any(Date),
        blockedAt: null,
        blockedReason: null,
      }),
      expect.objectContaining({
        taskId: "real-blocker",
        state: "BLOCKED",
        endedAt: null,
        blockedAt: expect.any(Date),
        blockedReason: "The task terminal exited with a failure",
      }),
    ]);
  });
});
