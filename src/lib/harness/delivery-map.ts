import { db } from "@/lib/db";

export type HarnessDeliveryScope = "work" | "unattended";

export interface HarnessDeliveryRecordInput {
  harnessMessageId: string;
  taskId: string;
  platform: string;
  chatId: string;
  platformMessageId: string;
  scope: HarnessDeliveryScope;
  expectReply: boolean;
}

export interface HarnessDeliveryRecord {
  id: string;
  harnessMessageId: string;
  taskId: string;
  platform: string;
  chatId: string;
  platformMessageId: string;
  scope: HarnessDeliveryScope;
  expectReply: boolean;
}

export function extractTowerTaskId(text: string | null | undefined): string | null {
  const m = String(text || "").match(/\[\[tower:task=(c[a-z0-9]{20,30})\]\]/i);
  return m?.[1] ?? null;
}

export async function recordHarnessDelivery(input: HarnessDeliveryRecordInput): Promise<void> {
  if (!input.platformMessageId.trim()) return;
  await ensureHarnessDeliveryTable();
  await db.$executeRaw`
    INSERT OR REPLACE INTO HarnessDelivery
      (id, harnessMessageId, taskId, platform, chatId, platformMessageId, scope, expectReply, createdAt)
    VALUES
      (${`${input.platform}:${input.platformMessageId}`},
       ${input.harnessMessageId},
       ${input.taskId},
       ${input.platform},
       ${input.chatId},
       ${input.platformMessageId},
       ${input.scope},
       ${input.expectReply ? 1 : 0},
       ${new Date()})
  `;
}

export async function findHarnessDeliveryByPlatformMessageId(platformMessageId: string): Promise<HarnessDeliveryRecord | null> {
  const id = platformMessageId.trim();
  if (!id) return null;
  await ensureHarnessDeliveryTable();
  const rows = await db.$queryRaw<Array<{
    id: string;
    harnessMessageId: string;
    taskId: string;
    platform: string;
    chatId: string;
    platformMessageId: string;
    scope: string;
    expectReply: number | boolean;
  }>>`
    SELECT id, harnessMessageId, taskId, platform, chatId, platformMessageId, scope, expectReply
    FROM HarnessDelivery
    WHERE platformMessageId = ${id}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    scope: row.scope === "work" ? "work" : "unattended",
    expectReply: !!row.expectReply,
  };
}

async function ensureHarnessDeliveryTable(): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HarnessDelivery" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "harnessMessageId" TEXT NOT NULL,
      "taskId" TEXT NOT NULL,
      "platform" TEXT NOT NULL,
      "chatId" TEXT NOT NULL,
      "platformMessageId" TEXT NOT NULL,
      "scope" TEXT NOT NULL,
      "expectReply" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "HarnessDelivery_platformMessageId_key"
    ON "HarnessDelivery"("platformMessageId")
  `);
  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "HarnessDelivery_taskId_idx"
    ON "HarnessDelivery"("taskId")
  `);
}
