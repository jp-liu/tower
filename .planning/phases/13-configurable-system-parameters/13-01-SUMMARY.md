---
phase: 13-configurable-system-parameters
plan: 01
subsystem: config-wiring
tags: [config, system-parameters, process-manager, search, upload, git-timeout]
dependency_graph:
  requires: [Phase-11-SystemConfig-infrastructure]
  provides: [config-reader, branch-template-utility, wired-server-consumers]
  affects: [asset-actions, search-actions, process-manager, stream-route, execute-route]
tech_stack:
  added: []
  patterns: [thin-config-reader-for-adapters, async-function-promotion, batch-config-read]
key_files:
  created:
    - src/lib/branch-template.ts
    - src/lib/config-reader.ts
    - tests/unit/lib/branch-template.test.ts
    - tests/unit/lib/process-manager.test.ts
  modified:
    - src/lib/config-defaults.ts
    - src/lib/adapters/process-manager.ts
    - src/actions/asset-actions.ts
    - src/actions/search-actions.ts
    - src/app/api/tasks/[taskId]/execute/route.ts
    - src/app/api/tasks/[taskId]/stream/route.ts
decisions:
  - "config-reader.ts (not config-actions.ts) used in process-manager to avoid use-server boundary issues"
  - "canStartExecution promoted to async — all callers updated with await to prevent silent concurrency bypass"
  - "search-actions uses getConfigValues batch call for 3 keys in single DB query"
  - "SQL LIMIT ? parameterized with resultLimit instead of hardcoded literal"
  - "toNoteResult accepts snippetLength parameter for composability"
metrics:
  duration: "~8 minutes"
  completed: "2026-03-30"
  tasks_completed: 2
  files_created: 4
  files_modified: 6
---

# Phase 13 Plan 01: Config Defaults Registry + Server Consumer Wiring Summary

**One-liner:** Registered 8 new config keys in CONFIG_DEFAULTS and wired all server-side hardcoded constants to read from SystemConfig via getConfigValue/getConfigValues.

## What Was Built

### Task 1: Config Defaults Registry + Branch Template Utility + Tests (TDD)

**src/lib/config-defaults.ts** — Added 8 new entries to CONFIG_DEFAULTS:
- `system.maxUploadBytes` (52428800) — replaces hardcoded 50 MB in asset-actions.ts
- `system.maxConcurrentExecutions` (3) — replaces hardcoded MAX_CONCURRENT in process-manager.ts
- `git.timeoutSec` (30) — new timeout config for adapter.execute() calls
- `git.branchTemplate` ("vk/{taskIdShort}-") — configurable branch naming template
- `search.resultLimit` (20) — replaces hardcoded take:20 in all search queries
- `search.allModeCap` (5) — replaces hardcoded CAP=5 in "all" mode aggregation
- `search.debounceMs` (250) — for client-side search debounce (Plan 02)
- `search.snippetLength` (80) — replaces hardcoded .slice(0, 80) in note results

**src/lib/branch-template.ts** — Pure utility with two exports:
- `interpolateBranchTemplate(template, taskId)` — replaces {taskId} and {taskIdShort}
- `validateBranchTemplate(template)` — checks template contains at least one placeholder

**src/lib/config-reader.ts** — Thin Prisma-based config reader, no "use server"/next/cache. Created as fallback to avoid Next.js boundary issues when importing from process-manager.ts (a plain Node.js module). Mirrors getConfigValue logic without Next.js dependencies.

**Tests:** 17 new unit tests pass (11 branch-template, 6 process-manager).

### Task 2: Wire Server-Side Consumers to Read from SystemConfig

**src/actions/asset-actions.ts:**
- Removed module-level `MAX_UPLOAD_BYTES = 50 * 1024 * 1024`
- Added `getConfigValue<number>("system.maxUploadBytes", 52428800)` inside uploadAsset()
- Error message now dynamic: `File too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)`

**src/lib/adapters/process-manager.ts:**
- Removed module-level `MAX_CONCURRENT = 3`
- Promoted `canStartExecution()` from sync to async (`Promise<boolean>`)
- Reads `system.maxConcurrentExecutions` via `readConfigValue` from config-reader

**src/app/api/tasks/[taskId]/execute/route.ts:**
- Updated `!canStartExecution()` to `!(await canStartExecution())`

