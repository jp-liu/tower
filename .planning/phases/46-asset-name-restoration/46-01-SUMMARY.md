---
phase: 46-asset-name-restoration
plan: "01"
subsystem: file-utils / mcp-task-tools
tags: [file-management, uuid-stripping, asset-naming, tdd]
dependency_graph:
  requires: []
  provides: [stripCacheUuidSuffix, isAssistantCachePath]
  affects: [create_task references copy loop]
tech_stack:
  added: []
  patterns: [pure-function-helpers, regex-based-stripping, counter-based-collision-avoidance]
key_files:
  created: []
  modified:
    - src/lib/file-utils.ts
    - src/lib/__tests__/file-utils.test.ts
    - src/mcp/tools/task-tools.ts
decisions:
  - "Counter suffix (N) used for cache file collision avoidance — human-readable over timestamp"
  - "isAssistantCachePath gates stripping strictly to assistant cache root to avoid false positives"
  - "CACHE_UUID_SUFFIX_RE uses /i flag for case-insensitive hex matching — defensive against uppercase hex"
metrics:
  duration: "160s"
  completed: "2026-04-20"
  tasks_completed: 2
  files_modified: 3
---

# Phase 46 Plan 01: Asset Name Restoration Summary

**One-liner:** UUID suffix stripping on cache-to-asset copy with counter-based collision avoidance, gated by `isAssistantCachePath`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | TDD — stripCacheUuidSuffix and isAssistantCachePath helpers | d65ac3d | src/lib/file-utils.ts, src/lib/__tests__/file-utils.test.ts |
| 2 | Wire UUID stripping into task-tools.ts reference copy loop | 14a1558 | src/mcp/tools/task-tools.ts |

## What Was Built

**Task 1:** Added two exported helpers to `src/lib/file-utils.ts`:

- `stripCacheUuidSuffix(filename: string): string` — strips the `-{8hex}` UUID suffix added by `buildCacheFilename`. Regex `/-([0-9a-f]{8})(\.[^.]+)$/i` matches exactly 8 hex chars immediately before the extension (case-insensitive). Leaves non-matching filenames unchanged.
- `isAssistantCachePath(filePath: string): boolean` — returns true only if the path is inside the assistant cache root (`data/cache/assistant/`), using the existing `getAssistantCacheRoot()` helper.

Full unit test coverage added in the existing `src/lib/__tests__/file-utils.test.ts` file covering: Chinese filenames, `tower_image` prefix, no-match pass-through, 12-hex non-match, uppercase hex, different extensions, cache path detection, and non-cache path rejection.

**Task 2:** Modified the reference copy loop in `src/mcp/tools/task-tools.ts`:

- Added `import { stripCacheUuidSuffix, isAssistantCachePath } from "@/lib/file-utils"` at the top.
- After `basename(filePath)`, gate UUID stripping behind `isAssistantCachePath(filePath)`.
- Collision avoidance for cache files now uses counter suffix `设计稿 (1).png`, `设计稿 (2).png` — readable. Non-cache files retain existing `Date.now()` timestamp behavior.

## Success Criteria Verification

- `stripCacheUuidSuffix("设计稿-a1b2c3d4.png") === "设计稿.png"` — PASS
- `stripCacheUuidSuffix("tower_image-a1b2c3d4.png") === "tower_image.png"` — PASS
- `isAssistantCachePath` gates stripping to cache files only — PASS
- Collision avoidance produces readable counter names for cache files — PASS
- Non-cache references copied unchanged — PASS
- All 26 tests pass, TypeScript compiles clean (no errors in modified files) — PASS

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all logic fully wired end-to-end.

## Self-Check: PASSED

- `/Users/liujunping/project/i/ai-manager/src/lib/file-utils.ts` — FOUND
- `/Users/liujunping/project/i/ai-manager/src/lib/__tests__/file-utils.test.ts` — FOUND
- `/Users/liujunping/project/i/ai-manager/src/mcp/tools/task-tools.ts` — FOUND
- Commit `d65ac3d` — FOUND
- Commit `14a1558` — FOUND
