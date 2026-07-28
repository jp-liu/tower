import type { PrismaClient } from "@prisma/client";

export const HISTORICAL_SENT_UNVERIFIED_DELIVERIES = [
  ["cms440l780009cmire8r6smi3", "om_x100b69b61fe0b0a0386a09bf95afefb"],
  ["cms4426gt000ccmirolurql2w", "om_x100b69b61b0008a0385cee1243f731e"],
  ["cms448bbq000hcmirrbnc1u5t", "om_x100b69b6297c98a03856d8b8bc9d711"],
  ["cms45b6h8000ocmirngnep40b", "om_x100b69b697c81ca038654f1be7cb906"],
  ["cms45dl5c000scmir7dw03j89", "om_x100b69b6aec63ca03865bca43010e1f"],
] as const;

const MIGRATION_AUDIT = "Historical platform send quarantined: platform returned message_id, but the native reply/card contract was not verified; manual review required; automatic retry is disabled.";

async function hasColumn(prisma: PrismaClient, table: string, column: string): Promise<boolean> {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`);
  return columns.some((item) => item.name === column);
}

export async function up(prisma: PrismaClient): Promise<void> {
  for (const [column, type] of [
    ["platformChatId", "TEXT"],
    ["platformParentId", "TEXT"],
    ["platformMessageType", "TEXT"],
  ] as const) {
    if (!await hasColumn(prisma, "GatewayDelivery", column)) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "GatewayDelivery" ADD COLUMN "${column}" ${type}`);
    }
  }

  await prisma.$transaction(
    HISTORICAL_SENT_UNVERIFIED_DELIVERIES.map(([id, platformMessageId]) =>
      prisma.$executeRawUnsafe(
        `UPDATE "GatewayDelivery" ` +
        `SET "state" = 'SENT_UNVERIFIED', "nextAttemptAt" = NULL, ` +
        `"lastError" = CASE ` +
          `WHEN "lastError" IS NULL OR trim("lastError") = '' THEN ? ` +
          `WHEN instr("lastError", ?) > 0 THEN "lastError" ` +
          `ELSE substr("lastError" || '; ' || ?, 1, 2000) END, ` +
        `"updatedAt" = CURRENT_TIMESTAMP ` +
        `WHERE "id" = ? AND "platformMessageId" = ? AND "state" = 'FAILED'`,
        MIGRATION_AUDIT,
        MIGRATION_AUDIT,
        MIGRATION_AUDIT,
        id,
        platformMessageId,
      ),
    ),
  );
}
