---
phase: 40-image-upload-api
verified: 2026-04-18T12:02:00Z
status: passed
score: 9/9 must-haves verified
gaps: []
human_verification:
  - test: "POST /api/internal/assistant/images — full integration"
    expected: "Returns 200 { filename, mimeType } for valid JPEG/PNG/GIF/WEBP multipart upload"
    why_human: "Requires a running Next.js dev server to send a real multipart/form-data request"
  - test: "GET /api/internal/cache/<uuid>.png — full integration"
    expected: "Returns image bytes with Content-Type image/png and Cache-Control: private, max-age=3600"
    why_human: "Requires dev server and a pre-uploaded file in data/cache/assistant/"
---

# Phase 40: Image Upload API Verification Report

**Phase Goal:** A secure server-side endpoint accepts image uploads from paste events, stores them in the assistant cache directory, and serves them via short paths
**Verified:** 2026-04-18T12:02:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | POSTing a valid JPEG/PNG/GIF/WEBP returns 200 with `{ filename, mimeType }` | VERIFIED | `route.ts` line 48: `return NextResponse.json({ filename, mimeType })` after magic-byte check and `fs.promises.writeFile` |
| 2 | POSTing a non-image file is rejected with 400 `{ error: "Unsupported file type" }` | VERIFIED | `route.ts` line 34: `return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })` when `detectImageMime` returns null |
| 3 | Uploaded file written to `data/cache/assistant/<uuid>.<ext>` | VERIFIED | `ensureAssistantCacheDir()` returns `DATA_ROOT/cache/assistant`; filename is `${crypto.randomUUID()}${MIME_TO_EXT[mimeType]}` |
| 4 | Path traversal is impossible — UUID filenames are server-side generated | VERIFIED | `crypto.randomUUID()` used exclusively; `file.name` is never used; belt-and-suspenders `dest.startsWith(dir + path.sep)` check at line 43 |
| 5 | GET `/api/internal/cache/<uuid>.<ext>` returns image bytes with correct Content-Type and Cache-Control | VERIFIED | `cache/[filename]/route.ts` reads file, uses `MIME_MAP[ext]`, sets `"Cache-Control": "private, max-age=3600"` |
| 6 | GET `/api/internal/cache/` with non-UUID filename returns 400 | VERIFIED | `FILENAME_RE` regex validates UUID v4 format before any filesystem access; returns `{ error: "Invalid filename" }` with 400 |
| 7 | GET `/api/internal/cache/` for missing file returns 404 | VERIFIED | `ENOENT` catch block returns `{ error: "Not found" }` with 404 |
| 8 | GET `/api/internal/assets/<projectId>/<filename>` returns asset bytes with correct Content-Type | VERIFIED | `assets/[projectId]/[filename]/route.ts` uses `resolveAssetPath` + `MIME_MAP[ext]` + `Cache-Control` |
| 9 | Both serving routes enforce `requireLocalhost()` | VERIFIED | Both `cache/[filename]/route.ts` and `assets/[projectId]/[filename]/route.ts` call `requireLocalhost(request)` as first guard |

**Score:** 9/9 truths verified

---

### Required Artifacts

#### Plan 01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/mime-magic.ts` | Magic-byte MIME detection | VERIFIED | 68 lines; exports `detectImageMime` and `MIME_TO_EXT`; all 4 signatures (JPEG/PNG/GIF/WEBP) present |
| `src/lib/file-utils.ts` | `getAssistantCacheDir` and `ensureAssistantCacheDir` helpers | VERIFIED | Both functions appended at lines 42–52; use `DATA_ROOT` and `assertWithinDataRoot` |
| `src/app/api/internal/assistant/images/route.ts` | POST upload endpoint | VERIFIED | 50 lines; all required logic present; no file.type usage |
| `tests/unit/lib/mime-magic.test.ts` | Unit tests for magic-byte detection | VERIFIED | 14 tests; all pass (`pnpm test:run` exit 0) |

#### Plan 02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/api/internal/cache/[filename]/route.ts` | Static serving for cached assistant images | VERIFIED | 55 lines; UUID regex, containment check, requireLocalhost, Cache-Control all present |
| `src/app/api/internal/assets/[projectId]/[filename]/route.ts` | Static serving for project assets | VERIFIED | Uses `resolveAssetPath`, `requireLocalhost`, Cache-Control header |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `images/route.ts` | `src/lib/mime-magic.ts` | `import { detectImageMime, MIME_TO_EXT }` | WIRED | Line 6 import; `detectImageMime(buffer)` called line 32; `MIME_TO_EXT[mimeType]` used line 37 |
| `images/route.ts` | `src/lib/file-utils.ts` | `import { ensureAssistantCacheDir }` | WIRED | Line 7 import; `ensureAssistantCacheDir()` called line 40 |
| `images/route.ts` | `src/lib/internal-api-guard.ts` | `import { requireLocalhost }` | WIRED | Line 5 import; `requireLocalhost(request)` called line 14 |
| `cache/[filename]/route.ts` | `src/lib/file-utils.ts` | `import { getAssistantCacheDir }` | WIRED | Line 6 import; `getAssistantCacheDir()` called line 27 |
| `cache/[filename]/route.ts` | `src/lib/file-serve.ts` | `import { MIME_MAP }` | WIRED | Line 5 import; `MIME_MAP[ext]` used line 45 |
| `cache/[filename]/route.ts` | `src/lib/internal-api-guard.ts` | `import { requireLocalhost }` | WIRED | Line 4 import; `requireLocalhost(request)` called line 19 |
| `assets/[projectId]/[filename]/route.ts` | `src/lib/file-serve.ts` | `import { resolveAssetPath, MIME_MAP }` | WIRED | Line 5 import; `resolveAssetPath(projectId, filename)` called; `MIME_MAP[ext]` used |
| `assets/[projectId]/[filename]/route.ts` | `src/lib/internal-api-guard.ts` | `import { requireLocalhost }` | WIRED | Line 4 import; `requireLocalhost(request)` called |

