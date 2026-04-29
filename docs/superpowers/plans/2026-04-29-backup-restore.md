# Backup & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Data Management tab to Settings with full-site backup/restore, archive deletion, and system reset.

**Architecture:** Server actions in `backup-actions.ts` handle all I/O (tar pack/extract, file ops, DB reconnect). A dedicated `BackupSection` client component renders the UI inside the existing settings page. Lock file prevents concurrent operations.

**Tech Stack:** Node.js `tar` (npm), built-in `zlib`/`fs`/`path`, Prisma raw queries for WAL checkpoint + FTS rebuild, existing tower-dir.ts path helpers.

**Spec:** `docs/superpowers/specs/2026-04-29-backup-restore-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/backup.ts` | Core backup/restore engine (tar pack, extract, lock, metadata, validation) |
| Create | `src/actions/backup-actions.ts` | Server actions wrapping the engine (createBackup, listBackups, restoreBackup, deleteBackup, resetSystem, get/setBackupDir) |
| Create | `src/components/settings/backup-section.tsx` | Data Management tab UI (backup list, create, restore, delete, reset dialog) |
| Modify | `src/components/settings/settings-page.tsx` | Add 6th tab entry to SECTIONS, route to BackupSection |
| Modify | `src/lib/tower-dir.ts` | Add `getBackupsDir()` helper |
| Modify | `src/lib/db.ts` | Export `resetDbConnection()` to reset initialized flag + reconnect |
| Modify | `src/lib/i18n/zh.ts` | Add `settings.backup.*` keys |
| Modify | `src/lib/i18n/en.ts` | Add `settings.backup.*` keys |
| Modify | `package.json` | Add `tar` dependency |

---

### Task 1: Install `tar` dependency and add path helper

**Files:**
- Modify: `package.json`
- Modify: `src/lib/tower-dir.ts:26-69`

- [ ] **Step 1: Install tar**

```bash
pnpm add tar
```

- [ ] **Step 2: Add `getBackupsDir()` to tower-dir.ts**

Add after the `getLogsDir()` function (line 69):

```typescript
/** ~/.tower/backups */
export function getBackupsDir(): string {
  const dir = join(getTowerDir(), "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/tower-dir.ts
git commit -m "chore: add tar dependency and getBackupsDir helper"
```

---

### Task 2: Add `resetDbConnection()` to db.ts

**Files:**
- Modify: `src/lib/db.ts:15-24`

- [ ] **Step 1: Add resetDbConnection function**

Add after `initDb()` (line 24):

```typescript
/**
 * Reset the database connection after a DB file swap (restore/reset).
 * Disconnects, resets the initialized flag, and re-runs PRAGMAs.
 */
export async function resetDbConnection(): Promise<void> {
  try { await db.$disconnect(); } catch { /* best-effort */ }
  initialized = false;
  await initDb();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(backup): add resetDbConnection for DB file swap"
```

---

### Task 3: Create backup engine (`src/lib/backup.ts`)

This is the core module with all backup/restore logic. No Next.js imports — pure Node.js so it can be tested independently.

**Files:**
- Create: `src/lib/backup.ts`

- [ ] **Step 1: Create the backup engine with types and lock helpers**

```typescript
import { join, dirname, isAbsolute, relative } from "node:path";
import { existsSync, mkdirSync, statSync, readdirSync, rmSync, renameSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
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
  stats: { workspaces: number; projects: number; tasks: number };
  preview: { workspace: string; projects: string[] }[];
}

export interface BackupInfo {
  filename: string;
  size: number;
  createdAt: string;
  autoBackup: boolean;
  stats: BackupMetadata["stats"];
  preview: BackupMetadata["preview"];
}

// ---------------------------------------------------------------------------
// Lock helpers
// ---------------------------------------------------------------------------
const LOCK_FILE = ".lock";

export function acquireLock(backupsDir: string): void {
  const lockPath = join(backupsDir, LOCK_FILE);
  if (existsSync(lockPath)) {
    const pid = parseInt(readFileSync(lockPath, "utf-8").trim(), 10);
    // Check if process is still alive
    try { process.kill(pid, 0); throw new Error("Another backup operation is in progress"); }
    catch (e: unknown) { if (e instanceof Error && e.message.includes("Another backup")) throw e; }
    // Stale lock — remove it
  }
  writeFileSync(lockPath, String(process.pid));
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
```

