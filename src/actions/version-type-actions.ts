"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { createVersionTypeSchema, updateVersionTypeSchema } from "@/lib/schemas";

export async function getVersionTypes(workspaceId: string) {
  return db.versionType.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });
}

export async function createVersionType(data: { workspaceId: string; name: string }) {
  const v = createVersionTypeSchema.parse(data);
  const versionType = await db.versionType.create({
    data: { name: v.name, workspaceId: v.workspaceId },
  });
  revalidatePath("/workspaces");
  return versionType;
}

export async function updateVersionType(id: string, data: { name: string }) {
  const v = updateVersionTypeSchema.parse(data);
  try {
    const versionType = await db.versionType.update({
      where: { id },
      data: { name: v.name },
    });
    revalidatePath("/workspaces");
    return versionType;
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2025") {
      throw new Error("类型不存在");
    }
    throw e;
  }
}

export async function deleteVersionType(id: string) {
  try {
    await db.versionType.delete({ where: { id } });
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2025") {
      throw new Error("类型不存在");
    }
    throw e;
  }
  revalidatePath("/workspaces");
}
