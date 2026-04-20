---
phase: 45-route-frontend-adaptation
verified: 2026-04-20T12:20:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 45: Route & Frontend Adaptation Verification Report

**Phase Goal:** The cache file serving route supports subpath access so the new year-month/type directory structure is reachable, and all frontend references use the correct full subpath
**Verified:** 2026-04-20T12:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                              | Status     | Evidence                                                                                                          |
|----|----------------------------------------------------------------------------------------------------|------------|-------------------------------------------------------------------------------------------------------------------|
| 1  | GET /api/internal/cache/2026-04/images/foo.png resolves to the correct file in data/cache/assistant/2026-04/images/foo.png | ✓ VERIFIED | `[...segments]/route.ts` joins segments, validates SUBPATH_RE, resolves via `getAssistantCacheRoot()` + `path.resolve` |
| 2  | Path traversal via segments like `['..','..','etc','passwd']` is rejected with 400                | ✓ VERIFIED | SUBPATH_RE rejects non-matching paths; containment check `resolved.startsWith(cacheRoot + path.sep)` returns 400 |
| 3  | Frontend image URLs using sub-path filenames (e.g. 2026-04/images/xxx.png) render correctly       | ✓ VERIFIED | `AssistantChatBubble` builds `url = /api/internal/cache/${filename}` where `filename` is the sub-path returned by the upload route |
| 4  | buildMultimodalPrompt accepts sub-path filenames and resolves them to absolute filesystem paths    | ✓ VERIFIED | `SAFE_SUBPATH_RE` validates, `path.resolve(cacheDir, subPath)` constructs absolute path; 11/11 tests pass        |
| 5  | Chat route IMAGE_FILENAME_RE accepts sub-path format filenames and passes them to buildMultimodalPrompt | ✓ VERIFIED | Line 47-48: regex `/^\d{4}-\d{2}\/(images|files)\/[^/]+\.(jpg|jpeg|png|gif|webp)$/i`; passed to `buildMultimodalPrompt(prompt, safeImageFilenames, getAssistantCacheRoot())` at line 106 |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact                                                        | Expected                               | Status     | Details                                                                       |
|-----------------------------------------------------------------|----------------------------------------|------------|-------------------------------------------------------------------------------|
| `src/app/api/internal/cache/[...segments]/route.ts`            | Catch-all cache serving route          | ✓ VERIFIED | Exists; contains SUBPATH_RE, segments join, containment check, MIME_MAP usage |
| `src/lib/build-multimodal-prompt.ts`                            | Sub-path aware multimodal prompt builder | ✓ VERIFIED | Contains `SAFE_SUBPATH_RE`; no `SAFE_FILENAME_RE`                            |
| `src/app/api/internal/assistant/chat/route.ts`                  | Sub-path aware image filename validation | ✓ VERIFIED | Contains `IMAGE_FILENAME_RE` with `^\d{4}-\d{2}/(images|files)/` pattern     |
| `src/app/api/internal/cache/[filename]/route.ts`                | MUST NOT exist (deleted)               | ✓ VERIFIED | Confirmed absent; `ls` returns no match                                       |

### Key Link Verification

| From                                          | To                                         | Via                                           | Status     | Details                                                              |
|-----------------------------------------------|--------------------------------------------|-----------------------------------------------|------------|----------------------------------------------------------------------|
| `src/app/api/internal/assistant/chat/route.ts` | `src/lib/build-multimodal-prompt.ts`       | `buildMultimodalPrompt` call with sub-path filenames | ✓ WIRED | Line 4 import; line 106 call: `buildMultimodalPrompt(prompt, safeImageFilenames, getAssistantCacheRoot())` |
| `src/app/api/internal/cache/[...segments]/route.ts` | `data/cache/assistant/YYYY-MM/images/` | `path.resolve(cacheRoot, subPath)`             | ✓ WIRED    | `getAssistantCacheRoot()` at line 31; `path.resolve(cacheRoot, subPath)` at line 32 |

### Data-Flow Trace (Level 4)

