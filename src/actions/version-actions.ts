"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { createVersionSchema, updateVersionSchema } from "@/lib/schemas";
import { getBranchHead, getDiffStat, getDiffPatch } from "@/lib/version-git";

export async function getProjectVersions(projectId: string) {
  return db.version.findMany({
    where: { projectId },
    orderBy: [{ targetDate: "desc" }, { order: "desc" }, { createdAt: "desc" }],
    include: {
      type: true,
      tasks: {
        orderBy: [{ order: "asc" }, { createdAt: "desc" }],
        include: {
          labels: { include: { label: true } },
          assets: { select: { id: true, filename: true, mimeType: true, size: true } },
          notes: { select: { id: true, title: true, category: true } },
        },
      },
    },
  });
}

export async function createVersion(data: {
  projectId: string; number: string; name: string;
  typeId?: string; baseBranch?: string;
  startDate?: Date; targetDate?: Date; description?: string; setCurrent?: boolean;
}) {
  const v = createVersionSchema.parse(data);
  let baseCommit: string | null = null;
  if (v.baseBranch) {
    const project = await db.project.findUnique({
      where: { id: v.projectId }, select: { localPath: true },
    });
    if (project?.localPath) baseCommit = getBranchHead(project.localPath, v.baseBranch);
  }
  const version = await db.version.create({
    data: {
      projectId: v.projectId, number: v.number, name: v.name,
      typeId: v.typeId ?? null, status: "PLANNED",
      baseBranch: v.baseBranch ?? null, baseCommit,
      startDate: v.startDate ?? null, targetDate: v.targetDate ?? null,
      description: v.description ?? null,
    },
  });
  if (v.setCurrent) await setCurrentVersion(version.id);
  revalidatePath("/workspaces");
  return version;
}

export async function updateVersion(versionId: string, data: {
  number?: string; name?: string; typeId?: string | null;
  baseBranch?: string | null; startDate?: Date | null; targetDate?: Date | null; description?: string | null;
}) {
  const v = updateVersionSchema.parse(data);
  try {
    const version = await db.version.update({ where: { id: versionId }, data: v });
    revalidatePath("/workspaces");
    return version;
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2025") {
      throw new Error("版本不存在");
    }
    throw e;
  }
}

export async function deleteVersion(versionId: string) {
  try {
    await db.version.delete({ where: { id: versionId } });
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2025") {
      throw new Error("版本不存在");
    }
    throw e;
  }
  revalidatePath("/workspaces");
}

export async function assignTaskVersion(taskId: string, versionId: string | null) {
  await db.task.updateMany({ where: { id: taskId }, data: { versionId } });
  revalidatePath("/workspaces");
}

export async function releaseVersion(versionId: string, nextVersionId: string) {
  const version = await db.version.findUnique({
    where: { id: versionId },
    select: { id: true, projectId: true, status: true, baseBranch: true, project: { select: { localPath: true } } },
  });
  if (!version) throw new Error("版本不存在");
  if (version.status === "RELEASED") throw new Error("该版本已发布");

  let releaseCommit: string | null = null;
  if (version.baseBranch && version.project?.localPath) {
    releaseCommit = getBranchHead(version.project.localPath, version.baseBranch);
  }

  const next = await db.version.findUnique({ where: { id: nextVersionId }, select: { id: true, projectId: true, status: true } });
  if (!next) throw new Error("目标版本不存在");
  if (next.projectId !== version.projectId) throw new Error("目标版本必须属于同一项目");
  if (next.id === versionId) throw new Error("目标版本不能是正在发布的版本本身");
  if (next.status === "RELEASED") throw new Error("目标版本已发布，不能作为下一个当前版本");

  await db.$transaction(async (tx) => {
    await tx.version.update({
      where: { id: versionId },
      data: { status: "RELEASED", releasedAt: new Date(), releaseCommit, isCurrent: false },
    });
    await tx.task.updateMany({
      where: { versionId, status: { notIn: ["DONE", "CANCELLED"] } },
      data: { versionId: nextVersionId },
    });
    await tx.version.updateMany({ where: { projectId: version.projectId, isCurrent: true }, data: { isCurrent: false } });
    await tx.version.update({ where: { id: nextVersionId }, data: { isCurrent: true, status: "ACTIVE" } });
  });
  revalidatePath("/workspaces");
}

export async function getVersionsForPicker(projectId: string) {
  return db.version.findMany({
    where: { projectId, status: { not: "RELEASED" } },
    select: { id: true, number: true, name: true, isCurrent: true, status: true },
    orderBy: [{ isCurrent: "desc" }, { targetDate: "desc" }, { createdAt: "desc" }],
  });
}

export async function getVersionDiffStat(versionId: string) {
  const v = await db.version.findUnique({
    where: { id: versionId },
    select: { baseCommit: true, releaseCommit: true, baseBranch: true, project: { select: { localPath: true } } },
  });
  if (!v?.baseCommit || !v.project?.localPath) return null;
  const to = v.releaseCommit ?? (v.baseBranch ? getBranchHead(v.project.localPath, v.baseBranch) : null);
  if (!to) return null;
  return getDiffStat(v.project.localPath, v.baseCommit, to);
}

export async function getVersionDiff(versionId: string): Promise<{ patch: string } | null> {
  const v = await db.version.findUnique({
    where: { id: versionId },
    select: {
      baseCommit: true,
      releaseCommit: true,
      baseBranch: true,
      project: { select: { localPath: true } },
    },
  });
  if (!v?.baseCommit || !v.project?.localPath) return null;
  const to = v.releaseCommit ?? (v.baseBranch ? getBranchHead(v.project.localPath, v.baseBranch) : null);
  if (!to) return null;
  return { patch: getDiffPatch(v.project.localPath, v.baseCommit, to) };
}

export async function setCurrentVersion(versionId: string) {
  const version = await db.version.findUnique({ where: { id: versionId }, select: { id: true, projectId: true } });
  if (!version) throw new Error("版本不存在");
  await db.$transaction(async (tx) => {
    await tx.version.updateMany({ where: { projectId: version.projectId, isCurrent: true }, data: { isCurrent: false } });
    await tx.version.update({ where: { id: versionId }, data: { isCurrent: true, status: "ACTIVE" } });
  });
  revalidatePath("/workspaces");
}
