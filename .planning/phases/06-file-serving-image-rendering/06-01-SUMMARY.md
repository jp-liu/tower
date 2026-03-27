---
phase: 06-file-serving-image-rendering
plan: "01"
subsystem: file-serving
tags: [security, api, file-serving, image-rendering, react-markdown]
dependency_graph:
  requires:
    - 04-01 (file-utils: getAssetsDir, DATA_ROOT pattern)
    - 05-01 (manage_assets: stores files in data/assets/)
  provides:
    - GET /api/files/assets/[projectId]/[filename] route
    - resolveAssetPath (path traversal guard)
    - localPathToApiUrl (data/assets path to /api/files URL)
    - img component override in task conversation
  affects:
    - src/components/task/task-conversation.tsx (img rendering)
    - All future phases that serve files via HTTP
tech_stack:
  added:
    - "node:fs promises API for async file reads"
    - "node:path for path traversal guard"
  patterns:
    - "path.resolve + safePrefix startsWith check for traversal prevention"
    - "TDD: RED (failing test) → GREEN (implementation) → verify"
    - "React component override pattern in ReactMarkdown components prop"
key_files:
  created:
    - src/lib/file-serve.ts
    - src/app/api/files/assets/[projectId]/[filename]/route.ts
    - tests/unit/api/file-serving.test.ts
    - tests/unit/lib/local-path-to-api-url.test.ts
  modified:
    - src/components/task/task-conversation.tsx
decisions:
  - "Used path.resolve + safePrefix (DATA_ROOT + path.sep) pattern for traversal prevention — identical approach to file-utils.ts DATA_ROOT for consistency"
  - "localPathToApiUrl implemented in file-serve.ts alongside resolveAssetPath to keep all file-path utilities co-located"
  - "Used raw Response (not NextResponse) for binary file serving to avoid JSON wrapper overhead"
  - "Pre-existing test failures (board-stats, prompts-config) are out of scope — confirmed failing before this plan"
metrics:
  duration: "187 seconds (~3 minutes)"
  completed: "2026-03-27T09:42:58Z"
  tasks_completed: 2
  files_created: 4
  files_modified: 1
---

# Phase 06 Plan 01: File Serving and Image Rendering Summary

**One-liner:** Secure file serving API route with path traversal prevention + ReactMarkdown img override transforming data/assets/ paths to /api/files/ URLs.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | File serving helper and route handler with tests | 72599a8 | src/lib/file-serve.ts, src/app/api/files/assets/[projectId]/[filename]/route.ts, tests/unit/api/file-serving.test.ts |
| 2 | Image path transform helper and ReactMarkdown img override | 03c80d3 | tests/unit/lib/local-path-to-api-url.test.ts, src/components/task/task-conversation.tsx |

## What Was Built

### src/lib/file-serve.ts

Pure helper module with three exports:

- `MIME_MAP` — maps 10 file extensions to correct Content-Type values; unknown extensions fall back to `application/octet-stream`
- `resolveAssetPath(projectId, filename)` — resolves to absolute path under `data/assets/`, returns `{ resolved: null, error: "Invalid path" }` for any traversal attempt using `path.resolve + startsWith(safePrefix)` guard
- `localPathToApiUrl(src)` — transforms `data/assets/{projectId}/{filename}` patterns to `/api/files/assets/{projectId}/{filename}`; HTTP/HTTPS URLs and non-matching strings pass through unchanged

### src/app/api/files/assets/[projectId]/[filename]/route.ts

GET route handler:
- Awaits `params` (Next.js 16 pattern) to get `projectId` and `filename`
- Calls `resolveAssetPath` — returns 400 JSON on traversal
- Reads file with `fs.promises.readFile` — returns 404 JSON on ENOENT
- Returns raw `Response` (not NextResponse) with correct `Content-Type` from `MIME_MAP`

### src/components/task/task-conversation.tsx

Added `components` prop to `ReactMarkdown` in the assistant message renderer:
- `img` override calls `localPathToApiUrl(src)` to rewrite data/assets paths to API URLs
- Applies `max-w-full rounded-md my-2` classes for responsive image rendering
- Uses `loading="lazy"` for performance
- User and system message rendering unchanged

## Test Results

- `tests/unit/api/file-serving.test.ts` — 14 tests passing (resolveAssetPath + MIME_MAP)
- `tests/unit/lib/local-path-to-api-url.test.ts` — 7 tests passing (all transform and passthrough cases)
- Full suite: 21 new tests passing, no regressions in existing passing tests

## Deviations from Plan

### Pre-existing Test Failures (Out of Scope)

Tests `board-stats.test.tsx` and `prompts-config.test.tsx` were already failing before this plan (confirmed via `git stash`). These 11 failures are unrelated to file serving and are tracked separately. No fix attempted per deviation boundary rules.

## Known Stubs

None — all functionality is fully wired. The file serving route reads real files from disk; the img override passes URLs through `localPathToApiUrl` which is fully implemented.

## Self-Check: PASSED

All created files exist on disk. Both task commits (72599a8, 03c80d3) found in git history.
