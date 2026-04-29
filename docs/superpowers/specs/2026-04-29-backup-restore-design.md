# Tower Backup & Restore Design Spec

## Overview

Add a "Data Management" tab to the Settings page. Users can create full-site archives of `~/.tower/` (database, assets, config — excluding cache), restore from archives, delete archives, and reset the system to a clean state.

## Scope

| In scope | Out of scope |
|----------|-------------|
| Full-site `.tar.gz` archive (all workspaces) | Per-workspace or per-project export |
| Restore with auto-backup safety net | Merge/diff between archives |
| Delete archive files | Scheduled/automatic backups |
| System reset (wipe + re-onboard) | Cloud/remote backup storage |
| Configurable backup directory | Archive encryption |

## Data Mapping

### Included in archive

| Directory | Content |
|-----------|---------|
| `database/tower.db` | SQLite database (all workspaces, projects, tasks, notes, config, etc.) |
| `storage/assets/` | User-uploaded files, organized by `<projectId>/` |
| `assistant/` | AI assistant persona (`CLAUDE.md`) and skill definitions |
| `logs/` | Operation logs |
| `metadata.json` | Archive summary (generated at pack time, lives at archive root) |

### Excluded from archive

| Directory | Reason |
|-----------|--------|
| `storage/cache/` | Runtime cache (task execution, assistant chat images) — regenerated |
| `backups/` | Archive files themselves — prevents recursive inclusion |

## Archive Format

- **Format:** `.tar.gz` (Node.js `tar` + `zlib`)
- **Naming:** `tower-backup-YYYYMMDD-HHmmss.tar.gz` (manual) / `tower-auto-YYYYMMDD-HHmmss.tar.gz` (auto, pre-restore/pre-reset)
- **Storage:** Default `~/.tower/backups/`, configurable via `system.backupDir` in SystemConfig

### metadata.json Schema

```json
{
  "version": 1,
  "createdAt": "2026-04-29T10:30:00.000Z",
  "towerVersion": "0.1.11",
  "autoBackup": false,
  "stats": {
    "workspaces": 3,
    "projects": 12,
    "tasks": 86
  },
  "preview": [
    { "workspace": "📋 开发工作区", "projects": ["tower", "enrollment"] },
    { "workspace": "🎯 个人项目", "projects": ["blog", "tools"] }
  ]
}
```

- `preview` contains up to 3 workspaces, each with up to 3 project names. Workspace names are stored as-is from `workspace.name` (may include user-set emoji via `workspace.description`).
- `autoBackup: true` marks archives created automatically before restore/reset.
- `towerVersion` is read from the project's `package.json` at runtime.

## Operations

### 1. Create Backup

1. Query database for stats and workspace/project preview.
2. Generate `metadata.json` (include `towerVersion` from `package.json`).
3. Run `PRAGMA wal_checkpoint(TRUNCATE)` to flush WAL into the main DB file.
4. Pack `database/tower.db`, `storage/assets/`, `assistant/`, `logs/`, and `metadata.json` into `.tar.gz`.
5. Write to backups directory.
6. Return file info (name, size, metadata).

**Database safety:** The WAL checkpoint in step 3 ensures a consistent snapshot. Only `tower.db` is packed — `-wal` and `-shm` files are excluded.

### 2. List Backups

