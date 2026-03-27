---
phase: 04-data-layer-foundation
verified: 2026-03-27T08:00:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 4: Data Layer Foundation Verification Report

**Phase Goal:** The data layer for notes and assets is in place and both PrismaClient instances are safe for concurrent use
**Verified:** 2026-03-27T08:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Plan 04-01)

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | ProjectNote and ProjectAsset models exist in Prisma and can be queried | VERIFIED | `prisma/schema.prisma` lines 135-162; live Prisma query returns 0 rows without error |
| 2  | NoteCategory preset values (账号/环境/需求/备忘) are defined as constants | VERIFIED | `src/lib/constants.ts` line 21: `NOTE_CATEGORIES_PRESET = ["账号", "环境", "需求", "备忘"]` |
| 3  | FTS5 virtual table notes_fts can be created via db:init-fts script | VERIFIED | `prisma/init-fts.ts` contains `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts`; `package.json` line 14: `"db:init-fts": "tsx prisma/init-fts.ts"` |
| 4  | data/assets/{projectId}/ and data/cache/{taskId}/ directories can be created | VERIFIED | `src/lib/file-utils.ts` exports `ensureAssetsDir` and `ensureCacheDir` using `fs.mkdirSync`; 9 tests pass |
| 5  | Both PrismaClient instances set busy_timeout=5000 before first use | VERIFIED | `src/lib/db.ts` line 21: `PRAGMA busy_timeout=5000`; `src/mcp/db.ts` line 9: `Prisma.sql\`PRAGMA busy_timeout=5000\`` |

### Observable Truths (Plan 04-02)

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 6  | A ProjectNote can be created, read, updated, and deleted via note-actions | VERIFIED | `src/actions/note-actions.ts` exports `createNote`, `updateNote`, `deleteNote`, `getNoteById`, `getProjectNotes`; 13 integration tests pass |
| 7  | Notes can be filtered by category including preset values | VERIFIED | `getProjectNotes` accepts `options.category`; test "filters notes by category when category option is provided" passes |
| 8  | FTS5 search returns note results for 3+ character Chinese or English keywords | VERIFIED | `src/lib/fts.ts` line 38-47: FTS5 MATCH path for `trimmed.length >= 3`; tests "FTS5 MATCH for 3+ char query" and "Chinese characters (3+ chars)" pass |
| 9  | FTS5 search falls back to LIKE for queries shorter than 3 characters | VERIFIED | `src/lib/fts.ts` lines 25-35: LIKE fallback for `trimmed.length < 3`; test "uses LIKE fallback for 2-char query" passes |
| 10 | FTS5 index stays in sync with ProjectNote records on create/update/delete | VERIFIED | `note-actions.ts` calls `syncNoteToFts` after create/update, `deleteNoteFromFts` before delete; FTS sync tests pass |
| 11 | A ProjectAsset record can be created pointing to data/assets/{projectId}/ | VERIFIED | `src/actions/asset-actions.ts` exports `createAsset`; 10 integration tests pass |
| 12 | createAsset calls ensureAssetsDir before db insert to guarantee directory exists | VERIFIED | `asset-actions.ts` line 24: `ensureAssetsDir(parsed.projectId)` called before `db.projectAsset.create`; test "calls ensureAssetsDir before creating db record" passes |

**Score:** 12/12 truths verified

---

### Required Artifacts (Plan 04-01)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `prisma/schema.prisma` | ProjectNote and ProjectAsset models with Project relations | VERIFIED | Lines 135-162; `project Project @relation` with cascade delete in both models; `notes ProjectNote[]` and `assets ProjectAsset[]` in Project model |
| `prisma/init-fts.ts` | FTS5 virtual table creation script | VERIFIED | Contains `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts` with `tokenize='trigram case_sensitive 0'` |
| `src/lib/file-utils.ts` | Directory helpers for data/assets/ and data/cache/ | VERIFIED | Exports: `getAssetsDir`, `getCacheDir`, `ensureAssetsDir`, `ensureCacheDir`, `listAssetFiles`; no Next.js imports |
| `src/lib/constants.ts` | Note category preset constants | VERIFIED | Line 21-22: `NOTE_CATEGORIES_PRESET` and `NoteCategoryPreset` type |
| `src/lib/db.ts` | Next.js PrismaClient with busy_timeout pragma | VERIFIED | `initDb()` sets both `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` |
| `src/mcp/db.ts` | MCP PrismaClient with busy_timeout pragma | VERIFIED | `initDb()` sets `Prisma.sql\`PRAGMA busy_timeout=5000\`` |

### Required Artifacts (Plan 04-02)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/fts.ts` | FTS5 search helper and sync functions | VERIFIED | Exports `searchNotes`, `syncNoteToFts`, `deleteNoteFromFts`, `FtsNoteResult`; dependency injection pattern; no Next.js imports |
| `src/actions/note-actions.ts` | Note CRUD server actions with FTS sync and Zod validation | VERIFIED | `"use server"` directive; Zod schemas at boundary; FTS sync on every CUD operation; 5 exports |
| `src/actions/asset-actions.ts` | Asset CRUD server actions with ensureAssetsDir | VERIFIED | `"use server"` directive; Zod schema; `ensureAssetsDir` called before db insert; 4 exports |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `prisma/schema.prisma` | Project model | `ProjectNote.project` and `ProjectAsset.project` relations | VERIFIED | Lines 144, 159: `project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)` |
| `prisma/init-fts.ts` | `prisma/schema.prisma` | runs AFTER db push | VERIFIED | Script is separate from schema; `db:init-fts` in package.json runs after `db:push` |
| `src/actions/note-actions.ts` | `src/lib/fts.ts` | `syncNoteToFts` and `deleteNoteFromFts` called after every CUD | VERIFIED | Lines 36, 50 (syncNoteToFts); line 56 (deleteNoteFromFts) |
| `src/actions/note-actions.ts` | `src/lib/db.ts` | `import { db } from '@/lib/db'` | VERIFIED | Line 4 |
| `src/actions/asset-actions.ts` | `src/lib/file-utils.ts` | `ensureAssetsDir` called before db insert | VERIFIED | Line 6 (import); line 24 (call before create) |
| `src/lib/fts.ts` | notes_fts virtual table | `$queryRawUnsafe` and `$executeRawUnsafe` | VERIFIED | Lines 40, 42, 60, 64, 80 reference `notes_fts` directly |

