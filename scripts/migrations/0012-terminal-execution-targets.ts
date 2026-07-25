/**
 * Add stable Terminal target snapshots to TaskExecution.
 *
 * The snapshot columns intentionally have no foreign keys: deleting or replacing a
 * ProviderConnection/AiCapabilityTarget must not erase historical resume identity.
 */

import type { PrismaClient } from "@prisma/client";

type MigrationClient = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe">;
type Column = { name: string };

const COLUMNS = ["connectionId", "modelId", "targetId"] as const;
const LEGACY_AGENT_PROVIDERS: Readonly<Record<string, string>> = {
  CLAUDE_CODE: "claude",
  CODEX_CLI: "codex",
  GEMINI_CLI: "gemini",
};

async function tableExists(prisma: MigrationClient, table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = ?`,
    table,
  );
  return rows.length === 1;
}

export async function up(prisma: PrismaClient): Promise<void> {
  if (!await tableExists(prisma, "TaskExecution")) return;

  await prisma.$transaction(async (transaction) => {
    const columns = await transaction.$queryRawUnsafe<Column[]>(
      `PRAGMA table_info("TaskExecution")`,
    );
    const existing = new Set(columns.map((column) => column.name));
    for (const column of COLUMNS) {
      if (existing.has(column)) continue;
      await transaction.$executeRawUnsafe(
        `ALTER TABLE "TaskExecution" ADD COLUMN "${column}" TEXT`,
      );
    }

    if (!await tableExists(transaction, "ProviderConnection")) return;

    for (const [agent, provider] of Object.entries(LEGACY_AGENT_PROVIDERS)) {
      const connections = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "ProviderConnection" ` +
          `WHERE "kind" = 'cli' AND "connectionKey" = ?`,
        `cli:${provider}`,
      );
      if (connections.length !== 1) continue;
      await transaction.$executeRawUnsafe(
        `UPDATE "TaskExecution" SET "connectionId" = ? ` +
          `WHERE "connectionId" IS NULL AND "agent" = ?`,
        connections[0]!.id,
        agent,
      );
    }
  });
}
