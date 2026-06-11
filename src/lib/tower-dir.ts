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
import { homedir } from "node:os";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";

let _dir: string | undefined;

/** TOWER_DATA_DIR env or ~/.tower */
export function getTowerDir(): string {
  if (_dir) return _dir;
  _dir = process.env.TOWER_DATA_DIR || join(homedir(), ".tower");
  if (!existsSync(_dir)) {
    mkdirSync(_dir, { recursive: true });
  }
  return _dir;
}

/** ~/.tower/database */
export function getDatabaseDir(): string {
  const dir = join(getTowerDir(), "database");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** ~/.tower/database/tower.db */
export function getTowerDbPath(): string {
  return join(getDatabaseDir(), "tower.db");
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
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** ~/.tower/assistant */
export function getAssistantDir(): string {
  const dir = join(getTowerDir(), "assistant");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** ~/.tower/logs */
export function getLogsDir(): string {
  const dir = join(getTowerDir(), "logs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** ~/.tower/backups */
export function getBackupsDir(): string {
  const dir = join(getTowerDir(), "backups");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * ~/.tower/extensions — npm-managed installs for optional extensions
 * (ripgrep, monaco, ...). Installing into the global Tower package's
 * own node_modules is unreliable across platforms (permissions, npm's
 * special handling of global-install directories), so each extension's
 * deps land in a dedicated user-owned workspace here.
 */
export function getExtensionsDir(): string {
  const dir = join(getTowerDir(), "extensions");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