---

### Data-Flow Trace (Level 4)

These are server action modules (not UI rendering components), so data-flow tracing focuses on verifying real DB operations rather than prop rendering.

| Artifact | Operation | Data Source | Produces Real Data | Status |
|----------|-----------|-------------|-------------------|--------|
| `note-actions.ts` | createNote | `db.projectNote.create` with parsed Zod data | Yes | FLOWING |
| `note-actions.ts` | getProjectNotes | `db.projectNote.findMany` with projectId/category filter | Yes | FLOWING |
| `asset-actions.ts` | createAsset | `ensureAssetsDir` + `db.projectAsset.create` | Yes | FLOWING |
| `fts.ts` | searchNotes (3+ chars) | `notes_fts MATCH` query via `$queryRawUnsafe` | Yes | FLOWING |
| `fts.ts` | searchNotes (< 3 chars) | `ProjectNote LIKE` query via `$queryRawUnsafe` | Yes | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| ProjectNote and ProjectAsset Prisma models are queryable | `node -e "db.projectNote.findMany()..."` | "ProjectNote queryable, count: 0" — no error | PASS |
| All 42 unit tests pass | `pnpm vitest run tests/unit/lib/...` | 4 test files, 42 tests, all passed | PASS |
| FTS5 search uses LIKE for short queries | test "uses LIKE fallback for 2-char query and finds matching note" | PASS | PASS |
| FTS5 search uses MATCH for 3+ char queries | test "uses FTS5 MATCH for 3+ char query" | PASS | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| NOTE-01 | 04-01, 04-02 | 用户可为项目创建、查看、编辑、删除 Markdown 笔记 | SATISFIED | `note-actions.ts` exports `createNote`, `updateNote`, `deleteNote`, `getNoteById`, `getProjectNotes`; all tested |
| NOTE-02 | 04-01, 04-02 | 笔记支持预设分类（账号/环境/需求/备忘）和自定义分类 | SATISFIED | `NOTE_CATEGORIES_PRESET` in constants; `createNote` defaults to "备忘"; `getProjectNotes` filters by category |
| NOTE-03 | 04-01, 04-02 | 用户可通过 FTS5 全文搜索笔记内容（支持中英文） | SATISFIED | `src/lib/fts.ts` `searchNotes` with trigram FTS5 + LIKE fallback; Chinese 3-char test passes |
| ASST-01 | 04-01, 04-02 | 用户可上传文件作为项目级持久化资源（存储在 data/assets/{projectId}/） | SATISFIED | `asset-actions.ts` `createAsset` calls `ensureAssetsDir` then `db.projectAsset.create` |
| ASST-02 | 04-01 | 任务级临时文件存储在 data/cache/{taskId}/，支持手动清理 | SATISFIED | `src/lib/file-utils.ts` exports `getCacheDir` and `ensureCacheDir`; 9 tests pass |

**Orphaned requirements check:** REQUIREMENTS.md maps NOTE-01 through ASST-02 to Phase 4. All 5 are claimed in plan frontmatter and verified above. No orphaned requirements found.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

Scanned all phase artifacts for TODO/FIXME, placeholder returns, hardcoded empty data, and console-only implementations. No anti-patterns flagged. (The `console.log` in `prisma/init-fts.ts` line 16 is intentional stdout confirmation for a CLI script — not a production code path.)

---

### Human Verification Required

None. All observable truths can be verified programmatically. The FTS5 virtual table existence was confirmed indirectly by passing integration tests that perform live inserts and queries against `notes_fts`.

---

### Gaps Summary

No gaps. All 12 must-haves are verified:

- Prisma schema correctly defines `ProjectNote` and `ProjectAsset` with cascade-delete relations to `Project`
- Both `src/lib/db.ts` and `src/mcp/db.ts` set `PRAGMA busy_timeout=5000` in their respective `initDb()` functions
- `prisma/init-fts.ts` creates the FTS5 virtual table with trigram tokenizer
- `src/lib/file-utils.ts` provides all five directory helpers with no Next.js imports
- `src/lib/constants.ts` exports `NOTE_CATEGORIES_PRESET` with all four preset values
- `src/lib/fts.ts` implements FTS5 search with LIKE fallback using dependency injection
- `src/actions/note-actions.ts` wires Zod validation, DB operations, and FTS sync correctly
- `src/actions/asset-actions.ts` calls `ensureAssetsDir` before `db.projectAsset.create`
- All 42 integration tests pass (4 test files)
- All 5 requirement IDs (NOTE-01, NOTE-02, NOTE-03, ASST-01, ASST-02) are satisfied

---

_Verified: 2026-03-27T08:00:00Z_
_Verifier: Claude (gsd-verifier)_
