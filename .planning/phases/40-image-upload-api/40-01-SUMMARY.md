---
phase: 40-image-upload-api
plan: "01"
subsystem: assistant-media
tags: [image-upload, mime-detection, file-utils, api, security]
dependency_graph:
  requires: []
  provides:
    - src/lib/mime-magic.ts (detectImageMime, MIME_TO_EXT)
    - src/lib/file-utils.ts (getAssistantCacheDir, ensureAssistantCacheDir)
    - src/app/api/internal/assistant/images/route.ts (POST upload endpoint)
  affects:
    - future plans that send images to Claude SDK (phase 43)
tech_stack:
  added: []
  patterns:
    - Magic-byte MIME detection (no browser file.type trust)
    - UUID-named cache files (path traversal prevention)
    - requireLocalhost guard on internal API routes
key_files:
  created:
    - src/lib/mime-magic.ts
    - src/app/api/internal/assistant/images/route.ts
    - tests/unit/lib/mime-magic.test.ts
  modified:
    - src/lib/file-utils.ts
decisions:
  - Magic bytes over file.type — prevents SVG-as-PNG XSS and content-type spoofing
  - UUID filename server-side — original filename never used, path traversal impossible
  - Reuse getConfigValue("system.maxUploadBytes") — consistent with existing uploadAsset pattern
metrics:
  duration: "165s"
  completed: "2026-04-18"
  tasks_completed: 2
  files_changed: 4
---

# Phase 40 Plan 01: Image Upload API Summary

Magic-byte MIME detection utility, assistant cache directory helpers, and a secure multipart upload endpoint stored as UUID-named files at `data/cache/assistant/`.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Create mime-magic utility and file-utils helpers | 4447aa8 |
| 2 | Create POST /api/internal/assistant/images upload route | 5c7d454 |

## What Was Built

**`src/lib/mime-magic.ts`** — Pure magic-byte image detector. Inspects raw buffer bytes for JPEG (FF D8 FF), PNG (89 50 4E 47), GIF (47 49 46), and WEBP (RIFF....WEBP) signatures. Returns `null` for anything else including PDFs, SVGs, and short buffers (<12 bytes). Exports `detectImageMime(buffer)` and `MIME_TO_EXT` mapping.

**`src/lib/file-utils.ts`** (additions) — Two new exported helpers appended to the existing file without modifying any existing code: `getAssistantCacheDir()` returns `data/cache/assistant/` with path traversal assertion, `ensureAssistantCacheDir()` creates and returns the directory.

**`src/app/api/internal/assistant/images/route.ts`** — POST upload endpoint:
- Localhost-only guard via `requireLocalhost()`
- Size limit from `getConfigValue("system.maxUploadBytes", 52428800)` (consistent with `uploadAsset`)
- Magic-byte MIME validation — never trusts `file.type`
- UUID filename from `crypto.randomUUID()` — original filename discarded
- Belt-and-suspenders path containment check
- Returns `{ filename, mimeType }` on success, 400 with descriptive error on rejection

**`tests/unit/lib/mime-magic.test.ts`** — 14 unit tests covering all 4 image types, PDF rejection, SVG rejection, empty buffer, short buffer, all-zero buffer, and MIME_TO_EXT map entries.

## Verification Results

- `pnpm test:run tests/unit/lib/mime-magic.test.ts`: 14/14 tests passed
- `grep -c "detectImageMime" route.ts`: 2 (import + usage)
- `grep -c "requireLocalhost" route.ts`: 2 (import + usage)
- `grep -c "ensureAssistantCacheDir" file-utils.ts`: 1
- No `file.type` in production code (only in comment)
- Full `tsc --noEmit` passes with no errors in our files

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — the upload endpoint is fully functional. It reads, validates, and writes image files.

## Self-Check: PASSED

Files verified:
- FOUND: src/lib/mime-magic.ts
- FOUND: src/lib/file-utils.ts (modified)
- FOUND: src/app/api/internal/assistant/images/route.ts
- FOUND: tests/unit/lib/mime-magic.test.ts

Commits verified:
- FOUND: 4447aa8 — Task 1
- FOUND: 5c7d454 — Task 2
