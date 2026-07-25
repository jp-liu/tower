---
title: Upgrading to 0.3.0
description: 0.2 data migration, compatibility, backup, and rollback
---

## Before upgrading

Create a full backup in 0.2 and keep a separate offline copy of `~/.tower`. Tower 0.3.0 does not automatically export or delete API keys, CLI credentials, plugin configuration, or legacy Claude transcripts. The upgraded database is not write-compatible with 0.2; rollback means restoring the pre-upgrade backup, not opening the upgraded database with 0.2.

Production `tower` now binds `127.0.0.1` by default. Use `tower --host 0.0.0.0` or an explicit LAN address to opt into remote listening, and provide your own network access controls.

## Startup order

1. Resolve `TOWER_DATA_DIR` (default `~/.tower`) and generate/check Prisma Client.
2. Compare schema hash. On change, clear rebuildable FTS state, run Prisma `db push`, update built-in defaults, and rebuild FTS.
3. Run every missing one-shot migration in filename order. `AppliedMigration` belongs to the database; a failed migration is not recorded and later migrations do not pass it.
4. Start HTTP/WS and load built-in providers after migration.

All migration IDs, including AI Tools 0.3's `0009` through `0013`, are:

| ID | Purpose |
|---|---|
| `0001-insight-category` | Insight note category |
| `0002-backfill-done-at` | Completion timestamps |
| `0003-backfill-systemconfig-from-legacy-db` | Legacy system config |
| `0004-relocate-misplaced-assets` | Asset relocation |
| `0005-add-parent-task-id` | Parent-task relation |
| `0006-project-knowledge` | Project knowledge/facts |
| `0007-product-group` | Product groups |
| `0008-add-label-description` | Label descriptions |
| `0009-api-connections` | Connection instances, API keys, models, status; preserves legacy provider rows |
| `0010-capability-targets` | Five slots and ordered targets; maps legacy CLI settings |
| `0011-cli-plugin-connections` | Third-party CLI command, args, env, settings, and discovery cache |
| `0012-terminal-execution-targets` | Pinned connection/model snapshots for terminal executions |
| `0013-assistant-sessions` | Tower-owned Assistant sessions, turns, and messages |

Migrations are idempotent and do not automatically delete credentials.

## Compatibility

- `CliProfile` remains as a compatibility command/baseArgs/env source for built-in CLIs. `0010` creates slot targets; an unconfigured installation defaults to a Claude CLI target that still requires a successful Hello probe.
- `AgentConfig` and prompts remain. Runtime uses ordered `AiCapabilityTarget` rows; a legacy API setting that cannot identify a concrete connection becomes `legacy_api_unmapped` and requires manual selection.
- Legacy Terminal executions have no snapshot and resume only when a unique built-in CLI can be resolved. New executions always store a pinned target.
- Legacy Claude Assistant transcripts are not bulk-moved. Up to 50 appear for on-demand, read-only conversion into SQLite. Failure leaves source files untouched.

## Backup scope

| Data | Full archive |
|---|---|
| SQLite | Included, so plaintext API keys, sensitive header/query values, connections, slots, Assistant sessions/messages are included |
| Project assets under `storage/assets` | Included |
| Assistant persona/legacy transcript directory | Included |
| Logs | Included; application logs should already be redacted |
| Assistant temporary attachments under `storage/cache/assistant` | **Not included**; preserve important files as project assets |
| CLI plugin registry, install/staging, and plugin storage under `ai/` | **Not included**; DB connection settings restore, but plugins require reinstall/confirmation |
| CLI-owned login/token/base URL | Outside Tower and not backed up |
| Git worktrees, repositories, screenshots, development caches | Not included |

Treat a full archive as secret material because it contains plaintext credentials. Restore does not ask for keys again and never automatically exports, erases, or rotates them.

## Rollback

Stop 0.3, move the upgraded data directory aside, restore the pre-upgrade 0.2 archive, and reinstall the prior 0.2 version. Do not let 0.2 write the 0.3 database.
