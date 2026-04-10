---
phase: 29-adapter-dead-code-removal
plan: "01"
subsystem: lib
tags: [refactor, adapter-cleanup, dead-code]
dependency_graph:
  requires: []
  provides: [src/lib/cli-test.ts, src/lib/preview-process.ts]
  affects: [src/app/api/adapters/test/route.ts, src/actions/preview-actions.ts, src/components/settings/cli-adapter-tester.tsx, src/components/settings/ai-tools-config.tsx]
tech_stack:
  added: []
  patterns: [self-contained module, zero-dependency extraction]
key_files:
  created:
    - src/lib/cli-test.ts
    - src/lib/preview-process.ts
  modified:
    - src/app/api/adapters/test/route.ts
    - src/actions/preview-actions.ts
    - src/components/settings/cli-adapter-tester.tsx
    - src/components/settings/ai-tools-config.tsx
decisions:
  - "cli-test.ts combines types, process-utils helpers, parse functions, and testEnvironment into one self-contained file — zero adapters/ imports"
  - "route.ts GET handler hardcodes adapters: [\"claude_local\"] — registry concept removed, only one CLI exists"
  - "adapterType body param kept as optional for backward compat but no longer used to dispatch"
metrics:
  duration: 185s
  completed: "2026-04-10"
  tasks_completed: 2
  files_changed: 6
---

# Phase 29 Plan 01: Adapter Dead Code Removal — Module Relocation Summary

Self-contained CLI verifier and preview process registry extracted from src/lib/adapters/ into standalone src/lib/ files, with all four consumer files updated to new import paths.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create cli-test.ts and preview-process.ts | f3f04b2 | src/lib/cli-test.ts, src/lib/preview-process.ts |
| 2 | Update consumer imports to new paths | d3699fd | route.ts, preview-actions.ts, cli-adapter-tester.tsx, ai-tools-config.tsx |

## What Was Built

**src/lib/cli-test.ts** — A single self-contained file (no adapters/ imports) that combines:
- `TestResult` and `TestCheck` interfaces (public exports)
- All process-utils helpers: `parseObject`, `asString`, `asNumber`, `appendWithCap`, `pathExists`, `windowsPathExts`, `resolveCommandPath`, `quoteForCmd`, `resolveSpawnTarget`, `ensureCommandResolvable`, `runChildProcess`
- All claude-local parse functions: `parseClaudeStreamJson`, `detectClaudeLoginRequired`, `extractClaudeLoginUrl`, `extractClaudeErrorMessages` (private)
- `testEnvironment` function (public export) — exact logic from original, unchanged

**src/lib/preview-process.ts** — Exact copy of preview-process-manager.ts with same three exports: `registerPreviewProcess`, `killPreviewProcess`, `isPreviewRunning`.

**Consumer updates:**
- `src/app/api/adapters/test/route.ts`: imports `testEnvironment` and `TestResult` from `@/lib/cli-test`; GET returns hardcoded `{ adapters: ["claude_local"] }`; `getAdapter`/`listAdapters` registry calls removed
- `src/actions/preview-actions.ts`: import path updated from `@/lib/adapters/preview-process-manager` to `@/lib/preview-process`
- `src/components/settings/cli-adapter-tester.tsx`: `TestResult` import updated to `@/lib/cli-test`
- `src/components/settings/ai-tools-config.tsx`: `TestResult` import updated to `@/lib/cli-test`

## Verification

- `grep -r "from.*adapters" src/app/api/adapters/test/ src/actions/preview-actions.ts src/components/settings/cli-adapter-tester.tsx src/components/settings/ai-tools-config.tsx` returns empty (zero matches)
- `npx tsc --noEmit` produces no new errors from relocated modules (pre-existing errors in agent-config-actions.ts and pty-session.test.ts are unchanged)

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. Both new files are fully wired with real implementations. The `src/lib/adapters/` directory still exists and will be deleted in Plan 02.

## Self-Check: PASSED

- [x] src/lib/cli-test.ts exists at /Users/liujunping/project/i/ai-manager/src/lib/cli-test.ts
- [x] src/lib/preview-process.ts exists at /Users/liujunping/project/i/ai-manager/src/lib/preview-process.ts
- [x] Commit f3f04b2 exists (Task 1)
- [x] Commit d3699fd exists (Task 2)
- [x] Zero adapters/ imports in all four consumer files
