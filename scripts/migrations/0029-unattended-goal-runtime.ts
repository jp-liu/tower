/** Move the unattended runtime marker behind the optional goal module boundary. */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UnattendedGoalRuntime" (
      "taskId" TEXT NOT NULL PRIMARY KEY,
      "state" TEXT NOT NULL DEFAULT 'ACTIVE',
      "lastEventKind" TEXT NOT NULL,
      "activatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "endedAt" DATETIME,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "UnattendedGoalRuntime_state_updatedAt_idx" ` +
      `ON "UnattendedGoalRuntime"("state", "updatedAt")`,
  );
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS "UnattendedGoalRuntime_task_delete"
    AFTER DELETE ON "Task"
    BEGIN
      DELETE FROM "UnattendedGoalRuntime" WHERE "taskId" = OLD."id";
    END
  `);

  // schema sync runs before this migration and intentionally retains the
  // compatibility column for one release, so active runs can be copied safely.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "UnattendedGoalRuntime" (
      "taskId", "state", "lastEventKind", "activatedAt", "endedAt", "updatedAt"
    )
    SELECT "id", 'ACTIVE', 'LEGACY_BACKFILL', CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP
    FROM "Task"
    WHERE "unattended" = 1
    ON CONFLICT("taskId") DO NOTHING
  `);
}
