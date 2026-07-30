/**
 * Canonical Tower data directory: ~/.tower
 *
 * All runtime data lives here, independent of where the app is installed.
 *
 * Structure:
 *   ~/.tower/
 *   ├── database/            # SQLite database
 *   │   └── tower.db
 *   ├── storage/             # User file storage
 *   │   ├── assets/          #   Project assets (uploads)
 *   │   │   └── <projectId>/
 *   │   └── cache/           #   Runtime cache
 *   │       ├── <taskId>/
 *   │       └── assistant/   #   AI assistant chat images
 *   ├── assistant/           # AI assistant config
 *   │   ├── CLAUDE.md
 *   │   └── .claude/skills/
 *   └── logs/                # Logs (reserved)
 */

import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";

function ensurePrivateDirectory(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Best effort on filesystems that do not implement POSIX modes.
  }
  return dir;
}

/** TOWER_DATA_DIR env or ~/.tower */
export function getTowerDir(): string {
  const dir = process.env.TOWER_DATA_DIR || join(homedir(), ".tower");
  return ensurePrivateDirectory(dir);
}

/** ~/.tower/database */
export function getDatabaseDir(): string {
  return ensurePrivateDirectory(join(getTowerDir(), "database"));
}

/** ~/.tower/database/tower.db */
export function getTowerDbPath(): string {
  return join(getDatabaseDir(), "tower.db");
}

/**
 * DB file path WITHOUT the mkdir side effect — for building the Prisma
 * datasource URL at client construction (i.e. import) time. Reads the env
 * directly (no getTowerDir, so no directory is created). The directory itself is
 * ensured by getDatabaseDir() inside initDb(), before the first connect.
 */
export function getTowerDbFilePath(): string {
  const root = process.env.TOWER_DATA_DIR || join(homedir(), ".tower");
  return join(root, "database", "tower.db");
}

/**
 * Signal file directory, isolated per data root: $TMPDIR/tower-signals/<hash>.
 *
 * PTY pid files (orphan reaper) and exit signals live here. It sits in $TMPDIR
 * (not the data dir) so a reboot clears it, but MUST be keyed by TOWER_DATA_DIR
 * so a parallel prod (~/.tower) and dev (~/.tower-dev) never share it — otherwise
 * one instance's orphan reaper reads the other's live pid files and SIGKILLs its
 * running terminals. Reads the env directly (no getTowerDir → no dir creation);
 * callers mkdir this path themselves with 0700. Returns the path only.
 */
export function getSignalDir(): string {
  const root = process.env.TOWER_DATA_DIR || join(homedir(), ".tower");
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(tmpdir(), "tower-signals", hash);
}

/** Default storage root inside the Tower data dir. */
export function getDefaultStorageDir(): string {
  return join(getTowerDir(), "storage");
}

/**
 * Pointer file recording a user-chosen storage location. Lives in the (small,
 * fixed) data dir so it's always readable even when storage itself moves to
 * another drive. Plain text holding an absolute path; absent = use default.
 */
function getStoragePointerFile(): string {
  return join(getTowerDir(), "storage-location");
}

/** Read the configured storage override, or null if none/unreadable. */
export function readStoragePointer(): string | null {
  try {
    const p = readFileSync(getStoragePointerFile(), "utf-8").trim();
    return p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

/** Persist (or clear, when passed null) the storage location override. */
export function writeStoragePointer(dir: string | null): void {
  const file = getStoragePointerFile();
  if (dir === null) {
    rmSync(file, { force: true });
    return;
  }
  writeFileSync(file, dir, "utf-8");
}

/**
 * Storage root for assets + cache. Resolved fresh on every call (no caching)
 * so a relocation via Settings takes effect without restarting the server.
 * Priority: TOWER_STORAGE_DIR env → pointer file → default (~/.tower/storage).
 */
export function getStorageDir(): string {
  const override = process.env.TOWER_STORAGE_DIR || readStoragePointer();
  const dir = override && override.length > 0 ? override : getDefaultStorageDir();
  return ensurePrivateDirectory(dir);
}

/** ~/.tower/assistant */
export function getAssistantDir(): string {
  return ensurePrivateDirectory(join(getTowerDir(), "assistant"));
}

/** ~/.tower/logs */
export function getLogsDir(): string {
  return ensurePrivateDirectory(join(getTowerDir(), "logs"));
}

/** ~/.tower/backups */
export function getBackupsDir(): string {
  return ensurePrivateDirectory(join(getTowerDir(), "backups"));
}

/**
 * ~/.tower/extensions — npm-managed installs for optional extensions
 * (ripgrep, monaco, ...). Installing into the global Tower package's
 * own node_modules is unreliable across platforms (permissions, npm's
 * special handling of global-install directories), so each extension's
 * deps land in a dedicated user-owned workspace here.
 */
export function getExtensionsDir(): string {
  return ensurePrivateDirectory(join(getTowerDir(), "extensions"));
}
