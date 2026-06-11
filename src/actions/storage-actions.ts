"use server";

import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  getStorageDir,
  getDefaultStorageDir,
  readStoragePointer,
  writeStoragePointer,
} from "@/lib/tower-dir";

export interface StorageLocation {
  /** Currently effective storage directory. */
  current: string;
  /** Default location inside the Tower data dir. */
  default: string;
  /** True when running on the default (no override configured). */
  isDefault: boolean;
}

/** Report the current storage location for the Settings UI. */
export async function getStorageLocation(): Promise<StorageLocation> {
  const current = getStorageDir();
  const def = getDefaultStorageDir();
  return {
    current,
    default: def,
    isDefault: readStoragePointer() === null,
  };
}

const setSchema = z.object({
  newPath: z.string().min(1),
});

export interface SetStorageResult {
  ok: boolean;
  moved?: number;
  error?: string;
}

/**
 * Relocate the storage directory (assets + cache) to `newPath`, migrating
 * existing files and rewriting the absolute paths persisted on ProjectAsset.
 *
 * Cross-volume safe (copy + delete, since rename fails across drives — the
 * whole point here is moving off a full C: drive). Takes effect immediately:
 * getStorageDir() reads the pointer fresh, so no restart is needed.
 *
 * Pass the default location (or the current one) to reset back to ~/.tower.
 */
export async function setStorageLocation(input: { newPath: string }): Promise<SetStorageResult> {
  const { newPath } = setSchema.parse(input);
  const target = path.resolve(newPath);
  const oldDir = path.resolve(getStorageDir());
  const def = path.resolve(getDefaultStorageDir());

  if (!path.isAbsolute(target)) {
    return { ok: false, error: "请输入绝对路径" };
  }
  if (target === oldDir) {
    return { ok: true, moved: 0 };
  }
  // Reject nesting in either direction — moving a dir into itself corrupts it.
  const withSep = (p: string) => p + path.sep;
  if (target.startsWith(withSep(oldDir)) || oldDir.startsWith(withSep(target))) {
    return { ok: false, error: "新路径不能是当前存储目录的父级或子级" };
  }

  // Target must be empty or non-existent — never clobber unrelated data.
  if (fs.existsSync(target)) {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
      return { ok: false, error: "目标路径已存在且不是目录" };
    }
    if (fs.readdirSync(target).length > 0) {
      return { ok: false, error: "目标目录非空，请选择一个空目录或新目录" };
    }
  }

  // Verify the parent is writable before touching anything.
  const parent = path.dirname(target);
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.accessSync(target, fs.constants.W_OK);
  } catch {
    return { ok: false, error: `无法写入目标目录（检查权限）：${parent}` };
  }

  // 1) Move existing files. cpSync handles cross-volume; then drop the source.
  try {
    if (fs.existsSync(oldDir)) {
      fs.cpSync(oldDir, target, { recursive: true });
      fs.rmSync(oldDir, { recursive: true, force: true });
    }
  } catch (e) {
    return { ok: false, error: `迁移文件失败：${e instanceof Error ? e.message : String(e)}` };
  }

  // 2) Rewrite absolute paths persisted on ProjectAsset (assets/<id>/<file>).
  //    Everything else (cache, assistant images) is reconstructed from the
  //    storage root at runtime, so it needs no DB rewrite.
  let moved = 0;
  const prefix = oldDir + path.sep;
  const rows = await db.projectAsset.findMany({ select: { id: true, path: true } });
  for (const row of rows) {
    if (row.path.startsWith(prefix)) {
      const rewritten = path.join(target, row.path.slice(oldDir.length + 1));
      await db.projectAsset.update({ where: { id: row.id }, data: { path: rewritten } });
      moved += 1;
    }
  }

  // 3) Record the override last — now getStorageDir() resolves to `target`.
  //    Writing the default path clears the override entirely.
  writeStoragePointer(target === def ? null : target);

  return { ok: true, moved };
}
