/**
 * 产品组一等实体：ProductGroup 表 + Project.groupId，取代平级字符串 Project.productKey。
 *
 * - ProductGroup: 同工作区内 name 唯一；删组只解绑成员（Project.groupId ON DELETE SET NULL）。
 * - 数据迁移：把现有 distinct (workspaceId, productKey) 建成组并回填成员 groupId。
 * - 收尾：删 Project.productKey 列（SQLite 3.35+ 支持 DROP COLUMN；旧版本则留孤儿列，
 *   Prisma 忽略 schema 外的多余列，无害）。
 *
 * 加性 raw SQL —— 绝不碰 notes_fts 虚表。幂等：建表/建索引用 IF NOT EXISTS，
 * 加列先 PRAGMA 查，数据迁移用 WHERE NOT EXISTS 防重复。
 *
 * Table/column names hardcoded on purpose — a migration is a point-in-time snapshot.
 */

import type { PrismaClient } from "@prisma/client";

async function hasColumn(prisma: PrismaClient, table: string, column: string): Promise<boolean> {
  const cols = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("${table}")`
  );
  return Array.isArray(cols) && cols.some((c) => c.name === column);
}

export async function up(prisma: PrismaClient): Promise<void> {
  // 1. ProductGroup 表
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "ProductGroup" (` +
      `"id" TEXT NOT NULL PRIMARY KEY, ` +
      `"name" TEXT NOT NULL, ` +
      `"description" TEXT, ` +
      `"workspaceId" TEXT NOT NULL, ` +
      `"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ` +
      `"updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, ` +
      `CONSTRAINT "ProductGroup_workspaceId_fkey" FOREIGN KEY ("workspaceId") ` +
      `REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE)`
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ProductGroup_workspaceId_name_key" ON "ProductGroup"("workspaceId", "name")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ProductGroup_workspaceId_idx" ON "ProductGroup"("workspaceId")`
  );

  // 2. Project.groupId 列 + 索引
  if (!(await hasColumn(prisma, "Project", "groupId"))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Project" ADD COLUMN "groupId" TEXT`);
    console.log("  added Project.groupId");
  }
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Project_groupId_idx" ON "Project"("groupId")`
  );

  // 3. 数据迁移：现有 productKey → 建组 + 回填（仅当 productKey 列还在时）
  if (await hasColumn(prisma, "Project", "productKey")) {
    // 每个 distinct (workspaceId, productKey) 建一个组（用 SQLite randomblob 生成 id）
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ProductGroup" ("id", "name", "workspaceId", "createdAt", "updatedAt") ` +
        `SELECT lower(hex(randomblob(16))), d."productKey", d."workspaceId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP ` +
        `FROM (SELECT DISTINCT "workspaceId", "productKey" FROM "Project" ` +
        `      WHERE "productKey" IS NOT NULL AND "productKey" != '') d ` +
        `WHERE NOT EXISTS (SELECT 1 FROM "ProductGroup" g ` +
        `      WHERE g."workspaceId" = d."workspaceId" AND g."name" = d."productKey")`
    );
    // 回填成员 groupId
    await prisma.$executeRawUnsafe(
      `UPDATE "Project" SET "groupId" = (` +
        `  SELECT g."id" FROM "ProductGroup" g ` +
        `  WHERE g."workspaceId" = "Project"."workspaceId" AND g."name" = "Project"."productKey") ` +
        `WHERE "productKey" IS NOT NULL AND "productKey" != '' AND "groupId" IS NULL`
    );

    // 4. 删旧列（先删其索引）。SQLite <3.35 不支持 DROP COLUMN → 留孤儿列，无害。
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Project_productKey_idx"`);
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Project" DROP COLUMN "productKey"`);
      console.log("  dropped Project.productKey");
    } catch {
      console.log("  DROP COLUMN productKey unsupported (old SQLite) — left orphaned, harmless");
    }
  }
}
