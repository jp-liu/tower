"use server";

import { db, resetDbConnection } from "@/lib/db";
import { getTowerDir, getBackupsDir } from "@/lib/tower-dir";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";
import {
  acquireLock, releaseLock, createArchive, listArchives,
  extractArchive, swapDirs, deleteWalFiles, wipeTowerData,
  cleanupTempDirs, validateFilename, validateBackupDir,
  type BackupInfo, type BackupMetadata,
} from "@/lib/backup";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { revalidatePath } from "next/cache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

    // 8. Rebuild FTS
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
