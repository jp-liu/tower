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

export function getAssistantCacheDir(): string {
  const dir = path.join(DATA_ROOT, "cache", "assistant");
  assertWithinDataRoot(dir);
  return dir;
}

export function ensureAssistantCacheDir(): string {
  const dir = getAssistantCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
