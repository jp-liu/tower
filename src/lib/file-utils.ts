import * as fs from "node:fs";
import * as path from "node:path";

const DATA_ROOT = path.join(process.cwd(), "data");

export function getAssetsDir(projectId: string): string {
  return path.join(DATA_ROOT, "assets", projectId);
}

export function getCacheDir(taskId: string): string {
  return path.join(DATA_ROOT, "cache", taskId);
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
