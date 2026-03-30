"use server";

import * as fs from "node:fs";
import * as path from "node:path";
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
  description: z.string().max(500).optional(),
});

export async function createAsset(data: {
  filename: string;
  path: string;
  mimeType?: string;
  size?: number;
  projectId: string;
  description?: string;
}) {
  const parsed = createAssetSchema.parse(data);
  ensureAssetsDir(parsed.projectId);
  const asset = await db.projectAsset.create({ data: parsed });
  revalidatePath(`/workspaces`);
  return asset;
}

export async function deleteAsset(assetId: string) {
  await db.projectAsset.delete({ where: { id: assetId } });
  revalidatePath(`/workspaces`);
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

export async function uploadAsset(formData: FormData) {
  const file = formData.get("file") as File;
  const projectId = formData.get("projectId") as string;
  if (!file || !projectId) throw new Error("Missing file or projectId");
  const description = (formData.get("description") as string | null) ?? "";

  const buffer = Buffer.from(await file.arrayBuffer());
  const dir = ensureAssetsDir(projectId);

  // Avoid overwriting: append timestamp if file exists
  let filename = file.name;
  const destCheck = path.join(dir, filename);
  if (fs.existsSync(destCheck)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    filename = `${base}-${Date.now()}${ext}`;
  }

  const dest = path.join(dir, filename);
  await fs.promises.writeFile(dest, buffer);

  const asset = await createAsset({
    filename,
    path: dest,
    mimeType: file.type || undefined,
    size: file.size,
    projectId,
    description: description || undefined,
  });
  revalidatePath(`/workspaces`);
  return asset;
}
