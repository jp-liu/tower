---
phase: 44-cache-storage-refactor
verified: 2026-04-20T03:58:00Z
status: passed
score: 11/11 must-haves verified
human_verification:
  - test: "Upload a real image via the assistant chat panel"
    expected: "File appears in data/cache/assistant/YYYY-MM/images/ with a readable filename like 設計稿-a1b2c3d4.png"
    why_human: "Cannot invoke the upload endpoint in a sandboxed verification without a running server"
---

# Phase 44: Cache Storage Refactor — Verification Report

**Phase Goal:** Uploaded files are stored in structured year-month/type subdirectories with readable filenames that preserve the original name and include a UUID suffix for uniqueness
**Verified:** 2026-04-20T03:58:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `getAssistantCacheDir('images')` returns a path ending in `YYYY-MM/images/` and creates it | VERIFIED | `file-utils.ts:45-52` — constructs `DATA_ROOT/cache/assistant/YYYY-MM/images`, calls `fs.mkdirSync(dir, { recursive: true })` |
| 2 | `getAssistantCacheDir('files')` returns a path ending in `YYYY-MM/files/` | VERIFIED | Same function, `type` parameter defaults to `"images"`, accepts `"files"` per `CacheFileType` — `file-utils.ts:43,45` |
| 3 | `getAssistantCacheDir()` defaults to `'images'` type | VERIFIED | `file-utils.ts:45` — `type: CacheFileType = "images"` |
| 4 | `buildCacheFilename` preserves Chinese characters and alphanumerics in original name | VERIFIED | `file-utils.ts:80` — `[^\p{L}\p{N}]` Unicode property escape; test `NAME-01: preserves Chinese characters` passes |
| 5 | `buildCacheFilename` replaces spaces and special chars with underscore | VERIFIED | `file-utils.ts:80-82` — regex chain with `_+` collapse and trim; tests NAME-03 pass |
| 6 | `buildCacheFilename` falls back to `tower_image` prefix for meaningless names | VERIFIED | `file-utils.ts:60-77` — `MEANINGLESS_STEMS` Set + screenshot regex; tests NAME-02 pass |
| 7 | `buildCacheFilename` appends 8-char UUID suffix before extension | VERIFIED | `file-utils.ts:67` — `crypto.randomUUID().replace(/-/g, "").slice(0, 8)` |
| 8 | Upload route stores files under `YYYY-MM/images/` with readable filenames | VERIFIED | `images/route.ts:37-38` — calls `getAssistantCacheDir("images")` then `buildCacheFilename(file.name, ext)` |
| 9 | Upload response returns sub-path like `2026-04/images/name-uuid.png` as filename value | VERIFIED | `images/route.ts:49-51` — `path.relative(assistantRoot, dest)` returned as `cachePath` |
| 10 | Meaningless filenames produce `tower_image-{uuid}.png` | VERIFIED | `MEANINGLESS_STEMS` Set in `file-utils.ts:60-63`; 6 unit tests confirm behavior |
| 11 | Chat route uses `getAssistantCacheRoot()` for multimodal path resolution | VERIFIED | `chat/route.ts:5,106` — imports and calls `getAssistantCacheRoot()` |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/file-utils.ts` | `getAssistantCacheDir(type)`, `buildCacheFilename()`, `CacheFileType` type, `getAssistantCacheRoot()` | VERIFIED | All 4 exports present; file is 87 lines, substantive |
| `src/lib/__tests__/file-utils.test.ts` | Unit tests covering DIR-01~03 and NAME-01~03, min 60 lines | VERIFIED | 117 lines, 17 tests, all pass |
| `src/app/api/internal/assistant/images/route.ts` | Uses `getAssistantCacheDir` and `buildCacheFilename` | VERIFIED | Both imported and called at lines 6, 37–38 |
| `src/app/api/internal/assistant/chat/route.ts` | Uses `getAssistantCacheRoot()` | VERIFIED | Imported at line 5, called at line 106 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/lib/file-utils.ts` | `node:fs` | `fs.mkdirSync` with `{ recursive: true }` | WIRED | `file-utils.ts:50` — `fs.mkdirSync(dir, { recursive: true })` |
| `src/lib/file-utils.ts` | `node:crypto` | `crypto.randomUUID` in `buildCacheFilename` | WIRED | `file-utils.ts:67` — `crypto.randomUUID().replace(/-/g, "").slice(0, 8)` |
| `src/app/api/internal/assistant/images/route.ts` | `src/lib/file-utils.ts` | `import { getAssistantCacheDir, buildCacheFilename }` | WIRED | `images/route.ts:6` |
| `src/app/api/internal/assistant/images/route.ts` | `data/cache/assistant/YYYY-MM/images/` | `fs.promises.writeFile` to `dest` | WIRED | `images/route.ts:46` — `await fs.promises.writeFile(dest, buffer)` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `images/route.ts` | `filename` | `buildCacheFilename(file.name, ext)` | Yes — reads `file.name` from multipart upload | FLOWING |
| `images/route.ts` | `dir` | `getAssistantCacheDir("images")` | Yes — generates year-month path and creates dir | FLOWING |
| `images/route.ts` | `cachePath` | `path.relative(assistantRoot, dest)` | Yes — relative path of actual written file | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `getAssistantCacheDir` returns YYYY-MM/images path | `pnpm test:run file-utils.test.ts` (5 tests in DIR block) | 5 passing | PASS |
| `buildCacheFilename` preserves Chinese, sanitizes specials, detects meaningless names | `pnpm test:run file-utils.test.ts` (12 tests in buildCacheFilename block) | 12 passing | PASS |
| All 17 unit tests pass | `pnpm test:run --reporter=verbose src/lib/__tests__/file-utils.test.ts` | 17/17 passed, 711ms | PASS |
| `ensureAssistantCacheDir` fully removed from `src/` | `grep -rn ensureAssistantCacheDir src/` | No output | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| DIR-01 | 44-01-PLAN.md | 上传图片存储到 `data/cache/assistant/{year-month}/images/` 年月分组目录 | SATISFIED | `getAssistantCacheDir("images")` used in upload route; writes to `YYYY-MM/images/` path |
| DIR-02 | 44-01-PLAN.md | 缓存目录支持类型子目录（`images/`），为未来文件类型扩展预留 `files/` 结构 | SATISFIED | `CacheFileType = "images" | "files"` in `file-utils.ts:43`; `getAssistantCacheDir("files")` tested |
| DIR-03 | 44-01-PLAN.md | `getAssistantCacheDir()` 自动生成当前年月 + 类型的完整路径 | SATISFIED | `file-utils.ts:45-52` — auto-creates with `mkdirSync` |
| NAME-01 | 44-01-PLAN.md | 保留原始文件名，格式为 `{原始名}-{8位uuid}.{ext}` | SATISFIED | `buildCacheFilename` preserves stem, appends `-{8hex}` suffix |
| NAME-02 | 44-01-PLAN.md | 截图或无意义文件名使用 `tower_image-{8位uuid}.{ext}` | SATISFIED | `MEANINGLESS_STEMS` Set + screenshot regex → `tower_image-${uuid8}${ext}` |
| NAME-03 | 44-01-PLAN.md | 文件名清洗：保留中文和英文字母数字，空格和特殊字符替换为 `_` | SATISFIED | Unicode property escape `[^\p{L}\p{N}]` → `_`; collapse and trim |