- [ ] **Step 2: Add createArchive function**

Append to `src/lib/backup.ts`:

```typescript
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

  // Write metadata.json temporarily
  const metaPath = join(towerDir, "metadata.json");
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  try {
    // Collect entries to pack (relative to towerDir)
    const entries: string[] = ["metadata.json"];
    if (existsSync(join(towerDir, "database", "tower.db"))) entries.push(join("database", "tower.db"));
    if (existsSync(join(towerDir, "storage", "assets"))) entries.push(join("storage", "assets"));
    if (existsSync(join(towerDir, "assistant"))) entries.push("assistant");
    if (existsSync(join(towerDir, "logs"))) entries.push("logs");

    await tar.create(
      { gzip: true, file: outPath, cwd: towerDir },
      entries,
    );

    const st = statSync(outPath);
    return {
      filename,
      size: st.size,
      createdAt: metadata.createdAt,
      autoBackup: auto,
      stats: metadata.stats,
      preview: metadata.preview,
    };
  } catch (err) {
    // Clean up partial file
    try { unlinkSync(outPath); } catch { /* ignore */ }
    throw err;
  } finally {
    try { unlinkSync(metaPath); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 3: Add readMetadataFromArchive and listArchives functions**

Append to `src/lib/backup.ts`:

```typescript
// ---------------------------------------------------------------------------
// Read metadata from archive (streaming — no full decompress)
// ---------------------------------------------------------------------------
export async function readMetadataFromArchive(archivePath: string): Promise<BackupMetadata | null> {
  // Extract metadata.json to a temp location, read it, then clean up
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
    .reverse(); // newest first

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
      stats: meta?.stats ?? { workspaces: 0, projects: 0, tasks: 0 },
      preview: meta?.preview ?? [],
    });
  }
  return results;
}
```

- [ ] **Step 4: Add extractArchive and swapDirs functions**

Append to `src/lib/backup.ts`:

```typescript
// ---------------------------------------------------------------------------
// Extract archive to temp dir (with path safety validation)
// ---------------------------------------------------------------------------
export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true });

  await tar.extract({
    file: archivePath,
    cwd: destDir,
    filter: (path) => {
      // Reject absolute paths and path traversal
      if (isAbsolute(path) || path.includes("..")) return false;
      return true;
    },
  });

  // Validate the extracted database file exists
  if (!existsSync(join(destDir, "database", "tower.db"))) {
    throw new Error("Invalid archive: missing database/tower.db");
  }
}

// ---------------------------------------------------------------------------
// Atomic swap: current → _old_tmp, extracted → current
// ---------------------------------------------------------------------------
const DIRS_TO_SWAP = ["database", join("storage", "assets"), "assistant", "logs"] as const;

