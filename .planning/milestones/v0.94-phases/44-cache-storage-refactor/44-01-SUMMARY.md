---
phase: 44-cache-storage-refactor
plan: 01
subsystem: api
tags: [file-utils, cache, uuid, filesystem, tdd, vitest]

# Dependency graph
requires: []
provides:
  - "getAssistantCacheDir(type): CacheFileType → year-month/type directory with auto-mkdir"
  - "buildCacheFilename(originalName, ext): sanitized filename preserving Chinese, with 8-char UUID suffix"
  - "CacheFileType type alias ('images' | 'files')"
  - "17 unit tests covering DIR-01~03 and NAME-01~03"
affects: [45-route-frontend-adaptation, 46-asset-name-restoration, src/app/api/chat/images/route.ts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Year-month/type directory structure for cache files: data/cache/assistant/YYYY-MM/{type}/"
    - "Filename sanitization: preserve unicode letters/numbers, replace everything else with underscore"
    - "Meaningless-stem detection via Set + regex for screenshot prefix"
    - "8-char hex UUID suffix via crypto.randomUUID().replace(/-/g,'').slice(0,8)"

key-files:
  created:
    - src/lib/__tests__/file-utils.test.ts
  modified:
    - src/lib/file-utils.ts

key-decisions:
  - "getAssistantCacheDir() merges ensureAssistantCacheDir() — always creates dir on call"
  - "MEANINGLESS_STEMS Set includes image/screenshot/img/photo/picture/clipboard/paste/untitled"
  - "Screenshot prefix detection via /^screenshot[\\s_-]/i regex to catch Screenshot 2026-... style names"
  - "Unicode property escapes [^\\p{L}\\p{N}] used for cross-language sanitization"
  - "Fallback chain: meaningful stem → sanitized stem → 'file' prefix (not empty)"

patterns-established:
  - "Cache dir pattern: DATA_ROOT/cache/assistant/YYYY-MM/{type}/ — created on access"
  - "Filename pattern: {clean-stem}-{8hex}{ext} or tower_image-{8hex}{ext} for meaningless names"
  - "TDD: RED (17 tests fail on missing functions) → GREEN (implement) → REFACTOR (remove old func)"

requirements-completed: [DIR-01, DIR-02, DIR-03, NAME-01, NAME-02, NAME-03]

# Metrics
duration: 5min
completed: 2026-04-20
---

# Phase 44 Plan 01: Cache Storage Refactor — Directory & Filename Helpers Summary

**`getAssistantCacheDir(type)` + `buildCacheFilename()` pure functions implementing year-month/type directory structure and Unicode-preserving filename sanitization with 8-char UUID suffix**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-20T03:50:07Z
- **Completed:** 2026-04-20T03:55:00Z
- **Tasks:** 1 (TDD)
- **Files modified:** 2

## Accomplishments
- Implemented `getAssistantCacheDir(type)` returning `data/cache/assistant/YYYY-MM/{type}/` path with auto-mkdir (DIR-01~03)
- Implemented `buildCacheFilename()` preserving Chinese/Unicode chars, replacing special chars with underscore, detecting meaningless names (NAME-01~03)
- Removed `ensureAssistantCacheDir()` — its functionality merged into `getAssistantCacheDir()`
- 17 unit tests covering all 6 requirements with vi.mock for fs isolation

## Task Commits

Each task was committed atomically:

1. **Task 1: TDD — getAssistantCacheDir(type) and buildCacheFilename()** - `3988580` (feat)

## Files Created/Modified
- `src/lib/file-utils.ts` — Added `CacheFileType` type, updated `getAssistantCacheDir(type)` with year-month/type dir, added `buildCacheFilename()` with meaningless-stem detection and Unicode sanitization; removed `ensureAssistantCacheDir()`
- `src/lib/__tests__/file-utils.test.ts` — 17 unit tests across two describe blocks (`getAssistantCacheDir` and `buildCacheFilename`) using vi.mock for fs

## Decisions Made
- `getAssistantCacheDir()` now always calls `fs.mkdirSync` with `{ recursive: true }` on each invocation — eliminates the need for a separate `ensureAssistantCacheDir()` call site pattern
- `MEANINGLESS_STEMS` Set for O(1) lookup of known-bad names rather than a regex list
- Screenshot detection via `/^screenshot[\s_-]/i` regex to handle "Screenshot 2026-04-20 at 12.34.56.png" style names
- `[^\p{L}\p{N}]` Unicode property escape for language-agnostic sanitization (handles Chinese, Arabic, etc.)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None — `getAssistantCacheDir` and `buildCacheFilename` are pure utility functions. The actual upload route wiring happens in Plan 02.

## Next Phase Readiness
- Plan 44-02 can now import `getAssistantCacheDir` and `buildCacheFilename` from `src/lib/file-utils.ts`
- The existing `images/route.ts` still imports `ensureAssistantCacheDir` — this will be fixed in Plan 02
- No blockers

## Self-Check

---
*Phase: 44-cache-storage-refactor*
*Completed: 2026-04-20*
