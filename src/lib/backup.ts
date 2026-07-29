import { join, dirname, isAbsolute, relative } from "node:path";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, statSync, readdirSync, rmSync, renameSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as tar from "tar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface BackupMetadata {
  version: number;
  createdAt: string;
  towerVersion: string;
  autoBackup: boolean;
  label?: string;
  stats: { workspaces: number; projects: number; tasks: number };
  preview: { workspace: string; projects: string[] }[];
}

export interface BackupInfo {
  filename: string;
  size: number;
  createdAt: string;
  autoBackup: boolean;
  label: string;
  stats: BackupMetadata["stats"];
  preview: BackupMetadata["preview"];
}

// ---------------------------------------------------------------------------
// Lock helpers
// ---------------------------------------------------------------------------
const LOCK_FILE = ".lock";

export function acquireLock(backupsDir: string): void {
  mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  const lockPath = join(backupsDir, LOCK_FILE);
  if (existsSync(lockPath)) {
    const pid = parseInt(readFileSync(lockPath, "utf-8").trim(), 10);
    try { process.kill(pid, 0); throw new Error("Another backup operation is in progress"); }
    catch (e: unknown) { if (e instanceof Error && e.message.includes("Another backup")) throw e; }
    try { unlinkSync(lockPath); } catch { /* a concurrent owner will win the atomic create below */ }
  }
  try {
    const fd = openSync(lockPath, "wx", 0o600);
    try {
      writeFileSync(fd, String(process.pid));
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new Error("Another backup operation is in progress");
    }
    throw error;
  }
}

