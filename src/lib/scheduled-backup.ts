import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../../package.json";
import { readConfigValue } from "@/lib/config-reader";
import { db } from "@/lib/db";
import { getBackupsDir, getTowerDir } from "@/lib/tower-dir";
import {
  acquireLock,
  createArchive,
  releaseLock,
  type BackupMetadata,
} from "@/lib/backup";

const BACKUP_NAME_RE = /^tower-(backup|auto)-\d{8}-\d{6}\.tar\.gz$/;
const AUTO_BACKUP_RE = /^tower-auto-\d{8}-\d{6}\.tar\.gz$/;
const DEFAULT_INTERVAL_HOURS = 24;
const DEFAULT_RETENTION = 7;

function archiveRows(backupsDir: string, pattern = BACKUP_NAME_RE) {
  try {
    return readdirSync(backupsDir)
      .filter((name) => pattern.test(name))
      .map((name) => ({ name, mtimeMs: statSync(join(backupsDir, name)).mtimeMs }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
  } catch {
    return [];
  }
}

export function scheduledBackupIsDue(
  backupsDir: string,
  intervalHours: number,
  now = Date.now(),
): boolean {
  const latest = archiveRows(backupsDir)[0];
  return !latest || now - latest.mtimeMs >= intervalHours * 60 * 60 * 1_000;
}

export function pruneScheduledBackups(backupsDir: string, retain: number): string[] {
  const removed: string[] = [];
  for (const archive of archiveRows(backupsDir, AUTO_BACKUP_RE).slice(Math.max(1, retain))) {
    try {
      unlinkSync(join(backupsDir, archive.name));
      removed.push(archive.name);
    } catch {
      // Best effort; a later scheduled run retries retention.
    }
  }
  return removed;
}

async function metadata(): Promise<BackupMetadata> {
  const [workspaces, projects, tasks, previewRows] = await Promise.all([
    db.workspace.count(),
    db.project.count(),
    db.task.count(),
    db.workspace.findMany({
      take: 3,
      orderBy: { updatedAt: "desc" },
      select: {
        name: true,
        projects: { take: 3, orderBy: { updatedAt: "desc" }, select: { name: true } },
      },
    }),
  ]);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    towerVersion: packageJson.version ?? "unknown",
    autoBackup: true,
    label: "Scheduled unattended backup",
    stats: { workspaces, projects, tasks },
    preview: previewRows.map((workspace) => ({
      workspace: workspace.name,
      projects: workspace.projects.map((project) => project.name),
    })),
  };
}

export async function createScheduledBackupIfDue(): Promise<{
  created: boolean;
  filename?: string;
  removed?: string[];
}> {
  const enabled = await readConfigValue<boolean>("system.autoBackupEnabled", true);
  if (!enabled) return { created: false };
  const intervalHours = Math.max(
    1,
    await readConfigValue<number>("system.autoBackupIntervalHours", DEFAULT_INTERVAL_HOURS),
  );
  const retention = Math.max(
    1,
    await readConfigValue<number>("system.autoBackupRetention", DEFAULT_RETENTION),
  );
  const backupsDir = await readConfigValue<string>("system.backupDir", "") || getBackupsDir();
  if (!scheduledBackupIsDue(backupsDir, intervalHours)) return { created: false };

  acquireLock(backupsDir);
  try {
    // Recheck under the lock so two server runtimes cannot both create one.
    if (!scheduledBackupIsDue(backupsDir, intervalHours)) return { created: false };
    await db.$queryRaw`PRAGMA wal_checkpoint(TRUNCATE)`;
    const created = await createArchive(getTowerDir(), backupsDir, await metadata(), true);
    return {
      created: true,
      filename: created.filename,
      removed: pruneScheduledBackups(backupsDir, retention),
    };
  } finally {
    releaseLock(backupsDir);
  }
}
