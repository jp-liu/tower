---
phase: 45-route-frontend-adaptation
plan: 01
subsystem: cache-serving
tags: [route, cache, multimodal, regex, validation]
dependency_graph:
  requires: [44-02]
  provides: [ROUTE-01, ROUTE-02, ROUTE-03]
  affects: [assistant-chat, build-multimodal-prompt, cache-serve-route]
tech_stack:
  added: []
  patterns: [catch-all-route, sub-path-validation, path-containment-check]
key_files:
  created:
    - src/app/api/internal/cache/[...segments]/route.ts
  modified:
    - src/lib/build-multimodal-prompt.ts
    - src/app/api/internal/assistant/chat/route.ts
    - src/lib/__tests__/build-multimodal-prompt.test.ts
  deleted:
    - src/app/api/internal/cache/[filename]/route.ts
    - data/cache/assistant/b415b3ca-3fe4-4260-8d1c-bfb69ef4d42f.png (untracked)
    - data/cache/assistant/da7798ca-4ab2-4d26-b183-7ee02f60ddad.png (untracked)
decisions:
  - SUBPATH_RE uses [^/]+ for filename segment to support Unicode/Chinese characters in filenames
  - getAssistantCacheRoot() used in catch-all route (not getAssistantCacheDir which creates directories)
  - Next.js auto-decodes URL-encoded segments so decodeURIComponent is not needed
  - Old flat UUID cache files were untracked data files, not in git history
metrics:
  duration: ~8 minutes
  completed_date: "2026-04-20"
  tasks_completed: 3
  files_changed: 5
---

# Phase 45 Plan 01: Route & Frontend Adaptation Summary

**One-liner:** Catch-all cache route + YYYY-MM/type/filename sub-path validation replacing UUID-only regex, closing the Phase 44 upload-to-display chain gap.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Replace [filename] route with [...segments] catch-all | f77d7ad | `src/app/api/internal/cache/[...segments]/route.ts` (created), `[filename]/route.ts` (deleted) |
| 2 | Update validation regexes + fix tests | cc94eda | `build-multimodal-prompt.ts`, `chat/route.ts`, `build-multimodal-prompt.test.ts` |
| 3 | Delete old flat-path cache files + verify chain | (no tracked files changed) | `data/cache/assistant/*.png` deleted (were untracked) |

## What Was Built

### Task 1: Catch-All Cache Route

Replaced `src/app/api/internal/cache/[filename]/route.ts` (single-segment, UUID-only) with `src/app/api/internal/cache/[...segments]/route.ts` (catch-all, sub-path aware):

- `SUBPATH_RE = /^\d{4}-\d{2}\/(images|files)\/[^/]+\.(jpg|jpeg|png|gif|webp)$/i`
- Joins segments array with `/` to reconstruct sub-path like `2026-04/images/foo.png`
- Uses `getAssistantCacheRoot()` for base path (does not create directories)
- Path containment check: `resolved.startsWith(cacheRoot + path.sep)`
- Returns 400 on invalid path, 404 on ENOENT, correct MIME types via MIME_MAP

### Task 2: Regex Updates + Tests

Updated both validation regexes from UUID-only to sub-path format:

- `src/lib/build-multimodal-prompt.ts`: `SAFE_FILENAME_RE` → `SAFE_SUBPATH_RE`
- `src/app/api/internal/assistant/chat/route.ts`: `IMAGE_FILENAME_RE` updated to sub-path regex

Test file updated with:
- `UUID1/2/3` → `SUBPATH1/2/3` constants using `2026-04/images/name-uuid.ext` format
- `CACHE_DIR` updated to `/abs/cache/assistant` (assistant cache root)
- `manyImages` uses sub-path format in the 10-image cap test
- "rejects filenames that don't match UUID format" renamed to "rejects filenames that don't match sub-path format"
- New test: "accepts sub-paths with Chinese characters" (设计稿-a1b2c3d4.png) — passes
- All 11 tests pass

### Task 3: Old Cache File Cleanup

Deleted 2 flat-path UUID cache files from `data/cache/assistant/`:
- `b415b3ca-3fe4-4260-8d1c-bfb69ef4d42f.png`
- `da7798ca-4ab2-4d26-b183-7ee02f60ddad.png`

These were untracked data files (not in git). No subdirectories exist yet; the directory is now empty awaiting new uploads in the sub-path structure.

## Deviations from Plan

None — plan executed exactly as written.

Pre-existing test failures (8 test files: pty-session, preview-process-manager, instrumentation, component tests) were present before this plan and are out of scope. Our 11 `build-multimodal-prompt` tests all pass.

## Verification

- `src/app/api/internal/cache/[...segments]/route.ts` exists with SUBPATH_RE
- `src/app/api/internal/cache/[filename]/route.ts` does NOT exist
- `SAFE_SUBPATH_RE` in `build-multimodal-prompt.ts`, no `SAFE_FILENAME_RE`
- `IMAGE_FILENAME_RE` in chat route matches `^\d{4}-\d{2}/(images|files)/`
- 11/11 `build-multimodal-prompt` tests pass
- No flat `.png` files in `data/cache/assistant/`
- TypeScript errors limited to pre-existing pty-session test file only

## Known Stubs

None.

## Self-Check: PASSED

- `src/app/api/internal/cache/[...segments]/route.ts` — FOUND
- Task 1 commit f77d7ad — FOUND
- Task 2 commit cc94eda — FOUND
- SAFE_SUBPATH_RE in build-multimodal-prompt.ts — FOUND
- 11 tests pass — VERIFIED
