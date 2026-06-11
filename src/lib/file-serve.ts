import * as path from "node:path";
import { existsSync } from "node:fs";
import { getStorageDir } from "./tower-dir";
import { db } from "./db";

export const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
};

export function resolveAssetPath(
  projectId: string,
  filename: string
): { resolved: string | null; error: string | null } {
  const dataRoot = getStorageDir();
  const resolved = path.resolve(dataRoot, "assets", projectId, filename);
  const safePrefix = path.resolve(dataRoot, "assets") + path.sep;
  if (!resolved.startsWith(safePrefix)) {
    return { resolved: null, error: "Invalid path" };
  }
  return { resolved, error: null };
}

/**
 * Resolve the actual on-disk file for an asset.
 *
 * Fast path: reconstruct under the *current* storage root. Fallback: the DB
 * `ProjectAsset.path` is the source of truth — it locates files stored under a
 * legacy or relocated storage root (the layout has moved across versions:
 * `data/`, `.tower/data/`, `~/.tower/storage/`), which the current-storage
 * reconstruction alone can't find. Returns null if no readable file is found.
 */
export async function resolveAssetFile(
  projectId: string,
  filename: string
): Promise<string | null> {
  const { resolved } = resolveAssetPath(projectId, filename);
  if (resolved && existsSync(resolved)) return resolved;

  const asset = await db.projectAsset.findFirst({
    where: { projectId, filename },
    select: { path: true },
    orderBy: { createdAt: "desc" },
  });
  if (asset?.path && existsSync(asset.path)) return asset.path;

  return null;
}

/** True if `p` matches the stored path of some ProjectAsset — a trusted target. */
export async function isRegisteredAssetPath(p: string): Promise<boolean> {
  const asset = await db.projectAsset.findFirst({
    where: { path: p },
    select: { id: true },
  });
  return asset !== null;
}

// Re-export from browser-safe module for backward compatibility
export { localPathToApiUrl } from "./file-serve-client";
