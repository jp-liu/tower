"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { createVersionSchema, updateVersionSchema } from "@/lib/schemas";
import { getBranchHead } from "@/lib/version-git";

export async function getProjectVersions(projectId: string) {
  return db.version.findMany({
    where: { projectId },
    orderBy: [{ targetDate: "desc" }, { order: "desc" }, { createdAt: "desc" }],
    include: {
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
  type?: "FEATURE" | "BUGFIX" | "RESEARCH"; baseBranch?: string;
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
      type: v.type ?? "FEATURE", status: "PLANNED",
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
  number?: string; name?: string; type?: "FEATURE" | "BUGFIX" | "RESEARCH";
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

// setCurrentVersion 占位（Task 5 替换为真实实现）
export async function setCurrentVersion(versionId: string) { void versionId; }
