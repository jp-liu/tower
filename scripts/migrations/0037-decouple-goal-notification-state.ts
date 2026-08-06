/** Normalize completed Goals that were previously blocked only by notification delivery. */

import type { PrismaClient } from "@prisma/client";

type MigrationClient = Pick<PrismaClient, "$executeRawUnsafe">;

export async function up(prisma: MigrationClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    UPDATE "UnattendedGoalRuntime"
    SET
      "state" = 'ENDED',
      "endedAt" = COALESCE("endedAt", "ownerNotificationCompletedAt", "updatedAt", CURRENT_TIMESTAMP),
      "blockedAt" = NULL,
      "blockedReason" = NULL,
      "nextWakeAt" = NULL,
      "wakeReason" = NULL,
      "blockEventPublishedAt" = COALESCE("blockEventPublishedAt", CURRENT_TIMESTAMP),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "state" = 'BLOCKED'
      AND "ownerNotificationKind" = 'COMPLETED'
  `);
}
