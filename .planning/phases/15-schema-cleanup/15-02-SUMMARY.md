---
phase: 15-schema-cleanup
plan: "02"
subsystem: config-cleanup
tags: [cleanup, dead-code, branchTemplate, i18n, settings]
dependency_graph:
  requires: []
  provides: [CL-01]
  affects:
    - src/lib/config-defaults.ts
    - src/components/settings/system-config.tsx
    - src/components/task/task-detail-panel.tsx
    - src/lib/i18n.tsx
tech_stack:
  added: []
  patterns:
    - Fixed branch naming (task/{taskId}) replaces configurable template
key_files:
  deleted:
    - src/lib/branch-template.ts
    - tests/unit/lib/branch-template.test.ts
  modified:
    - src/lib/config-defaults.ts
    - src/components/settings/system-config.tsx
    - src/components/task/task-detail-panel.tsx
    - src/lib/i18n.tsx
decisions:
  - "[15-02]: Fixed branch format task/{taskId} passed directly to TaskMetadata — no interpolation needed, branch prop is optional string"
  - "[15-02]: getConfigValue import removed from task-detail-panel.tsx entirely — only branchTemplate used it there"
metrics:
  duration: "~8 minutes"
  completed: "2026-03-31"
  tasks_completed: 2
  files_modified: 4
  files_deleted: 2
---

# Phase 15 Plan 02: Remove branchTemplate Dead Code Summary

**One-liner:** Deleted branch-template.ts and its tests, stripped all git.branchTemplate config wiring from settings UI, task panel, and i18n — task branch is now a fixed `task/{taskId}` string.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Delete branch-template lib and test, clean config-defaults | c3433cc | src/lib/branch-template.ts (deleted), tests/unit/lib/branch-template.test.ts (deleted), src/lib/config-defaults.ts |
| 2 | Clean branchTemplate from settings UI, task panel, and i18n | 8999e63 | src/components/settings/system-config.tsx, src/components/task/task-detail-panel.tsx, src/lib/i18n.tsx |

## What Was Done

### Task 1: Delete branch-template lib and test, clean config-defaults

- Deleted `src/lib/branch-template.ts` (10 lines: `interpolateBranchTemplate`, `validateBranchTemplate`)
- Deleted `tests/unit/lib/branch-template.test.ts` (57 lines: 11 tests covering both functions)
- Removed `"git.branchTemplate"` entry from `CONFIG_DEFAULTS` in `src/lib/config-defaults.ts`
- CONFIG_DEFAULTS now has 8 entries (down from 9): git.pathMappingRules, system.maxUploadBytes, system.maxConcurrentExecutions, git.timeoutSec, search.resultLimit, search.allModeCap, search.debounceMs, search.snippetLength

### Task 2: Clean branchTemplate from settings UI, task panel, and i18n

**system-config.tsx:**
- Removed `import { validateBranchTemplate } from "@/lib/branch-template"`
- Changed `GitParamsForm` type from `{ timeoutSec: number; branchTemplate: string }` to `{ timeoutSec: number }`
- Removed `branchTemplate: "vk/{taskIdShort}-"` from initial state
- Removed `branchTemplateError` state
- Removed `"git.branchTemplate"` from `getConfigValues` call (7 keys now, down from 8)
- Removed `branchTemplate: ...` from `setGitParamsForm` call
- Simplified `handleSaveGitParams` to only save `git.timeoutSec`
- Removed entire branch template UI block (label, hint, error, input)

**task-detail-panel.tsx:**
- Removed `import { interpolateBranchTemplate } from "@/lib/branch-template"`
- Removed `import { getConfigValue } from "@/actions/config-actions"` (was only used for branchTemplate)
- Removed `branchTemplate` state
- Removed `useEffect` that loaded `git.branchTemplate` config
- Changed `branch={interpolateBranchTemplate(branchTemplate, task.id)}` to `branch={\`task/${task.id}\`}`

**i18n.tsx:**
- ZH locale: removed `gitParams.branchTemplate`, `gitParams.branchTemplateHint`, `gitParams.branchTemplateInvalid` keys
- ZH locale: updated `gitParams.desc` from "Git 操作超时与分支命名模板" to "Git 操作超时"
- EN locale: removed `gitParams.branchTemplate`, `gitParams.branchTemplateHint`, `gitParams.branchTemplateInvalid` keys
- EN locale: updated `gitParams.desc` from "Git operation timeout and branch naming template" to "Git operation timeout"

## Verification Results

- `grep -rn "branchTemplate|branch-template|interpolateBranchTemplate|validateBranchTemplate" src/ tests/` → ZERO results
- TypeScript check on changed files: no new errors introduced (pre-existing PrismaClient issues in worktree environment are unrelated)
- Unit tests: 41 lib tests pass; Prisma-dependent tests fail only due to worktree missing generated Prisma client (pre-existing environment limitation)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all branchTemplate references fully removed, `task/${task.id}` is the production-correct fixed value per STATE.md decision "[v0.5]: Branch name is task/{taskId}".

## Self-Check: PASSED

- [x] src/lib/branch-template.ts does not exist
- [x] tests/unit/lib/branch-template.test.ts does not exist
- [x] src/lib/config-defaults.ts does NOT contain "git.branchTemplate"
- [x] src/lib/config-defaults.ts still contains "git.timeoutSec"
- [x] src/lib/config-defaults.ts still contains "search.resultLimit"
- [x] src/components/settings/system-config.tsx does NOT contain "branchTemplate"
- [x] src/components/task/task-detail-panel.tsx does NOT import from "@/lib/branch-template"
- [x] src/components/task/task-detail-panel.tsx contains `branch={\`task/${task.id}\`}`
- [x] src/lib/i18n.tsx does NOT contain "gitParams.branchTemplate"
- [x] ZH gitParams.desc = "Git 操作超时"
- [x] EN gitParams.desc = "Git operation timeout"
- [x] Commits c3433cc and 8999e63 exist in git log
