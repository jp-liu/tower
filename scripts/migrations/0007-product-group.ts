/**
 * 产品组一等实体：ProductGroup 表 + Project.groupId，取代平级字符串 Project.productKey。
 *
 * 加性 raw SQL —— 绝不碰 notes_fts 虚表。幂等：建表/建索引用 IF NOT EXISTS，加列先 PRAGMA 查。
 *
 * 为什么没有 productKey→组的数据回填：
 *   1. productKey 从未发布（无真实数据）。
 *   2. Tower 升级生命周期（bin/tower.mjs preStart）**先** `db push --accept-data-loss`
 *      按新 schema 同步、**再**跑本迁移。新 schema 已删 productKey，故 db push 会先
 *      把该列连数据一起丢掉——等本迁移执行时 productKey 早已不存在，回填必成死代码。
 *   迁移只负责把 groupId/ProductGroup 幂等建出来（供不走 db push 的 dev/迁移路径），
 *   并清掉遗留的 productKey 列。删组时的「成员解绑」由 group-actions 在应用层做
 *   （ADD COLUMN 不带外键，不能靠 DB 级 onDelete: SetNull）。
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

  // 3. 清掉遗留 productKey 列（先删其索引）。无回填——见文件头说明。
  //    SQLite <3.35 不支持 DROP COLUMN → 留孤儿列，Prisma 忽略，无害。
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Project_productKey_idx"`);
  if (await hasColumn(prisma, "Project", "productKey")) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Project" DROP COLUMN "productKey"`);
      console.log("  dropped Project.productKey");
    } catch {
      console.log("  DROP COLUMN productKey unsupported (old SQLite) — left orphaned, harmless");
    }
  }
}
