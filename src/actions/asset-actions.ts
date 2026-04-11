"use server";

import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { ensureAssetsDir } from "@/lib/file-utils";
import { getConfigValue } from "@/actions/config-actions";

const createAssetSchema = z.object({
  filename: z.string().min(1).max(255),
  path: z.string().min(1),
  mimeType: z.string().max(100).optional(),
  size: z.number().int().nonnegative().optional(),
  projectId: z.string().min(1),
  description: z.string().max(500).optional(),
  taskId: z.string().optional(),
});

export async function createAsset(data: {
  filename: string;
  path: string;
  mimeType?: string;
  size?: number;
  projectId: string;
  description?: string;
  taskId?: string;
}) {
  const parsed = createAssetSchema.parse(data);
  ensureAssetsDir(parsed.projectId);
  const asset = await db.projectAsset.create({ data: { ...parsed, taskId: parsed.taskId ?? null } });
  revalidatePath(`/workspaces`);
  return asset;
}

export async function deleteAsset(assetId: string) {
  const asset = await db.projectAsset.findUnique({ where: { id: assetId } });
  if (asset?.path) {
    await fs.promises.unlink(asset.path).catch(() => {});
  }
  await db.projectAsset.delete({ where: { id: assetId } });
  revalidatePath(`/workspaces`);
}

export async function getProjectAssets(projectId: string) {
  return db.projectAsset.findMany({
    where: { projectId, taskId: null },
    orderBy: { createdAt: "desc" },
  });
}

export async function getTaskAssets(taskId: string) {
  return db.projectAsset.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAssetById(assetId: string) {
  return db.projectAsset.findUnique({ where: { id: assetId } });
}

export async function uploadAsset(formData: FormData) {
  const file = formData.get("file") as File;
  const projectId = formData.get("projectId") as string;
  const taskId = (formData.get("taskId") as string | null) || undefined;
  if (!file || !projectId) throw new Error("Missing file or projectId");
  const maxBytes = await getConfigValue<number>("system.maxUploadBytes", 52428800);
  if (file.size > maxBytes) throw new Error(`File too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)`);
  const description = (formData.get("description") as string | null) ?? "";

  // Validate projectId exists in DB before any filesystem operation
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Invalid projectId");

  const buffer = Buffer.from(await file.arrayBuffer());
  const dir = ensureAssetsDir(projectId);

  // Sanitize filename: strip directory components to prevent path traversal
  let filename = path.basename(file.name);
  if (!filename || filename === "." || filename === "..") {
    filename = `upload-${Date.now()}`;
  }

  // Avoid overwriting: append timestamp if file exists
  const destCheck = path.join(dir, filename);
  if (fs.existsSync(destCheck)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    filename = `${base}-${Date.now()}${ext}`;
  }

  const dest = path.join(dir, filename);
  // Containment check: ensure resolved path stays within assets directory
  if (!dest.startsWith(dir)) throw new Error("Invalid filename");
  await fs.promises.writeFile(dest, buffer);

  const asset = await createAsset({
    filename,
    path: dest,
    mimeType: file.type || undefined,
    size: file.size,
    projectId,
    description: description || undefined,
    taskId,
  });
  revalidatePath(`/workspaces`);
  return asset;
}
