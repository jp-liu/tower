---
phase: 43
plan: 01
subsystem: assistant-chat
tags: [multimodal, images, claude-sdk, prompt-building]
dependency_graph:
  requires: []
  provides: [buildMultimodalPrompt, multimodal-chat-route]
  affects: [assistant-chat-api, assistant-sdk-query]
tech_stack:
  added: []
  patterns: [prompt-builder-helper, conditional-tool-registration]
key_files:
  created:
    - src/lib/build-multimodal-prompt.ts
    - src/lib/__tests__/build-multimodal-prompt.test.ts
  modified:
    - src/app/api/internal/assistant/chat/route.ts
key_decisions:
  - "buildMultimodalPrompt appends image paths to prompt text rather than embedding base64 — Claude uses Read tool to load images"
  - "Read tool conditionally added to tools and allowedTools only when imageFilenames present — preserves text-only backward compatibility"
  - "fs.existsSync used to silently skip missing files rather than erroring — resilient to race conditions"
metrics:
  duration: ~8 minutes
  completed_date: "2026-04-18T13:10:11Z"
  tasks_completed: 2
  files_changed: 3
---

# Phase 43 Plan 01: Claude SDK Multimodal Integration Summary

**One-liner:** Image-to-prompt wiring via buildMultimodalPrompt helper that appends absolute file paths to Claude's prompt and enables the Read tool for image viewing.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create buildMultimodalPrompt helper with tests (TDD) | da2ba6d | src/lib/build-multimodal-prompt.ts, src/lib/__tests__/build-multimodal-prompt.test.ts |
| 2 | Wire multimodal prompt and Read tool into chat route | 7b98f75 | src/app/api/internal/assistant/chat/route.ts |

## What Was Built

### buildMultimodalPrompt (src/lib/build-multimodal-prompt.ts)

A pure helper function that:
- Returns prompt unchanged when no images provided (AI-03 backward compatibility)
- Caps at 10 images (silently drops excess)
- Resolves absolute paths via `path.join(cacheDir, filename)`
- Skips missing files using `fs.existsSync`
- Appends section with delimiter `\n\n---\n` and instruction telling Claude to use Read tool

### Chat Route Changes (src/app/api/internal/assistant/chat/route.ts)

- Imports `buildMultimodalPrompt` and `getAssistantCacheDir`
- Builds `finalPrompt` with image paths when `imageFilenames` present
- Conditionally adds `"Read"` to `tools` and `allowedTools` for image messages
- Text-only messages: `tools: []`, original `allowedTools`, `finalPrompt === prompt`

### Unit Tests (src/lib/__tests__/build-multimodal-prompt.test.ts)

8 test cases using vitest with `vi.mock("node:fs")`:
1. Empty imageFilenames → prompt unchanged
2. Single existing image → path appended with delimiter + instruction
3. Multiple existing images → all paths listed
4. Missing file → prompt unchanged
5. All files missing → prompt unchanged, no delimiter
6. Mixed existing/missing → only existing paths included
7. 15 images → only first 10 appear
8. Delimiter format → contains `\n\n---\n` and "attached.*image" pattern

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.mocked approach incompatible with vi.mock("node:fs") default**
- **Found during:** Task 1 — GREEN phase test run
- **Issue:** Using `vi.mock("node:fs")` alone doesn't auto-mock all functions; `vi.mocked(fs.existsSync).mockReturnValue` threw "not a function"
- **Fix:** Changed `vi.mock("node:fs")` to `vi.mock("node:fs", () => ({ existsSync: vi.fn() }))` to explicitly provide a mock factory with `vi.fn()` for `existsSync`
- **Files modified:** src/lib/__tests__/build-multimodal-prompt.test.ts
- **Commit:** da2ba6d (included in same commit)

## Success Criteria Verification

- [x] buildMultimodalPrompt helper created and tested (8 test cases passing)
- [x] Chat route uses helper to append image paths to prompt
- [x] Read tool enabled when images attached (tools + allowedTools)
- [x] Text-only messages follow identical code path as before (`finalPrompt === prompt`, `tools: []`)
- [x] TypeScript compiles cleanly for modified files (pre-existing errors in tests/unit/lib/pty-session.test.ts are out of scope)

## Self-Check: PASSED

All created files exist on disk. Both task commits verified in git history.