| Artifact                              | Data Variable    | Source                                                | Produces Real Data | Status     |
|---------------------------------------|------------------|-------------------------------------------------------|--------------------|------------|
| `assistant-chat-bubble.tsx`            | `filename` prop  | Upload route `/api/internal/assistant/images` returns `{ filename: cachePath }` where `cachePath = path.relative(assistantRoot, dest)` — real sub-path from disk | Yes | ✓ FLOWING |
| `[...segments]/route.ts`              | `bytes` (file)   | `fs.promises.readFile(resolved)` — reads actual file from disk | Yes | ✓ FLOWING |
| `build-multimodal-prompt.ts`           | `validPaths`     | `fs.existsSync(absPath)` gates real file existence; path constructed from `cacheDir + subPath` | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior                                     | Command                                                                 | Result     | Status  |
|----------------------------------------------|-------------------------------------------------------------------------|------------|---------|
| All build-multimodal-prompt tests pass (11) | `pnpm test:run src/lib/__tests__/build-multimodal-prompt.test.ts`      | 11/11 pass | ✓ PASS  |
| Old [filename] route removed                 | `ls src/app/api/internal/cache/[filename]/ 2>/dev/null`                | Not found  | ✓ PASS  |
| New [...segments] route exists               | `ls src/app/api/internal/cache/[...segments]/route.ts`                 | Found      | ✓ PASS  |
| No flat UUID .png files in cache root        | `ls data/cache/assistant/*.png`                                         | No matches | ✓ PASS  |
| Commits f77d7ad and cc94eda exist            | `git show f77d7ad --stat && git show cc94eda --stat`                   | Both found | ✓ PASS  |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                    | Status     | Evidence                                                                 |
|-------------|-------------|--------------------------------------------------------------------------------|------------|--------------------------------------------------------------------------|
| ROUTE-01    | 45-01-PLAN  | cache 服务路由改为 catch-all，支持子路径（`/api/internal/cache/2026-04/images/xxx.png`） | ✓ SATISFIED | `[...segments]/route.ts` exists with SUBPATH_RE and catch-all params    |
| ROUTE-02    | 45-01-PLAN  | 前端 `<img src>` 使用完整子路径（含年月和类型目录）                              | ✓ SATISFIED | Upload route returns sub-path; `AssistantChatBubble` constructs URL as `/api/internal/cache/${filename}` |
| ROUTE-03    | 45-01-PLAN  | `buildMultimodalPrompt` 使用完整子路径拼接绝对路径                              | ✓ SATISFIED | `SAFE_SUBPATH_RE` in `build-multimodal-prompt.ts`; `path.resolve(cacheDir, subPath)` |

No orphaned requirements — all three ROUTE-0x IDs are claimed by 45-01-PLAN and verified against the codebase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found | — | — |

No TODO/FIXME, no empty return stubs, no hardcoded empty arrays flowing to renders, no placeholder comments detected in the three modified files.

### Human Verification Required

#### 1. End-to-End Upload and Render Flow

**Test:** Open the assistant chat, attach a real image file (JPEG or PNG), send a message, and confirm the attached image thumbnail renders correctly in the chat bubble.
**Expected:** The image appears as a 64x64 thumbnail using a URL like `/api/internal/cache/2026-04/images/filename.png`. No broken-image icon.
**Why human:** Requires a running dev server and browser interaction; cannot be verified by static analysis.

#### 2. Path Traversal Rejection in Browser

**Test:** Send a direct GET request to `/api/internal/cache/../../etc/passwd` from the browser or curl.
**Expected:** Returns HTTP 400 with `{ "error": "Invalid path" }`.
**Why human:** Localhost-only guard means this can only be tested from the local machine against a running server.

#### 3. Chinese Filename Round-Trip

**Test:** Upload an image with a Chinese character in the filename (e.g., `设计稿.png`), confirm the upload succeeds and the thumbnail renders without 404.
**Expected:** URL like `/api/internal/cache/2026-04/images/设计稿-a1b2c3d4.png` resolves correctly without double-encoding issues.
**Why human:** URL encoding behavior with CJK characters in catch-all routes requires visual browser verification.

### Gaps Summary

No gaps found. All five observable truths verified, all three required artifacts exist and are substantive, all key links are wired with real data flowing through them, and all three requirements (ROUTE-01, ROUTE-02, ROUTE-03) are satisfied by concrete implementation evidence.

---

_Verified: 2026-04-20T12:20:00Z_
_Verifier: Claude (gsd-verifier)_