export function swapDirs(towerDir: string, extractedDir: string): void {
  const oldTmp = join(towerDir, "_old_tmp");
  mkdirSync(oldTmp, { recursive: true });

  try {
    // Move current dirs to _old_tmp
    for (const rel of DIRS_TO_SWAP) {
      const src = join(towerDir, rel);
      const dst = join(oldTmp, rel);
      if (existsSync(src)) {
        mkdirSync(dirname(join(oldTmp, rel)), { recursive: true });
        renameSync(src, dst);
      }
    }

    // Move extracted dirs into place
    for (const rel of DIRS_TO_SWAP) {
      const src = join(extractedDir, rel);
      const dst = join(towerDir, rel);
      if (existsSync(src)) {
        mkdirSync(dirname(join(towerDir, rel)), { recursive: true });
        renameSync(src, dst);
      }
    }

    // Success — clean up old data
    rmSync(oldTmp, { recursive: true, force: true });
  } catch (err) {
    // Rollback: move _old_tmp back
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
  for (const rel of ["database", join("storage", "assets"), "assistant", "logs"]) {
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
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/backup.ts
git commit -m "feat(backup): create backup engine with tar pack/extract/lock/swap"
```

---

### Task 4: Create server actions (`src/actions/backup-actions.ts`)

**Files:**
- Create: `src/actions/backup-actions.ts`

- [ ] **Step 1: Create the server actions file**

```typescript
"use server";

import { db, resetDbConnection } from "@/lib/db";
import { getTowerDir, getTowerDbPath, getBackupsDir } from "@/lib/tower-dir";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";
import {
  acquireLock, releaseLock, createArchive, listArchives,
  extractArchive, swapDirs, deleteWalFiles, wipeTowerData,
  cleanupTempDirs, validateFilename, validateBackupDir,
  type BackupInfo, type BackupMetadata,
} from "@/lib/backup";
import { join } from "node:path";
import { existsSync, unlinkSync, statSync } from "node:fs";
import { revalidatePath } from "next/cache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read package.json version at runtime */
function getTowerVersion(): string {
  try {
    const pkg = require("../../package.json");
    return pkg.version ?? "unknown";
  } catch { return "unknown"; }
}

async function getResolvedBackupsDir(): Promise<string> {
  const custom = await getConfigValue("system.backupDir", "");
  return custom || getBackupsDir();
}

async function buildMetadata(auto: boolean): Promise<BackupMetadata> {
  const [wsCount, projCount, taskCount] = await Promise.all([
    db.workspace.count(),
    db.project.count(),
    db.task.count(),
  ]);

  // Preview: up to 3 workspaces, each with up to 3 project names
  const workspaces = await db.workspace.findMany({
    take: 3,
    orderBy: { updatedAt: "desc" },
    select: {
      name: true,
      description: true,
      projects: { take: 3, select: { name: true }, orderBy: { updatedAt: "desc" } },
    },
  });

  const preview = workspaces.map((ws) => {
    // Use description (emoji icon) + name if available
    const icon = ws.description ?? "";
    const label = icon ? `${icon} ${ws.name}` : ws.name;
    return {
      workspace: label,
      projects: ws.projects.map((p) => p.name),
    };
  });

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    towerVersion: getTowerVersion(),
    autoBackup: auto,
    stats: { workspaces: wsCount, projects: projCount, tasks: taskCount },
    preview,
  };
}

// ---------------------------------------------------------------------------
// Public server actions
// ---------------------------------------------------------------------------

export async function createBackup(): Promise<BackupInfo> {
  const backupsDir = await getResolvedBackupsDir();
  acquireLock(backupsDir);
  try {
    const metadata = await buildMetadata(false);
    // WAL checkpoint
    await db.$queryRaw`PRAGMA wal_checkpoint(TRUNCATE)`;
    return await createArchive(getTowerDir(), backupsDir, metadata, false);
  } finally {
    releaseLock(backupsDir);
  }
}

export async function listBackupFiles(): Promise<BackupInfo[]> {
  const backupsDir = await getResolvedBackupsDir();
  return listArchives(backupsDir);
}

export async function deleteBackupFile(filename: string): Promise<void> {
  validateFilename(filename);
  const backupsDir = await getResolvedBackupsDir();
  const filePath = join(backupsDir, filename);
  if (!existsSync(filePath)) throw new Error("Backup file not found");
  unlinkSync(filePath);
}

export async function restoreBackup(filename: string): Promise<void> {
  validateFilename(filename);
  const towerDir = getTowerDir();
  const backupsDir = await getResolvedBackupsDir();
  const archivePath = join(backupsDir, filename);
  if (!existsSync(archivePath)) throw new Error("Backup file not found");

  acquireLock(backupsDir);
  const restoreTmp = join(towerDir, "_restore_tmp");
  try {
    // 1. Auto-backup current state
    const autoMeta = await buildMetadata(true);
    await db.$queryRaw`PRAGMA wal_checkpoint(TRUNCATE)`;
    await createArchive(towerDir, backupsDir, autoMeta, true);

    // 2. Stop PTY sessions
    const { destroyAllSessions } = await import("@/lib/pty/session-store");
    destroyAllSessions();

    // 3. Extract to temp dir
    await extractArchive(archivePath, restoreTmp);

    // 4. Disconnect DB
    await db.$disconnect();

    // 5. Delete stale WAL/SHM
    deleteWalFiles(towerDir);

    // 6. Atomic swap
    swapDirs(towerDir, restoreTmp);

    // 7. Reconnect DB
    await resetDbConnection();

    // 8. Rebuild FTS — create virtual table then re-sync all notes
    await db.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
      USING fts5(note_id UNINDEXED, title, content, tokenize='trigram case_sensitive 0')
    `);
    const { syncNoteToFts } = await import("@/lib/fts");
    const allNotes = await db.projectNote.findMany({ select: { id: true, title: true, content: true } });
    for (const note of allNotes) {
      await syncNoteToFts(db, note);
    }

    revalidatePath("/");
  } finally {
    cleanupTempDirs(towerDir);
    releaseLock(backupsDir);
  }
}

export async function resetSystem(confirmation: string): Promise<void> {
  if (confirmation !== "RESET") throw new Error("Invalid confirmation");

  const towerDir = getTowerDir();
  const backupsDir = await getResolvedBackupsDir();

  acquireLock(backupsDir);
  try {
    // 1. Auto-backup
    const autoMeta = await buildMetadata(true);
    await db.$queryRaw`PRAGMA wal_checkpoint(TRUNCATE)`;
    await createArchive(towerDir, backupsDir, autoMeta, true);

    // 2. Stop PTY sessions
    const { destroyAllSessions } = await import("@/lib/pty/session-store");
    destroyAllSessions();

    // 3. Disconnect DB
    await db.$disconnect();

    // 4. Wipe data
    wipeTowerData(towerDir);

    // 5. Reconnect (creates fresh DB)
    await resetDbConnection();

    revalidatePath("/");
  } finally {
    releaseLock(backupsDir);
  }
}

export async function getBackupDir(): Promise<string> {
  const custom = await getConfigValue("system.backupDir", "");
  return custom || getBackupsDir();
}

export async function setBackupDir(dir: string): Promise<void> {
  validateBackupDir(dir);
  await setConfigValue("system.backupDir", dir);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/actions/backup-actions.ts
git commit -m "feat(backup): add server actions for backup/restore/reset"
```

---

### Task 5: Add i18n keys

**Files:**
- Modify: `src/lib/i18n/zh.ts`
- Modify: `src/lib/i18n/en.ts`

- [ ] **Step 1: Add zh keys**

Add after the last `settings.notifications.*` key (around line 696):

```typescript
  // Backup & Restore
  "settings.backup.title": "数据管理",
  "settings.backup.desc": "备份、恢复与重置",
  "settings.backup.navDesc": "数据备份、恢复存档、重置系统",
  "settings.backup.sectionTitle": "备份与恢复",
  "settings.backup.dir": "存档路径",
  "settings.backup.dirChange": "修改",
  "settings.backup.dirPlaceholder": "输入绝对路径",
  "settings.backup.dirSaved": "存档路径已更新",
  "settings.backup.dirError": "路径无效，必须是主目录下的绝对路径",
  "settings.backup.create": "创建存档",
  "settings.backup.creating": "正在创建存档...",
  "settings.backup.createSuccess": "存档创建成功",
  "settings.backup.createError": "创建存档失败",
  "settings.backup.restore": "恢复",
  "settings.backup.restoring": "正在恢复数据...",
  "settings.backup.restoreConfirm": "确认从此存档恢复？当前数据会先自动备份。",
  "settings.backup.restoreSuccess": "数据已恢复，请刷新页面",
  "settings.backup.restoreError": "恢复失败",
  "settings.backup.delete": "删除",
  "settings.backup.deleteConfirm": "确认删除此存档？此操作不可撤销。",
  "settings.backup.deleteSuccess": "存档已删除",
  "settings.backup.deleteError": "删除失败",
  "settings.backup.empty": "暂无存档",
  "settings.backup.emptyDesc": "点击「创建存档」备份当前数据",
  "settings.backup.autoLabel": "自动备份",
  "settings.backup.projects": "{count} 个项目",
  "settings.backup.tasks": "{count} 个任务",
  "settings.backup.workspaces": "等 {count} 个工作区",
  "settings.backup.reloadRequired": "请刷新页面以加载恢复的数据",
  "settings.backup.reload": "立即刷新",
  "settings.backup.dangerZone": "危险操作",
  "settings.backup.resetDesc": "重置将清空所有数据（数据库、资源、配置），仅保留存档文件。重置前会自动创建一份存档。",
  "settings.backup.reset": "重置系统",
  "settings.backup.resetConfirmTitle": "确认重置系统？",
  "settings.backup.resetConfirmDesc": "此操作不可撤销。所有数据将被清空，仅保留存档。",
  "settings.backup.resetConfirmInput": "输入 RESET 确认",
  "settings.backup.resetting": "正在重置系统...",
  "settings.backup.resetSuccess": "系统已重置",
  "settings.backup.resetError": "重置失败",
  "settings.backup.operationInProgress": "有其他备份操作正在进行",
```

- [ ] **Step 2: Add en keys**

Add the corresponding English translations in `en.ts`:

```typescript
  "settings.backup.title": "Data Management",
  "settings.backup.desc": "Backup, restore & reset",
  "settings.backup.navDesc": "Backup data, restore archives, reset system",
  "settings.backup.sectionTitle": "Backup & Restore",
  "settings.backup.dir": "Backup directory",
  "settings.backup.dirChange": "Change",
  "settings.backup.dirPlaceholder": "Enter absolute path",
  "settings.backup.dirSaved": "Backup directory updated",
  "settings.backup.dirError": "Invalid path, must be an absolute path within home directory",
  "settings.backup.create": "Create Backup",
  "settings.backup.creating": "Creating backup...",
  "settings.backup.createSuccess": "Backup created successfully",
  "settings.backup.createError": "Failed to create backup",
  "settings.backup.restore": "Restore",
  "settings.backup.restoring": "Restoring data...",
  "settings.backup.restoreConfirm": "Restore from this archive? Current data will be auto-backed up first.",
  "settings.backup.restoreSuccess": "Data restored. Please reload the page.",
  "settings.backup.restoreError": "Restore failed",
  "settings.backup.delete": "Delete",
  "settings.backup.deleteConfirm": "Delete this archive? This cannot be undone.",
  "settings.backup.deleteSuccess": "Backup deleted",
  "settings.backup.deleteError": "Delete failed",
  "settings.backup.empty": "No backups yet",
  "settings.backup.emptyDesc": "Click \"Create Backup\" to back up current data",
  "settings.backup.autoLabel": "Auto backup",
  "settings.backup.projects": "{count} projects",
  "settings.backup.tasks": "{count} tasks",
  "settings.backup.workspaces": "{count} workspaces total",
  "settings.backup.reloadRequired": "Please reload to apply restored data",
  "settings.backup.reload": "Reload Now",
  "settings.backup.dangerZone": "Danger Zone",
  "settings.backup.resetDesc": "Reset clears all data (database, assets, config), keeping only backup archives. A backup is created automatically before reset.",
  "settings.backup.reset": "Reset System",
  "settings.backup.resetConfirmTitle": "Confirm System Reset?",
  "settings.backup.resetConfirmDesc": "This cannot be undone. All data will be erased, only archives are kept.",
  "settings.backup.resetConfirmInput": "Type RESET to confirm",
  "settings.backup.resetting": "Resetting system...",
  "settings.backup.resetSuccess": "System has been reset",
  "settings.backup.resetError": "Reset failed",
  "settings.backup.operationInProgress": "Another backup operation is in progress",
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n/zh.ts src/lib/i18n/en.ts
git commit -m "feat(backup): add i18n keys for backup/restore/reset"
```

---

### Task 6: Create `BackupSection` UI component

**Files:**
- Create: `src/components/settings/backup-section.tsx`

- [ ] **Step 1: Create the component file**

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Download,
  Upload,
  Trash2,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Archive,
} from "lucide-react";
import { toast } from "sonner";
import {
  createBackup,
  listBackupFiles,
  deleteBackupFile,
  restoreBackup,
  resetSystem,
  getBackupDir,
  setBackupDir,
} from "@/actions/backup-actions";
import type { BackupInfo } from "@/lib/backup";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string, loc: string): string {
  const l = loc === "zh" ? "zh-CN" : "en-US";
  return new Date(iso).toLocaleString(l, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BackupSection() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupDir, setBackupDirState] = useState("");
  const [editingDir, setEditingDir] = useState(false);
  const [dirInput, setDirInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState<string | null>(null); // "create" | "restore" | "reset" | null

  // Reset dialog
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetInput, setResetInput] = useState("");

  // Load backup list and dir
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [list, dir] = await Promise.all([listBackupFiles(), getBackupDir()]);
      setBackups(list);
      setBackupDirState(dir);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    setOperating("create");
    try {
      await createBackup();
      toast.success(t("settings.backup.createSuccess"));
      await loadData();
    } catch (err) {
      toast.error(t("settings.backup.createError"));
    } finally {
      setOperating(null);
    }
  };

  const handleRestore = async (filename: string) => {
    if (!confirm(t("settings.backup.restoreConfirm"))) return;
    setOperating("restore");
    try {
      await restoreBackup(filename);
      toast.success(t("settings.backup.restoreSuccess"), {
        action: {
          label: t("settings.backup.reload"),
          onClick: () => window.location.reload(),
        },
        duration: 15000,
      });
      await loadData();
    } catch (err) {
      toast.error(t("settings.backup.restoreError"));
    } finally {
      setOperating(null);
    }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm(t("settings.backup.deleteConfirm"))) return;
    try {
      await deleteBackupFile(filename);
      toast.success(t("settings.backup.deleteSuccess"));
      setBackups((prev) => prev.filter((b) => b.filename !== filename));
    } catch {
      toast.error(t("settings.backup.deleteError"));
    }
  };

  const handleSaveDir = async () => {
    try {
      await setBackupDir(dirInput);
      setBackupDirState(dirInput);
      setEditingDir(false);
      toast.success(t("settings.backup.dirSaved"));
      await loadData();
    } catch {
      toast.error(t("settings.backup.dirError"));
    }
  };

  const handleReset = async () => {
    if (resetInput !== "RESET") return;
    setShowResetDialog(false);
    setResetInput("");
    setOperating("reset");
    try {
      await resetSystem("RESET");
      toast.success(t("settings.backup.resetSuccess"));
      router.push("/");
    } catch {
      toast.error(t("settings.backup.resetError"));
    } finally {
      setOperating(null);
    }
  };

  const isDisabled = operating !== null;

  return (
    <div className="space-y-6">
      {/* Full-screen overlay during restore/reset */}
      {(operating === "restore" || operating === "reset") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {operating === "restore" ? t("settings.backup.restoring") : t("settings.backup.resetting")}
            </p>
          </div>
        </div>
      )}

      {/* Section title + backup dir */}
      <div>
        <h3 className="text-base font-semibold">{t("settings.backup.sectionTitle")}</h3>
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span>{t("settings.backup.dir")}:</span>
          {editingDir ? (
            <>
              <Input
                value={dirInput}
                onChange={(e) => setDirInput(e.target.value)}
                placeholder={t("settings.backup.dirPlaceholder")}
                className="h-8 w-64"
              />
              <Button variant="outline" size="sm" onClick={handleSaveDir}>
                {t("common.save")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditingDir(false)}>
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <>
              <code className="rounded bg-muted px-2 py-0.5 text-xs">{backupDir}</code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setDirInput(backupDir); setEditingDir(true); }}
                className="text-xs text-muted-foreground"
              >
                {t("settings.backup.dirChange")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Create backup button */}
      <Button
        onClick={handleCreate}
        disabled={isDisabled}
        className="gap-2"
      >
        {operating === "create" ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> {t("settings.backup.creating")}</>
        ) : (
          <><Download className="h-4 w-4" /> {t("settings.backup.create")}</>
        )}
      </Button>

      {/* Backup list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : backups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Archive className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t("settings.backup.empty")}</p>
          <p className="text-xs text-muted-foreground/60">{t("settings.backup.emptyDesc")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {backups.map((backup) => (
            <div
              key={backup.filename}
              className="group rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/30"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium font-mono text-foreground">
                      {backup.filename}
                    </span>
                    {backup.autoBackup && (
                      <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500 ring-1 ring-amber-500/20">
                        {t("settings.backup.autoLabel")}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatBytes(backup.size)} · {formatDate(backup.createdAt, locale)}
                  </div>
                  {/* Preview */}
                  {backup.preview.length > 0 && (
                    <div className="mt-1.5 text-xs text-muted-foreground">
                      {backup.preview.map((p, i) => (
                        <span key={i}>
                          {i > 0 && " "}
                          {p.workspace}({p.projects.join(", ")})
                        </span>
                      ))}
                      {backup.stats.workspaces > backup.preview.length && (
                        <span> {t("settings.backup.workspaces", { count: String(backup.stats.workspaces) })}</span>
                      )}
                    </div>
                  )}
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("settings.backup.projects", { count: String(backup.stats.projects) })}
                    {" · "}
                    {t("settings.backup.tasks", { count: String(backup.stats.tasks) })}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleRestore(backup.filename)}
                    disabled={isDisabled}
                    title={t("settings.backup.restore")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDelete(backup.filename)}
                    disabled={isDisabled}
                    title={t("settings.backup.delete")}
                    className="text-muted-foreground hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Danger zone */}
      <div className="border-t border-border pt-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-rose-400">
          <AlertTriangle className="h-4 w-4" />
          {t("settings.backup.dangerZone")}
        </div>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          {t("settings.backup.resetDesc")}
        </p>
        <Button
          variant="outline"
          onClick={() => { setResetInput(""); setShowResetDialog(true); }}
          disabled={isDisabled}
          className="mt-3 border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:text-rose-400"
        >
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
          {t("settings.backup.reset")}
        </Button>
      </div>

      {/* Reset confirmation dialog */}
      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("settings.backup.resetConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("settings.backup.resetConfirmDesc")}</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings.backup.resetConfirmInput")}
            </label>
            <Input
              value={resetInput}
              onChange={(e) => setResetInput(e.target.value)}
              placeholder="RESET"
              className="mt-1.5 font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={resetInput !== "RESET"}
              onClick={handleReset}
              className="border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
            >
              {t("settings.backup.reset")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/backup-section.tsx
git commit -m "feat(backup): add BackupSection UI component"
```

---

### Task 7: Wire BackupSection into settings page

**Files:**
- Modify: `src/components/settings/settings-page.tsx:23-38` (imports)
- Modify: `src/components/settings/settings-page.tsx:127-163` (SECTIONS array)
- Modify: `src/components/settings/settings-page.tsx:167-196` (ACCENT_STYLES)
- Modify: `src/components/settings/settings-page.tsx:1762-1774` (renderSectionContent switch)

- [ ] **Step 1: Add HardDrive import**

In the lucide-react import block (line 23-38), add `HardDrive`:

```typescript
import {
  Settings,
  Cpu,
  FileText,
  SlidersHorizontal,
  Bell,
  HardDrive,  // ← add
  X,
  Plus,
  // ... rest unchanged
```

- [ ] **Step 2: Add BackupSection import**

After the existing component imports (around line 39-50), add:

```typescript
import { BackupSection } from "./backup-section";
```

- [ ] **Step 3: Add 6th section to SECTIONS array**

After the notifications entry (line 156-162), before `] as const;` (line 163), add:

```typescript
  {
    id: "backup",
    labelKey: "settings.backup.title" as const,
    descKey: "settings.backup.navDesc" as const,
    icon: HardDrive,
    accent: "cyan",
  },
```

- [ ] **Step 4: Add case to renderSectionContent**

> Note: `cyan` accent already exists in `ACCENT_STYLES` (line 195) — no changes needed there.

In the switch statement (line 1762-1774), add before the closing `}`:

```typescript
      case "backup":
        return <BackupSection />;
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit 2>&1 | grep -E "(settings-page|backup)" | head -10
```

Expected: No errors in these files.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/settings-page.tsx
git commit -m "feat(backup): wire BackupSection into settings page as 6th tab"
```