export function releaseLock(backupsDir: string): void {
  const lockPath = join(backupsDir, LOCK_FILE);
  try { unlinkSync(lockPath); } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------
function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${date}-${time}`;
}

export function backupFilename(auto: boolean): string {
  const prefix = auto ? "tower-auto" : "tower-backup";
  return `${prefix}-${timestamp()}.tar.gz`;
}

const VALID_FILENAME = /^tower-(backup|auto)-\d{8}-\d{6}\.tar\.gz$/;

export function validateFilename(filename: string): void {
  if (!VALID_FILENAME.test(filename)) {
    throw new Error(`Invalid backup filename: ${filename}`);
  }
}

// ---------------------------------------------------------------------------
// Backup dir validation
// ---------------------------------------------------------------------------
export function validateBackupDir(dir: string): void {
  if (!isAbsolute(dir)) throw new Error("Backup directory must be an absolute path");
  const home = homedir();
  const rel = relative(home, dir);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Backup directory must be within your home directory");
  }
}

// ---------------------------------------------------------------------------
// Create archive
// ---------------------------------------------------------------------------
export async function createArchive(
  towerDir: string,
  backupsDir: string,
  metadata: BackupMetadata,
  auto: boolean,
): Promise<BackupInfo> {
  const filename = backupFilename(auto);
  const outPath = join(backupsDir, filename);
  mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  try { chmodSync(backupsDir, 0o700); } catch { /* non-POSIX filesystem */ }

  const metaPath = join(towerDir, "metadata.json");
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  try {
    const entries: string[] = ["metadata.json"];
    if (existsSync(join(towerDir, "database", "tower.db"))) entries.push(join("database", "tower.db"));
    if (existsSync(join(towerDir, "storage", "assets"))) entries.push(join("storage", "assets"));
    if (existsSync(join(towerDir, "assistant"))) entries.push("assistant");
    if (existsSync(join(towerDir, "ai"))) entries.push("ai");
    if (existsSync(join(towerDir, "extensions"))) entries.push("extensions");
    if (existsSync(join(towerDir, "logs"))) entries.push("logs");

    await tar.create(
      { gzip: true, file: outPath, cwd: towerDir },
      entries,
    );
    try { chmodSync(outPath, 0o600); } catch { /* non-POSIX filesystem */ }

    const st = statSync(outPath);
    return {
      filename,
      size: st.size,
      createdAt: metadata.createdAt,
      autoBackup: auto,
      label: metadata.label ?? "",
      stats: metadata.stats,
      preview: metadata.preview,
    };
  } catch (err) {
    try { unlinkSync(outPath); } catch { /* ignore */ }
    throw err;
  } finally {
    try { unlinkSync(metaPath); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Read metadata from archive
// ---------------------------------------------------------------------------
export async function readMetadataFromArchive(archivePath: string): Promise<BackupMetadata | null> {
  const tmpDir = join(dirname(archivePath), `_meta_tmp_${Date.now()}`);
  try {
    mkdirSync(tmpDir, { recursive: true });
    await tar.extract({
      file: archivePath,
      cwd: tmpDir,
      filter: (path) => path === "metadata.json",
    });
    const metaPath = join(tmpDir, "metadata.json");
    if (!existsSync(metaPath)) return null;
    return JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch {
    return null;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// List archives
// ---------------------------------------------------------------------------
export async function listArchives(backupsDir: string): Promise<BackupInfo[]> {
  if (!existsSync(backupsDir)) return [];

  const files = readdirSync(backupsDir)
    .filter((f) => VALID_FILENAME.test(f))
    .sort()
    .reverse();

  const results: BackupInfo[] = [];
  for (const filename of files) {
    const filePath = join(backupsDir, filename);
    const st = statSync(filePath);
    const meta = await readMetadataFromArchive(filePath);
    results.push({
      filename,
      size: st.size,
      createdAt: meta?.createdAt ?? st.mtime.toISOString(),
      autoBackup: meta?.autoBackup ?? filename.startsWith("tower-auto"),
      label: meta?.label ?? "",
      stats: meta?.stats ?? { workspaces: 0, projects: 0, tasks: 0 },
      preview: meta?.preview ?? [],
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Extract archive to temp dir (with path safety validation)
// ---------------------------------------------------------------------------
export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true });

  await tar.extract({
    file: archivePath,
    cwd: destDir,
    filter: (path) => {
      if (isAbsolute(path) || path.includes("..")) return false;
      return true;
    },
  });

  if (!existsSync(join(destDir, "database", "tower.db"))) {
    throw new Error("Invalid archive: missing database/tower.db");
  }
}

// ---------------------------------------------------------------------------
// Atomic swap: current → _old_tmp, extracted → current
// ---------------------------------------------------------------------------
const DIRS_TO_SWAP = ["database", join("storage", "assets"), "assistant", "ai", "extensions", "logs"] as const;

function rebaseRegistryFile(
  towerDir: string,
  registryPath: string,
  installPathFor: (record: { id?: unknown; source?: unknown; installPath: string }) => string | null,
): void {
  if (!existsSync(registryPath)) return;
  const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  const plugins = (parsed as { plugins?: unknown }).plugins;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) return;

  let changed = false;
  for (const registration of Object.values(plugins as Record<string, unknown>)) {
    if (!registration || typeof registration !== "object" || Array.isArray(registration)) continue;
    const record = registration as { id?: unknown; source?: unknown; installPath?: unknown };
    if (typeof record.installPath !== "string") continue;
    const restoredPath = installPathFor({ ...record, installPath: record.installPath });
    if (!restoredPath) continue;
    if (!existsSync(restoredPath) || record.installPath === restoredPath) continue;
    record.installPath = restoredPath;
    changed = true;
  }
  if (changed) writeFileSync(registryPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

function rebasePluginRegistries(towerDir: string): void {
  rebaseRegistryFile(
    towerDir,
    join(towerDir, "ai", "plugins", "registry.v1.json"),
    (record) => {
      const packageDir = record.installPath.split(/[\\/]/).at(-1);
      return packageDir && packageDir !== "." && packageDir !== ".."
        ? join(towerDir, "ai", "plugins", "packages", packageDir)
        : null;
    },
  );
  rebaseRegistryFile(
    towerDir,
    join(towerDir, "extensions", "registry.v2.json"),
    (record) => {
      const packageDir = record.installPath.split(/[\\/]/).at(-1);
      if (!packageDir || packageDir === "." || packageDir === "..") return null;
      if (record.source === "catalog" || record.source === "npm") {
        return typeof record.id === "string"
          ? join(towerDir, "extensions", "cli-provider", record.id, packageDir)
          : null;
      }
      if (record.source === "legacy" || record.source === "local") {
        return join(towerDir, "ai", "plugins", "packages", packageDir);
      }
      return null;
    },
  );
}

export function swapDirs(towerDir: string, extractedDir: string): void {
  const oldTmp = join(towerDir, "_old_tmp");
  mkdirSync(oldTmp, { recursive: true });

  try {
    for (const rel of DIRS_TO_SWAP) {
      const src = join(towerDir, rel);
      const dst = join(oldTmp, rel);
      if (existsSync(src)) {
        mkdirSync(dirname(join(oldTmp, rel)), { recursive: true });
        renameSync(src, dst);
      }
    }

    for (const rel of DIRS_TO_SWAP) {
      const src = join(extractedDir, rel);
      const dst = join(towerDir, rel);
      if (existsSync(src)) {
        mkdirSync(dirname(join(towerDir, rel)), { recursive: true });
        renameSync(src, dst);
      }
    }

    rebasePluginRegistries(towerDir);

    rmSync(oldTmp, { recursive: true, force: true });
  } catch (err) {
    for (const rel of DIRS_TO_SWAP) {
      const src = join(oldTmp, rel);
      const dst = join(towerDir, rel);
      if (existsSync(src) && !existsSync(dst)) {
        try { renameSync(src, dst); } catch { /* best-effort */ }
      }
    }
    rmSync(oldTmp, { recursive: true, force: true });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Delete WAL/SHM files
// ---------------------------------------------------------------------------
export function deleteWalFiles(towerDir: string): void {
  const dbDir = join(towerDir, "database");
  for (const ext of ["-wal", "-shm"]) {
    const f = join(dbDir, `tower.db${ext}`);
    try { unlinkSync(f); } catch { /* doesn't exist */ }
  }
}

// ---------------------------------------------------------------------------
// Wipe data dirs (for reset)
// ---------------------------------------------------------------------------
export function wipeTowerData(towerDir: string): void {
  for (const rel of ["database", join("storage", "assets"), "assistant", "ai", "extensions", "logs"]) {
    const dir = join(towerDir, rel);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------
export function cleanupTempDirs(towerDir: string): void {
  for (const name of ["_restore_tmp", "_old_tmp"]) {
    const dir = join(towerDir, name);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}
