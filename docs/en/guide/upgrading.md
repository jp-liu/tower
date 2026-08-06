---
title: Upgrade and migration
description: Data backup, automatic migrations, compatibility boundaries, and rollback
---

# Upgrade and migration

Before upgrading, create a full backup in Tower's data management UI and keep a separate offline copy of `~/.tower`. Database schemas migrate forward. Older Tower versions are not guaranteed to write an upgraded database safely, so downgrade by restoring the pre-upgrade backup.

## What happens at startup

Tower resolves `TOWER_DATA_DIR`, checks the Prisma schema, and runs migration files not yet recorded in `AppliedMigration`, in numeric order. A migration is recorded only after success. Failure stops later migrations and the next start retries from the failed item.

Migrations do not automatically delete API keys, CLI credentials, Provider configuration, or Assistant history. Legacy configuration remains compatible when it maps unambiguously. Tower preserves and diagnoses connections it cannot map safely instead of guessing a target.

## Backup coverage

| Data | Full backup |
|---|---|
| SQLite database, project facts, tasks, and configuration | Included |
| API keys and sensitive custom headers/query values | Included; protect the archive as key material |
| Project assets and Assistant sessions | Included |
| CLI Provider registry, installation directories, and configuration | Included |
| Temporary Assistant attachment cache | Not guaranteed; save long-lived files as project assets |
| CLI-owned login/token, user repositories, and Git worktrees | Not included |

## Safe upgrade sequence

1. Stop Tower and any unattended service.
2. Create a full backup and record the current version and data directory.
3. Install and start the target version, then wait for migrations to finish.
4. Check workspaces, projects, Assistant, AI Tools connections, and active work.
5. Restore the unattended service only after verification.

If migration fails, do not let several versions repeatedly write the same database. Preserve logs and the backup, fix the cause, and retry. To downgrade, move the upgraded data directory aside and restore the backup made for the older version.
