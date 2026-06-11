import * as path from "node:path";
import { getStorageDir } from "./tower-dir";

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

// Re-export from browser-safe module for backward compatibility
export { localPathToApiUrl } from "./file-serve-client";
