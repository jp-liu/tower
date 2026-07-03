/**
 * 项目知识库地基：Project.productKey / Project.knowledgeDir + ProjectFact 表。
 *
 * - productKey: 产品组归一（前后端 a/b 填同值即成组），问答时兄弟项目一起检索。
 * - knowledgeDir: repo 内知识库目录（相对 localPath），留空走约定默认。
 * - ProjectFact: 机器拿不到的项目级事实卡（生产/CICD 路径等），key 项目内唯一。
 *
 * 加性 raw SQL —— 绝不碰 notes_fts 虚表（prisma db push 会卡死）。
 * 幂等：SQLite 无 ADD COLUMN IF NOT EXISTS，先 PRAGMA 检查列是否存在。
 *
 * Table/column names hardcoded on purpose — a migration is a point-in-time
 * snapshot and must keep doing exactly what it did the day it shipped.
 */

import type { PrismaClient } from "@prisma/client";

async function addColumnIfMissing(
  prisma: PrismaClient,
  table: string,
  column: string,
  ddlType: string
): Promise<void> {
  const cols = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("${table}")`
  );
  const hasCol = Array.isArray(cols) && cols.some((c) => c.name === column);
  if (!hasCol) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ADD COLUMN "${column}" ${ddlType}`
    );
    console.log(`  added ${table}.${column}`);
  }
}

export async function up(prisma: PrismaClient): Promise<void> {
  await addColumnIfMissing(prisma, "Project", "productKey", "TEXT");
  await addColumnIfMissing(prisma, "Project", "knowledgeDir", "TEXT");
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Project_productKey_idx" ON "Project"("productKey")`
  );

  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "ProjectFact" (` +
      `"id" TEXT NOT NULL PRIMARY KEY, ` +
      `"projectId" TEXT NOT NULL, ` +
      `"key" TEXT NOT NULL, ` +
      `"value" TEXT NOT NULL, ` +
      `"updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ` +
      `CONSTRAINT "ProjectFact_projectId_fkey" FOREIGN KEY ("projectId") ` +
      `REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE)`
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ProjectFact_projectId_key_key" ON "ProjectFact"("projectId", "key")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ProjectFact_projectId_idx" ON "ProjectFact"("projectId")`
  );
}
