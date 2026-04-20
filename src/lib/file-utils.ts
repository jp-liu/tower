import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const DATA_ROOT = path.join(process.cwd(), "data");

function assertWithinDataRoot(resolved: string): void {
  if (!resolved.startsWith(DATA_ROOT + path.sep)) {
    throw new Error("Path traversal detected");
  }
}

export function getAssetsDir(projectId: string): string {
  const dir = path.join(DATA_ROOT, "assets", projectId);
  assertWithinDataRoot(dir);
  return dir;
}

export function getCacheDir(taskId: string): string {
  const dir = path.join(DATA_ROOT, "cache", taskId);
  assertWithinDataRoot(dir);
  return dir;
}

export function ensureAssetsDir(projectId: string): string {
  const dir = getAssetsDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureCacheDir(taskId: string): string {
  const dir = getCacheDir(taskId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listAssetFiles(projectId: string): string[] {
  const dir = getAssetsDir(projectId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}

export type CacheFileType = "images" | "files";

export function getAssistantCacheDir(type: CacheFileType = "images"): string {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dir = path.join(DATA_ROOT, "cache", "assistant", ym, type);
  assertWithinDataRoot(dir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getAssistantCacheRoot(): string {
  const dir = path.join(DATA_ROOT, "cache", "assistant");
  assertWithinDataRoot(dir);
  return dir;
}

const MEANINGLESS_STEMS = new Set([
  "image", "screenshot", "img", "photo", "picture",
  "clipboard", "paste", "untitled",
]);

export function buildCacheFilename(originalName: string, ext: string): string {
  const stem = path.basename(originalName, path.extname(originalName));
  const uuid8 = crypto.randomUUID().replace(/-/g, "").slice(0, 8);

  const stemLower = stem.toLowerCase();
  const isMeaningless =
    !stem ||
    MEANINGLESS_STEMS.has(stemLower) ||
    /^screenshot[\s_\-]/i.test(stem);

  if (isMeaningless) {
    return `tower_image-${uuid8}${ext}`;
  }

  const sanitized = stem
    .replace(/[^\p{L}\p{N}]/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const safeStem = sanitized || "file";
  return `${safeStem}-${uuid8}${ext}`;
}

const CACHE_UUID_SUFFIX_RE = /-([0-9a-f]{8})(\.[^.]+)$/i;

/**
 * Strip the 8-hex UUID suffix added by buildCacheFilename.
 * e.g. "设计稿-a1b2c3d4.png" → "设计稿.png"
 *      "tower_image-a1b2c3d4.png" → "tower_image.png"
 *      "already-clean.png" → "already-clean.png" (no change)
 */
export function stripCacheUuidSuffix(filename: string): string {
  return filename.replace(CACHE_UUID_SUFFIX_RE, "$2");
}

/**
 * Returns true if the absolute filePath is inside the assistant cache root.
 * Used to gate UUID stripping — only strip for cache files.
 */
export function isAssistantCachePath(filePath: string): boolean {
  const root = getAssistantCacheRoot();
  return filePath.startsWith(root + path.sep);
}
