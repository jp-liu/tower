"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { ensureAssetsDir } from "@/lib/file-utils";

const createAssetSchema = z.object({
  filename: z.string().min(1).max(255),
  path: z.string().min(1),
  mimeType: z.string().max(100).optional(),
  size: z.number().int().nonnegative().optional(),
  projectId: z.string().min(1),
});

export async function createAsset(data: {
  filename: string;
  path: string;
  mimeType?: string;
  size?: number;
  projectId: string;
}) {
  const parsed = createAssetSchema.parse(data);
  ensureAssetsDir(parsed.projectId);
  const asset = await db.projectAsset.create({ data: parsed });
  revalidatePath(`/workspace`);
  return asset;
}

export async function deleteAsset(assetId: string) {
  await db.projectAsset.delete({ where: { id: assetId } });
  revalidatePath(`/workspace`);
}

export async function getProjectAssets(projectId: string) {
  return db.projectAsset.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAssetById(assetId: string) {
  return db.projectAsset.findUnique({ where: { id: assetId } });
}