**src/app/api/tasks/[taskId]/stream/route.ts:**
- Updated `!canStartExecution()` to `!(await canStartExecution())`
- Added `getConfigValue<number>("git.timeoutSec", 30)` before adapter.execute()
- Passes `timeoutSec` to adapter.execute() call object

**src/actions/search-actions.ts:**
- Added `getConfigValues(["search.resultLimit", "search.allModeCap", "search.snippetLength"])` batch read
- Replaced `const CAP = 5` with configured `allModeCap`
- Replaced all `take: 20` with `resultLimit`
- Replaced all `LIMIT 20` raw SQL with parameterized `LIMIT ?` using `resultLimit`
- Modified `toNoteResult(row, snippetLength)` to accept snippetLength parameter
- Replaced hardcoded `.slice(0, 80)` with `.slice(0, snippetLength)`

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| config-reader.ts (not config-actions.ts) used in process-manager | config-actions.ts uses "use server" and next/cache; process-manager is a plain Node.js module without "use server" — importing across this boundary can cause runtime issues. The thin config-reader.ts mirrors the same Prisma logic without Next.js dependencies, following the established fts.ts/file-utils.ts "Next.js-free" pattern. |
| canStartExecution async promotion + all callers await-ed | After async promotion, any caller not using `await` would receive a truthy Promise object, silently bypassing the concurrency check. Both callers (execute/route.ts, stream/route.ts) were updated to `await canStartExecution()`. |
| getConfigValues batch for search (not 3 sequential calls) | Single DB query for 3 keys is more efficient and idiomatic per the existing getConfigValues API. |
| SQL LIMIT ? parameterized | Raw SQL queries use `LIMIT ?` with `resultLimit` variable — consistent with existing parameterization patterns and avoids SQL injection risk. |
| toNoteResult takes snippetLength param | Allows callers to control snippet length without closure coupling; cleaner than a closure approach. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stream/route.ts canStartExecution missing await (pre-existing)**
- Found during: Task 2
- Issue: The `validateAndParseRequest` helper called `!canStartExecution()` synchronously; after making canStartExecution async, this would silently bypass the concurrency check
- Fix: Updated to `!(await canStartExecution())`
- Files modified: src/app/api/tasks/[taskId]/stream/route.ts
- Commit: 93ca79d

None beyond the above — plan executed with the config-reader.ts fallback being the primary deviation, which was pre-documented in RESEARCH.md as Pitfall 1.

## Pre-Existing Issues (Out of Scope)

The following TypeScript errors existed before this plan and are NOT caused by changes in this plan:
- `src/actions/agent-config-actions.ts` — `InputJsonValue` type mismatch in Prisma update/create
- `src/app/api/tasks/[taskId]/stream/route.ts` lines 277, 290 — `task.project` access (should be `task.project!`) and `ExecutionResult.exitCode` nullable type

These are pre-existing and deferred to a future cleanup plan.

The following component tests failed before and after this plan (pre-existing):
- `tests/unit/components/board-stats.test.tsx` (3 tests) — useI18n outside I18nProvider
- `tests/unit/components/prompts-config.test.tsx` (8 tests) — useRouter outside app router context

## Known Stubs

None — all config reads are fully wired. The branch template utility is complete and tested. No placeholder values remain.

## Verification

- All 17 new unit tests pass (branch-template: 11, process-manager: 6)
- All pre-existing 208 passing unit tests continue to pass (225 total passing)
- Grep verification: no `MAX_UPLOAD_BYTES`, `MAX_CONCURRENT`, `CAP = 5`, hardcoded `take: 20`, or hardcoded `.slice(0, 80)` in modified files
- canStartExecution callers both use `await`
- stream/route.ts passes `timeoutSec` to adapter.execute()

## Self-Check: PASSED

Files exist:
- src/lib/branch-template.ts: EXISTS
- src/lib/config-reader.ts: EXISTS
- tests/unit/lib/branch-template.test.ts: EXISTS
- tests/unit/lib/process-manager.test.ts: EXISTS

Commits exist:
- 10bca0d: feat(13-01): config defaults registry + branch template utility + tests
- 93ca79d: feat(13-01): wire server-side consumers to read from SystemConfig
