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
import { mkdirSync, existsSync } from "node:fs";

let _dir: string | undefined;

/** ~/.tower */
export function getTowerDir(): string {
  if (_dir) return _dir;
  _dir = join(homedir(), ".tower");
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

/** ~/.tower/storage — root for assets + cache */
export function getStorageDir(): string {
  const dir = join(getTowerDir(), "storage");
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