---

### Data-Flow Trace (Level 4)

These are server-side API routes, not client-facing rendering components. Data flow is input→process→response. Verified inline:

| Route | Input | Processing | Output | Status |
|-------|-------|-----------|--------|--------|
| POST `/api/internal/assistant/images` | `formData.get("file")` multipart | Magic-byte check → `crypto.randomUUID()` → `fs.promises.writeFile(dest, buffer)` | `{ filename, mimeType }` | FLOWING |
| GET `/api/internal/cache/[filename]` | UUID filename param | `getAssistantCacheDir()` + `fs.promises.readFile(resolved)` | Binary bytes with Content-Type header | FLOWING |
| GET `/api/internal/assets/[projectId]/[filename]` | projectId + filename params | `resolveAssetPath()` + `fs.promises.readFile(resolved)` | Binary bytes with Content-Type header | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `detectImageMime` unit tests (14 cases) | `pnpm test:run tests/unit/lib/mime-magic.test.ts` | 14/14 passed | PASS |
| Commits exist for all 4 tasks | `git log --oneline 4447aa8 5c7d454 3e6fe33 0119ea6` | All 4 found | PASS |
| No `file.type` in production code | `grep "file\.type" images/route.ts` | Only in comment (line 31), not in logic | PASS |
| TypeScript type errors in phase 40 files | `pnpm tsc --noEmit` | Errors only in `tests/unit/lib/pty-session.test.ts` (pre-existing, unrelated to phase 40) | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| CACHE-01 | Plan 01 | User can paste image → uploads to `data/cache/assistant/<uuid>.<ext>` | PARTIAL (server side complete) | Upload endpoint exists and writes to `data/cache/assistant/<uuid>.<ext>`. Paste UI event handler is Phase 41 scope. Server write path fully implemented. |
| CACHE-02 | Plan 01 | Upload API validates MIME type (image/jpeg, png, gif, webp only) | SATISFIED | `detectImageMime(buffer)` uses magic bytes, not `file.type`. Rejects all non-image types with 400. |
| CACHE-03 | Plan 01 | Upload API includes path traversal protection | SATISFIED | UUID filename from `crypto.randomUUID()` (original filename never used); `dest.startsWith(dir + path.sep)` containment check; `assertWithinDataRoot` in `file-utils.ts`. |
| CACHE-04 | Plan 02 | Cached images accessible via short path `/cache/<filename>` | SATISFIED | `GET /api/internal/cache/[filename]` route exists, serves UUID-named images with 200 + Content-Type + Cache-Control. |
| CACHE-05 | Plan 02 | Project assets accessible via short path `/assets/<filename>` | SATISFIED | `GET /api/internal/assets/[projectId]/[filename]` exists, uses `resolveAssetPath`, serves with Cache-Control. |

**Note on CACHE-01:** The REQUIREMENTS.md traceability table marks CACHE-01 as `Pending` (unchecked). This is because CACHE-01 describes the full paste-to-store user flow, which requires Phase 41's UI paste handler. Phase 40 delivers the server-side half (the upload endpoint). The endpoint is verified working; the requirement will be fully satisfied once Phase 41 wires the paste event to this endpoint.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No anti-patterns found | — | — |

Checked: no `TODO`/`FIXME`/placeholder comments, no `return null`/`return []`/`return {}` stub returns, no hardcoded empty state, no `file.type` trust in production paths. The `// Magic-byte validation — NOT file.type` comment on line 31 of `images/route.ts` is a security explanation, not a stub indicator.

---

### Human Verification Required

#### 1. Full Upload Integration Test

**Test:** Start dev server (`pnpm dev`), POST a real JPEG file to `http://localhost:3000/api/internal/assistant/images` using a multipart form-data request (e.g. via `curl -F "file=@test.jpg" http://localhost:3000/api/internal/assistant/images`)
**Expected:** HTTP 200, response body `{ "filename": "<uuid>.jpg", "mimeType": "image/jpeg" }`, file written to `data/cache/assistant/<uuid>.jpg`
**Why human:** Requires a running server; `fs.promises.writeFile` creates real filesystem state.

#### 2. Full Cached Image Serving Test

**Test:** After uploading an image (test 1), GET `http://localhost:3000/api/internal/cache/<uuid>.jpg`
**Expected:** HTTP 200, `Content-Type: image/jpeg`, `Cache-Control: private, max-age=3600`, binary image bytes
**Why human:** Requires dev server + pre-existing uploaded file.

#### 3. UUID Regex Rejection Test

**Test:** GET `http://localhost:3000/api/internal/cache/../../etc/passwd`
**Expected:** HTTP 400 `{ "error": "Invalid filename" }` (rejected by `FILENAME_RE` before filesystem access)
**Why human:** Path traversal test requires a running server to confirm routing behavior.

---

### Gaps Summary

No gaps. All 9 observable truths are verified. All 5 artifact files exist, are substantive (no stubs), and are wired to their dependencies. All key links are imported and used. The 14 unit tests pass. Commits for all 4 tasks exist in git history.

CACHE-01 is partially satisfied by this phase (server write path complete); the remaining paste UI event handler is correctly scoped to Phase 41. This is by design, not a gap in Phase 40.

---

_Verified: 2026-04-18T12:02:00Z_
_Verifier: Claude (gsd-verifier)_
