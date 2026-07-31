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
  mkdirSync(/* turbopackIgnore: true */ backupsDir, { recursive: true, mode: 0o700 });
  const lockPath = join(/* turbopackIgnore: true */ backupsDir, LOCK_FILE);
  if (existsSync(/* turbopackIgnore: true */ lockPath)) {
    const pid = parseInt(readFileSync(/* turbopackIgnore: true */ lockPath, "utf-8").trim(), 10);
    try { process.kill(pid, 0); throw new Error("Another backup operation is in progress"); }
    catch (e: unknown) { if (e instanceof Error && e.message.includes("Another backup")) throw e; }
    try { unlinkSync(/* turbopackIgnore: true */ lockPath); } catch { /* a concurrent owner will win the atomic create below */ }
  }
  try {
    const fd = openSync(/* turbopackIgnore: true */ lockPath, "wx", 0o600);
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
  const lockPath = join(/* turbopackIgnore: true */ backupsDir, LOCK_FILE);
  try { unlinkSync(/* turbopackIgnore: true */ lockPath); } catch { /* best-effort */ }
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
  const outPath = join(/* turbopackIgnore: true */ backupsDir, filename);
  mkdirSync(/* turbopackIgnore: true */ backupsDir, { recursive: true, mode: 0o700 });
  try { chmodSync(/* turbopackIgnore: true */ backupsDir, 0o700); } catch { /* non-POSIX filesystem */ }

  const metaPath = join(/* turbopackIgnore: true */ towerDir, "metadata.json");
  writeFileSync(/* turbopackIgnore: true */ metaPath, JSON.stringify(metadata, null, 2));

  try {
    const entries: string[] = ["metadata.json"];
    if (existsSync(join(/* turbopackIgnore: true */ towerDir, "database", "tower.db"))) entries.push(join("database", "tower.db"));
    if (existsSync(join(/* turbopackIgnore: true */ towerDir, "storage", "assets"))) entries.push(join("storage", "assets"));
    if (existsSync(join(/* turbopackIgnore: true */ towerDir, "assistant"))) entries.push("assistant");
    if (existsSync(join(/* turbopackIgnore: true */ towerDir, "ai"))) entries.push("ai");
    if (existsSync(join(/* turbopackIgnore: true */ towerDir, "extensions"))) entries.push("extensions");
    if (existsSync(join(/* turbopackIgnore: true */ towerDir, "logs"))) entries.push("logs");

    await tar.create(
      { gzip: true, file: outPath, cwd: towerDir },
      entries,
    );
    try { chmodSync(/* turbopackIgnore: true */ outPath, 0o600); } catch { /* non-POSIX filesystem */ }

    const st = statSync(/* turbopackIgnore: true */ outPath);
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
    try { unlinkSync(/* turbopackIgnore: true */ outPath); } catch { /* ignore */ }
    throw err;
  } finally {
    try { unlinkSync(/* turbopackIgnore: true */ metaPath); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Read metadata from archive
// ---------------------------------------------------------------------------
export async function readMetadataFromArchive(archivePath: string): Promise<BackupMetadata | null> {
  const tmpDir = join(/* turbopackIgnore: true */ dirname(archivePath), `_meta_tmp_${Date.now()}`);
  try {
    mkdirSync(/* turbopackIgnore: true */ tmpDir, { recursive: true });
    await tar.extract({
      file: archivePath,
      cwd: tmpDir,
      filter: (path) => path === "metadata.json",
    });
    const metaPath = join(/* turbopackIgnore: true */ tmpDir, "metadata.json");
    if (!existsSync(/* turbopackIgnore: true */ metaPath)) return null;
    return JSON.parse(readFileSync(/* turbopackIgnore: true */ metaPath, "utf-8"));
  } catch {
    return null;
  } finally {
    rmSync(/* turbopackIgnore: true */ tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// List archives
// ---------------------------------------------------------------------------
export async function listArchives(backupsDir: string): Promise<BackupInfo[]> {
  if (!existsSync(/* turbopackIgnore: true */ backupsDir)) return [];

  const files = readdirSync(/* turbopackIgnore: true */ backupsDir)
    .filter((f) => VALID_FILENAME.test(f))
    .sort()
    .reverse();

  const results: BackupInfo[] = [];
  for (const filename of files) {
    const filePath = join(/* turbopackIgnore: true */ backupsDir, filename);
    const st = statSync(/* turbopackIgnore: true */ filePath);
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
  mkdirSync(/* turbopackIgnore: true */ destDir, { recursive: true });

  await tar.extract({
    file: archivePath,
    cwd: destDir,
    filter: (path) => {
      if (isAbsolute(path) || path.includes("..")) return false;
      return true;
    },
  });

  if (!existsSync(join(/* turbopackIgnore: true */ destDir, "database", "tower.db"))) {
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
  if (!existsSync(/* turbopackIgnore: true */ registryPath)) return;
  const parsed = JSON.parse(readFileSync(/* turbopackIgnore: true */ registryPath, "utf8")) as unknown;
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
    if (!existsSync(/* turbopackIgnore: true */ restoredPath) || record.installPath === restoredPath) continue;
    record.installPath = restoredPath;
    changed = true;
  }
  if (changed) writeFileSync(/* turbopackIgnore: true */ registryPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

function rebasePluginRegistries(towerDir: string): void {
  rebaseRegistryFile(
    towerDir,
    join(/* turbopackIgnore: true */ towerDir, "ai", "plugins", "registry.v1.json"),
    (record) => {
      const packageDir = record.installPath.split(/[\\/]/).at(-1);
      return packageDir && packageDir !== "." && packageDir !== ".."
        ? join(/* turbopackIgnore: true */ towerDir, "ai", "plugins", "packages", packageDir)
        : null;
    },
  );
  rebaseRegistryFile(
    towerDir,
    join(/* turbopackIgnore: true */ towerDir, "extensions", "registry.v2.json"),
    (record) => {
      const packageDir = record.installPath.split(/[\\/]/).at(-1);
      if (!packageDir || packageDir === "." || packageDir === "..") return null;
      if (record.source === "catalog" || record.source === "npm") {
        return typeof record.id === "string"
          ? join(/* turbopackIgnore: true */ towerDir, "extensions", "cli-provider", record.id, packageDir)
          : null;
      }
      if (record.source === "legacy" || record.source === "local") {
        return join(/* turbopackIgnore: true */ towerDir, "ai", "plugins", "packages", packageDir);
      }
      return null;
    },
  );
}

export function swapDirs(towerDir: string, extractedDir: string): void {
  const oldTmp = join(/* turbopackIgnore: true */ towerDir, "_old_tmp");
  mkdirSync(/* turbopackIgnore: true */ oldTmp, { recursive: true });

  try {
    for (const rel of DIRS_TO_SWAP) {
      const src = join(/* turbopackIgnore: true */ towerDir, rel);
      const dst = join(/* turbopackIgnore: true */ oldTmp, rel);
      if (existsSync(/* turbopackIgnore: true */ src)) {
        mkdirSync(/* turbopackIgnore: true */ dirname(join(oldTmp, rel)), { recursive: true });
        renameSync(/* turbopackIgnore: true */ src, dst);
      }
    }

    for (const rel of DIRS_TO_SWAP) {
      const src = join(/* turbopackIgnore: true */ extractedDir, rel);
      const dst = join(/* turbopackIgnore: true */ towerDir, rel);
      if (existsSync(/* turbopackIgnore: true */ src)) {
        mkdirSync(/* turbopackIgnore: true */ dirname(join(towerDir, rel)), { recursive: true });
        renameSync(/* turbopackIgnore: true */ src, dst);
      }
    }

    rebasePluginRegistries(towerDir);

    rmSync(/* turbopackIgnore: true */ oldTmp, { recursive: true, force: true });
  } catch (err) {
    for (const rel of DIRS_TO_SWAP) {
      const src = join(/* turbopackIgnore: true */ oldTmp, rel);
      const dst = join(/* turbopackIgnore: true */ towerDir, rel);
      if (existsSync(/* turbopackIgnore: true */ src) && !existsSync(/* turbopackIgnore: true */ dst)) {
        try { renameSync(/* turbopackIgnore: true */ src, dst); } catch { /* best-effort */ }
      }
    }
    rmSync(/* turbopackIgnore: true */ oldTmp, { recursive: true, force: true });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Delete WAL/SHM files
// ---------------------------------------------------------------------------
export function deleteWalFiles(towerDir: string): void {
  const dbDir = join(/* turbopackIgnore: true */ towerDir, "database");
  for (const ext of ["-wal", "-shm"]) {
    const f = join(dbDir, `tower.db${ext}`);
    try { unlinkSync(/* turbopackIgnore: true */ f); } catch { /* doesn't exist */ }
  }
}

// ---------------------------------------------------------------------------
// Wipe data dirs (for reset)
// ---------------------------------------------------------------------------
export function wipeTowerData(towerDir: string): void {
  for (const rel of ["database", join("storage", "assets"), "assistant", "ai", "extensions", "logs"]) {
    const dir = join(/* turbopackIgnore: true */ towerDir, rel);
    if (existsSync(/* turbopackIgnore: true */ dir)) rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------
export function cleanupTempDirs(towerDir: string): void {
  for (const name of ["_restore_tmp", "_old_tmp"]) {
    const dir = join(/* turbopackIgnore: true */ towerDir, name);
    if (existsSync(/* turbopackIgnore: true */ dir)) rmSync(dir, { recursive: true, force: true });
  }
}
