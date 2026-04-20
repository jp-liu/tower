---
phase: 40
plan: 02
subsystem: image-upload-api
tags: [api, file-serving, static-files, internal-routes, security]
dependency_graph:
  requires:
    - src/lib/file-serve.ts (MIME_MAP, resolveAssetPath)
    - src/lib/file-utils.ts (getAssistantCacheDir — added in this plan)
    - src/lib/internal-api-guard.ts (requireLocalhost)
  provides:
    - GET /api/internal/cache/[filename] — serves cached assistant images
    - GET /api/internal/assets/[projectId]/[filename] — serves project assets (internal)
  affects:
    - Phase 41 (chat bubble rendering — will use these URLs to display images)
    - Phase 43 (SDK integration — images fetched via these routes)
tech_stack:
  added: []
  patterns:
    - UUID filename regex validation (prevents path traversal)
    - Magic-header containment check (dir + path.sep prefix)
    - Cache-Control: private, max-age=3600 for immutable UUID filenames
key_files:
  created:
    - src/app/api/internal/cache/[filename]/route.ts
    - src/app/api/internal/assets/[projectId]/[filename]/route.ts
  modified:
    - src/lib/file-utils.ts (added getAssistantCacheDir, ensureAssistantCacheDir)
decisions:
  - "Added getAssistantCacheDir/ensureAssistantCacheDir to file-utils.ts in this plan (Plan 01 dependency not yet committed)"
  - "Cache route uses UUID regex (FILENAME_RE) to reject non-UUID filenames before filesystem access — belt-and-suspenders on top of path.resolve containment"
  - "Assets internal route mirrors existing public route pattern; the internal route adds requireLocalhost() guard that the public route lacks"
metrics:
  duration: 66s
  completed_date: "2026-04-18"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 1
---

# Phase 40 Plan 02: Static File Serving Routes for Cached Images and Project Assets Summary

Two internal GET routes for serving static files used by the assistant chat feature: one for cached assistant images and one for project assets, both with localhost guard, correct Content-Type, and Cache-Control headers.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Create GET /api/internal/cache/[filename] route | 3e6fe33 | src/app/api/internal/cache/[filename]/route.ts, src/lib/file-utils.ts |
| 2 | Create GET /api/internal/assets/[projectId]/[filename] route | 0119ea6 | src/app/api/internal/assets/[projectId]/[filename]/route.ts |

## What Was Built

### Cache Route (`/api/internal/cache/[filename]`)

Serves UUID-named image files from `data/cache/assistant/`. Key security properties:

- `FILENAME_RE` regex validates filename matches `<uuid>.<ext>` pattern before any filesystem access — rejects path traversal and arbitrary filenames with 400
- `path.resolve()` + `startsWith(dir + path.sep)` containment check as belt-and-suspenders
- `requireLocalhost()` enforced (per `.claude/rules/security.md` requirement for all `/api/internal/` routes)
- `Cache-Control: private, max-age=3600` — UUID filenames are content-addressed and immutable
- Returns 404 with `{ error: "Not found" }` for missing files
- Returns 400 with `{ error: "Invalid filename" }` for non-UUID filenames

### Assets Route (`/api/internal/assets/[projectId]/[filename]`)

Internal parallel to the existing public `/api/files/assets/[projectId]/[filename]` route. Differences:

- Adds `requireLocalhost()` guard (the public route lacks this)
- Adds `Cache-Control: private, max-age=3600` header
- Uses `export const dynamic` and `export const runtime` declarations

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added getAssistantCacheDir/ensureAssistantCacheDir to file-utils.ts**
- **Found during:** Task 1
- **Issue:** Plan 02 depends on `getAssistantCacheDir()` from `file-utils.ts`, added by Plan 01. Plan 01 had not yet been executed in this worktree.
- **Fix:** Added both `getAssistantCacheDir()` and `ensureAssistantCacheDir()` to `src/lib/file-utils.ts` following the existing patterns (uses `DATA_ROOT` and `assertWithinDataRoot` already defined in that file)
- **Files modified:** src/lib/file-utils.ts
- **Commit:** 3e6fe33

## Self-Check: PASSED

- FOUND: src/app/api/internal/cache/[filename]/route.ts
- FOUND: src/app/api/internal/assets/[projectId]/[filename]/route.ts
- FOUND: commit 3e6fe33 (Task 1)
- FOUND: commit 0119ea6 (Task 2)
