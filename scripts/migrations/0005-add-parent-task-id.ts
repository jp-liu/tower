/**
 * Add Task.parentTaskId — 派生中枢的父任务链。
 *
 * 子任务由父任务终端的 claude 调 create_task 创建时，写入派生它的父任务 id
 * （父任务 PTY 注入的 TOWER_TASK_ID）。用于完成回推（子任务 stop → 通知父任务
 * review）及将来的派生子任务展示。裸字符串列、无 FK relation（与 promptId 同惯例）。
 *
 * 加性 raw SQL —— 绝不碰 notes_fts 虚表（prisma db push 会卡死）。
 * 幂等：SQLite 无 ADD COLUMN IF NOT EXISTS，先 PRAGMA 检查列是否存在。
 *
 * Table/column names hardcoded on purpose — a migration is a point-in-time
 * snapshot and must keep doing exactly what it did the day it shipped.
 */

import type { PrismaClient } from "@prisma/client";

export async function up(prisma: PrismaClient): Promise<void> {
  const cols = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("Task")`
  );
  const hasCol = Array.isArray(cols) && cols.some((c) => c.name === "parentTaskId");
  if (!hasCol) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Task" ADD COLUMN "parentTaskId" TEXT`);
    console.log("  added Task.parentTaskId");
  }
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Task_parentTaskId_idx" ON "Task"("parentTaskId")`
  );
}
