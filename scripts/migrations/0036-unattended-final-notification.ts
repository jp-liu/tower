/** Add durable unattended Goal terminal-notification intent and request metadata. */

import type { PrismaClient } from "@prisma/client";

type MigrationClient = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe">;

const RUNTIME_COLUMNS: Array<[string, string]> = [
  ["ownerNotificationRequestId", "TEXT"],
  ["ownerNotificationKind", "TEXT"],
  ["ownerNotificationState", "TEXT"],
  ["ownerNotificationSummary", "TEXT"],
  ["ownerNotificationBinding", "TEXT"],
  ["ownerNotificationError", "TEXT"],
  ["ownerNotificationCreatedAt", "DATETIME"],
  ["ownerNotificationCompletedAt", "DATETIME"],
];

async function addColumns(
  prisma: MigrationClient,
  table: string,
  columns: Array<[string, string]>,
): Promise<void> {
  const existing = new Set((await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("${table}")`,
  )).map((column) => column.name));
  for (const [name, type] of columns) {
    if (!existing.has(name)) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${type}`);
    }
  }
}

export async function up(prisma: MigrationClient): Promise<void> {
  await addColumns(prisma, "UnattendedGoalRuntime", RUNTIME_COLUMNS);
  await addColumns(prisma, "CapabilityRequest", [["goalTerminalKind", "TEXT"]]);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "CapabilityRequest_taskId_capability_goalTerminalKind_state_idx" `
      + `ON "CapabilityRequest"("taskId", "capability", "goalTerminalKind", "state")`,
  );
}