No orphaned requirements. ROUTE-01/02/03 and ASSET-01 are explicitly mapped to Phase 45 and Phase 46 in REQUIREMENTS.md traceability table — they are out of scope for Phase 44.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/app/api/internal/assistant/chat/route.ts` | 47–51 | `IMAGE_FILENAME_RE` matches UUID-only filenames — rejects new sub-path format `YYYY-MM/images/name-uuid.ext` | Info | Images uploaded via new route will not render in chat until Phase 45 updates the regex. This is documented and intentional per SUMMARY 02 ("开发阶段无用户"). Does not block Phase 44 goal. |

No blocker anti-patterns. The `IMAGE_FILENAME_RE` issue is an acknowledged cross-phase dependency, not a Phase 44 gap.

### Human Verification Required

#### 1. End-to-end upload verification

**Test:** Start `pnpm dev`, open the assistant chat panel, paste an image from clipboard (e.g., a screenshot and a file with a Chinese name like 设计稿.png).
**Expected:** Files appear in `data/cache/assistant/YYYY-MM/images/` — screenshot produces `tower_image-{8hex}.png`; Chinese filename produces `设计稿-{8hex}.png`. Upload API response JSON contains `filename` like `"2026-04/images/tower_image-a1b2c3d4.png"`.
**Why human:** Cannot invoke the upload endpoint without a running Next.js server. Image display in chat will fail (known, Phase 45 fixes it) but storage path must be correct.

### Gaps Summary

No gaps. All 11 observable truths are verified. All 6 requirements (DIR-01~03, NAME-01~03) are satisfied with substantive, wired implementation backed by 17 passing unit tests. The `IMAGE_FILENAME_RE` UUID-only validator in `chat/route.ts` is a known and intentionally deferred cross-phase stub (documented in SUMMARY 02, scoped to Phase 45 as ROUTE-03). It does not affect the Phase 44 goal of structured storage with readable filenames.

---

_Verified: 2026-04-20T03:58:00Z_
_Verifier: Claude (gsd-verifier)_
