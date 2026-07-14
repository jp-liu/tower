"use server";

import { db } from "@/lib/db";
import { syncGroupDoc, syncProjectDoc } from "@/lib/group-doc";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

/**
 * 产品组（ProductGroup）server actions：分组管理页 + 建/导项目选组用。
 *
 * 安全不变量：**一个组的成员必须全在同一 workspace**。检索层
 * (queryProjectKnowledge) 现在只按 groupId 聚合、不再按 workspace 过滤，所以
 * 跨 workspace 的错误分配会导致知识串区——在「分配成员」处强制同区兜住。
 */

/** 列出工作区的产品组（含成员项目），供分组管理页与选择器用。 */
export async function getProductGroups(workspaceId: string) {
  return db.productGroup.findMany({
    where: { workspaceId },
    orderBy: { name: "asc" },
    include: {
      projects: { select: { id: true, name: true, alias: true }, orderBy: { createdAt: "asc" } },
    },
  });
}

/** 建组。name 在工作区内唯一（撞名抛友好错误）。 */
export async function createProductGroup(input: {
  name: string;
  description?: string;
  workspaceId: string;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("分组名称不能为空");
  if (!input.workspaceId) throw new Error("缺少工作区");
  try {
    const group = await db.productGroup.create({
      data: { name, description: input.description?.trim() || null, workspaceId: input.workspaceId },
    });
    revalidatePath("/workspaces");
    return group;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error(`分组「${name}」在该工作区已存在`);
    }
    throw e;
  }
}

/** 改组名 / 描述。 */
export async function updateProductGroup(
  id: string,
  data: { name?: string; description?: string | null }
) {
  const patch: { name?: string; description?: string | null } = {};
  if (data.name !== undefined) {
    const n = data.name.trim();
    if (!n) throw new Error("分组名称不能为空");
    patch.name = n;
  }
  if (data.description !== undefined) patch.description = data.description?.trim() || null;
  try {
    const group = await db.productGroup.update({ where: { id }, data: patch });
    await syncGroupDoc(db, id); // the block carries the group name — re-render on rename
    revalidatePath("/workspaces");
    return group;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") throw new Error("同工作区已有同名分组");
      if (e.code === "P2025") throw new Error("分组不存在");
    }
    throw e;
  }
}

/** 删组。成员项目仅解绑（groupId=null），不删项目本身。
 *  显式清成员——不依赖 DB 级 onDelete: SetNull：迁移路径(ADD COLUMN)的库没建外键，
 *  且 SQLite 默认不强制外键，靠 DB cascade 会留孤儿 groupId、继续被分到一组。 */
export async function deleteProductGroup(id: string) {
  try {
    // Members must be captured before they are unbound — afterwards nothing
    // points at them, and their CLAUDE.local.md blocks would be left orphaned.
    const members = await db.project.findMany({ where: { groupId: id }, select: { id: true } });
    await db.$transaction([
      db.project.updateMany({ where: { groupId: id }, data: { groupId: null } }),
      db.productGroup.delete({ where: { id } }),
    ]);
    for (const m of members) await syncProjectDoc(db, m.id);
    revalidatePath("/workspaces");
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      throw new Error("分组不存在");
    }
    throw e;
  }
}

/** 把项目加入某组（groupId）或移出组（null）。强制组与项目同工作区。 */
export async function setProjectGroup(projectId: string, groupId: string | null) {
  if (groupId) {
    const [project, group] = await Promise.all([
      db.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } }),
      db.productGroup.findUnique({ where: { id: groupId }, select: { workspaceId: true } }),
    ]);
    if (!project) throw new Error("项目不存在");
    if (!group) throw new Error("分组不存在");
    if (group.workspaceId !== project.workspaceId) {
      throw new Error("分组与项目不在同一工作区，不能跨区分组");
    }
  }
  // Read the old group before the update: joining/leaving re-renders both the
  // old group (remaining members) and the new one.
  const previous = await db.project.findUnique({ where: { id: projectId }, select: { groupId: true } });
  try {
    const project = await db.project.update({ where: { id: projectId }, data: { groupId } });
    if (previous?.groupId && previous.groupId !== groupId) await syncGroupDoc(db, previous.groupId);
    await syncProjectDoc(db, projectId); // joined → re-render new group; detached → strip block
    revalidatePath("/workspaces");
    return project;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      throw new Error("项目不存在");
    }
    throw e;
  }
}
