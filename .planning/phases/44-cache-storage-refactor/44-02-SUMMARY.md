---
phase: 44-cache-storage-refactor
plan: 02
subsystem: api
tags: [images-upload, chat-route, file-utils, cache, multimodal]

# Dependency graph
requires:
  - "44-01: getAssistantCacheDir(type), buildCacheFilename() from file-utils.ts"
provides:
  - "Upload route stores files in data/cache/assistant/YYYY-MM/images/ with readable filenames"
  - "Upload response returns sub-path (e.g., 2026-04/images/设计稿-a1b2c3d4.png)"
  - "getAssistantCacheRoot() exported from file-utils.ts"
  - "Chat route resolves sub-path filenames against assistant cache root"
affects: [45-route-frontend-adaptation, src/app/api/internal/assistant/images/route.ts, src/app/api/internal/assistant/chat/route.ts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Upload returns sub-path relative to assistant cache root for forward compatibility"
    - "getAssistantCacheRoot() as stable base for sub-path resolution in multimodal prompts"

key-files:
  created: []
  modified:
    - src/app/api/internal/assistant/images/route.ts
    - src/app/api/internal/assistant/chat/route.ts
    - src/lib/file-utils.ts

key-decisions:
  - "getAssistantCacheRoot() added to file-utils.ts to provide stable base path for sub-path joining in buildMultimodalPrompt"
  - "Upload response filename field now returns YYYY-MM/images/name-uuid.ext sub-path (not bare UUID) — Phase 45 will update serve route to accept sub-paths"
  - "IMAGE_FILENAME_RE in chat route left as-is — it blocks new sub-path filenames, but this is acceptable per plan (开发阶段无用户, Phase 45 fixes the full chain)"

# Metrics
duration: ~2min
completed: 2026-04-20
---

# Phase 44 Plan 02: Cache Storage Refactor — Wire Helpers into Upload & Chat Routes Summary

**Upload route switched to `getAssistantCacheDir("images")` + `buildCacheFilename()` for structured paths and readable filenames; chat route switched to `getAssistantCacheRoot()` so sub-path filenames resolve correctly in multimodal prompts**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-20T03:53:22Z
- **Completed:** 2026-04-20T03:55:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Updated `images/route.ts` to use `getAssistantCacheDir("images")` for year-month/type directory selection
- Updated `images/route.ts` to use `buildCacheFilename(file.name, ext)` for readable filename generation (replaces `crypto.randomUUID()`)
- Upload response now returns sub-path relative to assistant cache root (e.g., `2026-04/images/设计稿-a1b2c3d4.png`)
- Added `getAssistantCacheRoot()` to `src/lib/file-utils.ts` returning the stable `data/cache/assistant/` base
- Updated `chat/route.ts` to call `getAssistantCacheRoot()` instead of `getAssistantCacheDir()` so `path.join(root, subPath)` resolves sub-path filenames to correct absolute paths
- All 17 Plan 01 unit tests still pass
- `ensureAssistantCacheDir` fully removed from `src/`

## Task Commits

Each task was committed atomically:

1. **Task 1: Update images upload route** - `6204118` (feat)
2. **Task 2: Add getAssistantCacheRoot and update chat route** - `f596185` (feat)

## Files Created/Modified

- `src/app/api/internal/assistant/images/route.ts` — Replaced `ensureAssistantCacheDir` + `crypto.randomUUID` with `getAssistantCacheDir("images")` + `buildCacheFilename(file.name, ext)`; response returns sub-path via `path.relative(assistantRoot, dest)`
- `src/app/api/internal/assistant/chat/route.ts` — Changed import from `getAssistantCacheDir` to `getAssistantCacheRoot`; updated `buildMultimodalPrompt` call
- `src/lib/file-utils.ts` — Added `getAssistantCacheRoot()` export returning `data/cache/assistant/` without year-month subdir

## Decisions Made

- `getAssistantCacheRoot()` added as minimal export — returns path without creating directories (unlike `getAssistantCacheDir` which auto-mkdirs)
- Upload sub-path format `YYYY-MM/images/filename.ext` is forward-compatible: Phase 45 will make the serve route accept this as a catch-all path parameter

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

- **`IMAGE_FILENAME_RE` in `chat/route.ts`** (lines 47-51): This UUID-only regex will reject new sub-path filenames like `2026-04/images/设计稿-a1b2c3d4.png`, preventing them from reaching `buildMultimodalPrompt`. This is intentional per the plan — the full chain fix (serve route + filename validation in chat) is Phase 45's scope. Between Phase 44 and Phase 45, newly uploaded images will not display in chat (acceptable: dev stage, no users).

## Issues Encountered

None.

## Next Phase Readiness

- Phase 45 can now update the serve route to a catch-all (`/api/internal/cache/[...path]`) that accepts sub-path filenames
- Phase 45 should also update `IMAGE_FILENAME_RE` in `chat/route.ts` to accept the new `YYYY-MM/type/filename.ext` format
- No blockers

## Self-Check

---
*Phase: 44-cache-storage-refactor*
*Completed: 2026-04-20*
