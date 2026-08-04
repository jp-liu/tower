/** Add persistent Goal budgets, timers, watchdog state, and progress dedup. */

import type { PrismaClient } from "@prisma/client";

type MigrationClient = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe">;

const RUNTIME_COLUMNS: Array<[string, string]> = [
  ["blockedAt", "DATETIME"],
  ["blockedReason", "TEXT"],
  ["providerTurns", "INTEGER NOT NULL DEFAULT 0"],
  ["consecutiveFailures", "INTEGER NOT NULL DEFAULT 0"],
  ["noProgressTurns", "INTEGER NOT NULL DEFAULT 0"],
  ["lastProgressAt", "DATETIME"],
  ["maxDurationMs", "INTEGER NOT NULL DEFAULT 28800000"],
  ["maxProviderTurns", "INTEGER NOT NULL DEFAULT 100"],
  ["maxChildTasks", "INTEGER NOT NULL DEFAULT 50"],
  ["maxConcurrentChildren", "INTEGER NOT NULL DEFAULT 4"],
  ["maxConsecutiveFailures", "INTEGER NOT NULL DEFAULT 3"],
  ["maxNoProgressTurns", "INTEGER NOT NULL DEFAULT 5"],
  ["maxCapabilityJobs", "INTEGER NOT NULL DEFAULT 20"],
  ["maxTokens", "INTEGER"],
  ["maxCostUsdCents", "INTEGER"],
  ["consumedTokens", "INTEGER"],
  ["consumedCostUsdCents", "INTEGER"],
  ["nextWakeAt", "DATETIME"],
  ["wakeReason", "TEXT"],
  ["wakeGeneration", "INTEGER NOT NULL DEFAULT 0"],
  ["wakePublishedAt", "DATETIME"],
  ["blockGeneration", "INTEGER NOT NULL DEFAULT 0"],
  ["blockEventPublishedAt", "DATETIME"],
];

export async function up(prisma: MigrationClient): Promise<void> {
  const existing = new Set((await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("UnattendedGoalRuntime")`,
  )).map((column) => column.name));
  for (const [name, type] of RUNTIME_COLUMNS) {
    if (!existing.has(name)) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "UnattendedGoalRuntime" ADD COLUMN "${name}" ${type}`,
      );
    }
  }
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "UnattendedGoalRuntime_state_nextWakeAt_idx" ` +
      `ON "UnattendedGoalRuntime"("state", "nextWakeAt")`,
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UnattendedGoalProgressFact" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "taskId" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "outcome" TEXT NOT NULL,
      "dedupKey" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "UnattendedGoalProgressFact_dedupKey_key" ` +
      `ON "UnattendedGoalProgressFact"("dedupKey")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "UnattendedGoalProgressFact_taskId_createdAt_idx" ` +
      `ON "UnattendedGoalProgressFact"("taskId", "createdAt")`,
  );
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS "UnattendedGoalProgressFact_task_delete"
    AFTER DELETE ON "Task"
    BEGIN
      DELETE FROM "UnattendedGoalProgressFact" WHERE "taskId" = OLD."id";
    END
  `);
}
