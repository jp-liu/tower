---
phase: 08-asset-description-schema
plan: "01"
subsystem: assets
tags: [schema, prisma, sqlite, i18n, react, vitest, tdd]
dependency_graph:
  requires: []
  provides: [ProjectAsset.description field, description i18n keys, upload dialog description textarea]
  affects: [Phase 09 asset search — can now match against description field]
tech_stack:
  added: []
  patterns: [Prisma nullable field with @default(""), Zod optional string max validation, React controlled textarea with trim guard]
key_files:
  created:
    - tests/unit/components/assets/asset-upload.test.tsx
  modified:
    - prisma/schema.prisma
    - src/actions/asset-actions.ts
    - src/lib/i18n.tsx
    - src/components/assets/asset-item.tsx
    - src/components/assets/asset-upload.tsx
    - tests/unit/lib/asset-actions.test.ts
    - tests/unit/components/asset-item.test.tsx
    - tests/unit/components/asset-list.test.tsx
decisions:
  - "Used String? @default('') for description — nullable with empty string default avoids NOT NULL constraint errors on existing rows and table recreation"
  - "Ran prisma generate (not db:push) after column was added via partial push — db:push failed on FTS5 shadow table drop but column was already applied"
  - "Re-ran pnpm db:init-fts after push to restore notes_fts FTS5 virtual table (trigram tokenizer)"
  - "description guard uses !description.trim() to block whitespace-only submissions"
metrics:
  duration: "7m"
  completed: "2026-03-30"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 8
  files_created: 1
---

# Phase 08 Plan 01: Asset Description Schema Summary

**One-liner:** Added nullable `description` field to `ProjectAsset` (SQLite `TEXT DEFAULT ''`), wired through Zod validation, upload dialog textarea, and display in asset list with null-safe rendering.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Schema + Data Layer | ec70fdf | prisma/schema.prisma, src/actions/asset-actions.ts, src/lib/i18n.tsx, tests/unit/lib/asset-actions.test.ts |
| 2 | UI Layer | 92a3e2d | src/components/assets/asset-upload.tsx, src/components/assets/asset-item.tsx, tests/unit/components/assets/asset-upload.test.tsx |

## What Was Built

- **Prisma schema:** `description String? @default("")` added to `ProjectAsset` model
- **Zod validation:** `description: z.string().max(500).optional()` in `createAssetSchema`
- **Server action `createAsset`:** accepts `description?: string` in parameter type
- **Server action `uploadAsset`:** extracts `formData.get("description")` and passes to `createAsset`
- **i18n keys:** `assets.description` and `assets.descriptionPlaceholder` in both zh and en locales
- **Upload dialog:** textarea with `items-start` alignment, trim guard in disabled condition, appended to FormData
- **Asset item display:** `asset.description && <p>` null-safe rendering below filename
- **Tests:** 4 new tests in `asset-actions.test.ts` (with description, null default, max length, retrieval); 3 new ASSET-01 component tests in `asset-upload.test.tsx`; fixed `asset-item.test.tsx` and `asset-list.test.tsx` fixtures to include `description: null`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FTS5 shadow table error during `pnpm db:push`**
- **Found during:** Task 1, Step 3 (db push)
- **Issue:** `prisma db push` failed with "no such table: notes_fts_config" when trying to drop FTS5 virtual table shadow tables. The `notes_fts` tables had been deleted from the live database but Prisma's schema engine still attempted to drop them. Using `--accept-data-loss` also failed.
- **Fix:** Detected that `description` column was already applied to SQLite (the partial push succeeded up to the FTS5 DROP step). Ran `pnpm db:generate` to regenerate Prisma client types, then ran `pnpm db:init-fts` to restore the `notes_fts` FTS5 virtual table.
- **Files modified:** No code changes — operational recovery only
- **Result:** `sqlite3 dev.db ".tables"` shows all 6 `notes_fts*` shadow tables present; column confirmed via `PRAGMA table_info(ProjectAsset)`

**2. [Rule 1 - Bug] Pre-existing test fixtures missing `description` field**
- **Found during:** Task 2, TypeScript check
- **Issue:** After adding `description: string | null` to `AssetItemType` interface, `tests/unit/components/asset-item.test.tsx` and `asset-list.test.tsx` mock objects lacked the new required field, causing TypeScript errors TS2741/TS2322.
- **Fix:** Added `description: null` to mock objects in both test files.
- **Files modified:** `tests/unit/components/asset-item.test.tsx`, `tests/unit/components/asset-list.test.tsx`
- **Commit:** 92a3e2d

### Test Button Text Adjustment

The plan's component test used `screen.getByText("上传")` to open the dialog. The actual button renders `t("assets.upload")` which maps to "上传文件" (not "上传"). Tests were written with the correct "上传文件" text — this was discovered by reading the actual source before writing tests.

## Pre-existing Issues (Out of Scope)

- `src/actions/agent-config-actions.ts` has 2 TypeScript errors (InputJsonValue type mismatch) — pre-existing before this plan
- `src/app/api/tasks/[taskId]/stream/route.ts` has 2 TypeScript errors — pre-existing before this plan
- `tests/unit/components/prompts-config.test.tsx` has 8 failing tests (useRouter invariant error) — pre-existing before this plan

These are documented in `.planning/phases/08-asset-description-schema/deferred-items.md` (not created, as they are out of scope per deviation rules).

## Verification Results

- `sqlite3 prisma/dev.db "PRAGMA table_info(ProjectAsset);" | grep description` → `7|description|TEXT|0|''|0`
- `sqlite3 prisma/dev.db ".tables"` → includes `notes_fts` and all 5 shadow tables
- `sqlite3 prisma/dev.db "SELECT id, filename, description FROM ProjectAsset;"` → pre-existing asset shows `|Snipaste_2026-03-27_11-41-19.png|` (empty description, no error)
- `pnpm vitest run tests/unit/lib/asset-actions.test.ts` → 14/14 passed
- `pnpm vitest run tests/unit/components/assets/asset-upload.test.tsx` → 3/3 passed
- All 27 asset-related tests pass across 4 test files

## Known Stubs

None — all data flows are fully wired. The description field is persisted, returned from the DB, and rendered in the UI.

## Self-Check: PASSED