---

### Task 8: Add config default for backup dir

**Files:**
- Modify: `src/lib/config-defaults.ts`

- [ ] **Step 1: Add system.backupDir config default**

Find the system config section (around the `system.maxUploadBytes` entry) and add:

```typescript
  "system.backupDir": {
    defaultValue: "",
    type: "string",
    label: "Backup Directory",
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/config-defaults.ts
git commit -m "feat(backup): add system.backupDir config default"
```

---

### Task 9: Smoke test

- [ ] **Step 1: Start dev server and navigate to Settings**

Open the app, go to Settings, confirm the new "Data Management" tab appears as the 6th tab.

- [ ] **Step 2: Test create backup**

Click "Create Backup". Verify:
- Spinner appears during creation
- Success toast shows
- New backup appears in the list with filename, size, date, preview info

- [ ] **Step 3: Test list backups**

Verify the backup list shows the correct metadata preview (workspace names, project counts).

- [ ] **Step 4: Test delete backup**

Click delete on a backup. Verify:
- Confirmation prompt appears
- File is removed from list after confirmation
- Success toast shows

- [ ] **Step 5: Test restore backup**

Create a second backup, then restore the first one. Verify:
- Confirmation prompt mentions auto-backup
- Full-screen overlay appears during restore
- Success toast with reload button appears
- After reload, data matches the restored backup
- An auto-backup (`tower-auto-*`) was created

- [ ] **Step 6: Test reset system**

Click "Reset System". Verify:
- Dialog requires typing RESET
- Button disabled until RESET is entered
- Full-screen overlay during reset
- Redirects to onboarding page
- An auto-backup was created before reset

- [ ] **Step 7: Test restore after reset**

From onboarding, complete setup, go to Settings > Data Management. Verify:
- Previous backups still listed (backups/ preserved)
- Restore one of them works correctly

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "fix(backup): smoke test fixes"
```