1. Scan backups directory for `tower-*.tar.gz` files.
2. For each file, extract `metadata.json` from the archive (stream, don't fully decompress).
3. Return list sorted by creation date (newest first), including: filename, size, createdAt, stats, preview, autoBackup flag.

### 3. Restore Backup

1. Validate the `.tar.gz` file: check it exists, extract and parse `metadata.json` to confirm `version` field. Also verify archive contains expected top-level directories (`database/`, `storage/`).
2. **Auto-backup** current data first (`tower-auto-*`).
3. Stop all active PTY sessions via `destroyAllSessions()`.
4. Disconnect Prisma client via `$disconnect()`.
5. **Extract to a temporary directory** (`~/.tower/_restore_tmp/`) first — do NOT overwrite in-place.
6. Validate extracted contents are complete (database file exists, no partial extraction).
7. Delete existing `tower.db-wal` and `tower.db-shm` files (stale WAL from current DB would corrupt restored data).
8. Swap directories: move current `database/`, `storage/assets/`, `assistant/`, `logs/` to `_old_tmp/`, then move extracted dirs into place. Delete `_old_tmp/` after success.
9. Reinitialize database connection: reset the `initialized` flag on the Prisma singleton, call `initDb()` to re-run PRAGMAs, reconnect.
10. Rebuild FTS index via programmatic call to `initFts()`.
11. Return success; frontend shows "reload required" toast recommending **full page reload** (server-side module caches may hold stale references).

**Rollback on failure:** If extraction or swap fails, restore from `_old_tmp/` (the pre-restore data), reconnect DB, and return an error. Clean up temp directories in all cases.

**Path safety:** Validate all tar entry paths on extract — reject entries containing `..` or absolute paths.

### 4. Delete Backup

1. Validate filename matches `tower-*.tar.gz` pattern (no path traversal).
2. Delete file from backups directory.
3. Return updated list.

### 5. Reset System

1. Show confirmation dialog: user must type `RESET` to proceed.
2. **Server-side validation:** `resetSystem(confirmation)` requires `confirmation === "RESET"`, reject otherwise.
3. **Auto-backup** current data first (`tower-auto-*`).
4. Stop all active PTY sessions.
5. Disconnect Prisma client.
6. Delete: `database/`, `storage/assets/`, `assistant/`, `logs/`.
7. Preserve: `backups/`.
8. Reinitialize empty database (reset `initialized` flag, call `initDb()` — Prisma creates tables on connect).
9. Onboarding triggers automatically (no `onboarding.completed` config row exists in fresh DB).
10. Redirect to `/` (onboarding page).

## Server Actions

All in `src/actions/backup-actions.ts`:

| Function | Signature | Description |
|----------|-----------|-------------|
| `createBackup` | `() → BackupInfo` | Create a full-site archive |
| `listBackups` | `() → BackupInfo[]` | List all archives with metadata |
| `restoreBackup` | `(filename: string) → void` | Auto-backup then restore |
| `deleteBackup` | `(filename: string) → void` | Delete an archive file |
| `resetSystem` | `(confirmation: string) → void` | Validate `confirmation === "RESET"`, auto-backup then wipe |
| `getBackupDir` | `() → string` | Get current backup directory |
| `setBackupDir` | `(dir: string) → void` | Update backup directory config |

### BackupInfo Type

```typescript
interface BackupInfo {
  filename: string;
  size: number;         // bytes
  createdAt: string;    // ISO date
  autoBackup: boolean;
  stats: {
    workspaces: number;
    projects: number;
    tasks: number;
  };
  preview: {
    workspace: string;  // icon + name
    projects: string[]; // up to 3 names
  }[];
}
```

## Settings Page UI

### New Tab: Data Management

6th tab in settings, after Notifications. Icon: `HardDrive`, accent: cyan.

```
┌──────────────────────────────────────────────────────┐
│  备份与恢复                                           │
│                                                      │
│  存档路径: ~/.tower/backups    [修改]                  │
│  [创建存档]                                           │
│                                                      │
│  ┌──────────────────────────────────────────────────┐ │
│  │ tower-backup-20260429-103000.tar.gz              │ │
│  │ 15.2 MB · 2026-04-29 10:30                      │ │
│  │ 📋 开发工作区(tower, enrollment)                  │ │
│  │ 🎯 个人项目(blog, tools) 等 3 个工作区            │ │
│  │ 12 个项目 · 86 个任务                             │ │
│  │                              [恢复]  [删除]       │ │
│  └──────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐ │
│  │ tower-auto-20260428-180000.tar.gz    自动备份     │ │
│  │ 14.8 MB · 2026-04-28 18:00                      │ │
│  │ 📋 开发工作区(tower) 🎯 个人项目(blog)            │ │
│  │ 等 2 个工作区 · 8 个项目 · 45 个任务              │ │
│  │                              [恢复]  [删除]       │ │
│  └──────────────────────────────────────────────────┘ │
│                                                      │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  ⚠️ 危险操作                                         │
│  重置将清空所有数据（数据库、资源、配置），              │
│  仅保留存档文件。重置前会自动创建一份存档。              │
│  [重置系统]                                           │
│                                                      │
│  重置确认弹窗:                                        │
│  ┌─────────────────────────┐                         │
│  │ 确认重置系统？           │                         │
│  │ 此操作不可撤销。         │                         │
│  │ 输入 RESET 确认:        │                         │
│  │ [____________]          │                         │
│  │ [取消]  [确认重置]       │                         │
│  └─────────────────────────┘                         │
└──────────────────────────────────────────────────────┘
```

### Loading States

- **创建存档:** 按钮显示 spinner + "正在创建存档..."，禁用其他操作
- **恢复存档:** 弹窗确认 → spinner 全屏遮罩 + "正在恢复数据..."，完成后提示刷新
- **重置系统:** 输入确认 → spinner 全屏遮罩 + "正在重置系统..."，完成后自动跳转

## i18n Keys

Namespace `settings.backup.*` for all backup/restore/reset related strings. Both zh and en.

## Dependencies

- `tar` (npm) — streaming tar creation/extraction, widely used, no native deps
- Node.js built-in `zlib` — gzip compression
- Node.js built-in `fs`, `path` — file operations

No new large dependencies.

## Concurrency

Use a lock file (`~/.tower/backups/.lock`) during backup/restore/reset operations. If a lock exists and the process is still alive, reject the operation with an error message. Stale locks (process no longer running) are cleaned up automatically.

## Security

- **Path traversal prevention:** Validate tar entry paths on extract; reject `..` and absolute paths.
- **Filename validation:** Only allow `tower-*.tar.gz` pattern for delete/restore operations.
- **Backup directory validation:** Must be an absolute path, writable. Reject paths outside user's home directory. Test writability by creating a temp file.
- **Reset confirmation:** Server-side validation that `confirmation === "RESET"`, not just client-side.
- **Auto-backup guarantee:** Both restore and reset always create a safety backup first.
- **Atomic restore:** Extract to temp dir first, validate, then swap — never overwrite in-place.

## Edge Cases

| Case | Handling |
|------|---------|
| Disk full during archive creation | Catch write error, clean up partial file, show error toast |
| Corrupt/invalid archive on restore | Validate metadata.json before starting; abort with error |
| Database locked during backup | WAL checkpoint flushes; busy_timeout handles brief locks |
| Backup dir doesn't exist | Create on first use |
| Backup dir not writable | Show error in settings, prevent operations |
| PTY sessions active during restore/reset | `destroyAllSessions()` called before any destructive operation |
| Archive from different Tower version | `metadata.version` field for future migration support |
| Concurrent operations (two tabs) | Lock file in backups directory; reject if lock held |
| Restore fails midway | Rollback from `_old_tmp/`; clean up temp dirs |
| Stale WAL files after restore | Explicitly delete `-wal` and `-shm` before extracting DB |
