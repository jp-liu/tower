---
phase: 49-server-actions-test-coverage
plan: 02
subsystem: server-actions-tests
tags: [testing, prompt-actions, cli-profile-actions, vitest, unit-tests]
requirements: [COV-04, COV-06]

dependency_graph:
  requires: []
  provides: [prompt-actions-tests, cli-profile-actions-tests]
  affects: [test-coverage]

tech_stack:
  added: []
  patterns: [vi.mock hoisting, transaction-mock-with-call-order, prisma-error-mapping]

key_files:
  created:
    - src/actions/__tests__/prompt-actions.test.ts
    - src/actions/__tests__/cli-profile-actions.test.ts
  modified: []

decisions:
  - mockTx defined before vi.mock to avoid hoisting order issues in vitest
  - callOrder array used to verify updateMany executes before update in setDefaultPrompt transaction
  - Regex patterns used for error message matching to cover both English and Chinese error text

metrics:
  duration: "2 minutes"
  completed_date: "2026-04-20T07:03:01Z"
  tasks_completed: 2
  files_changed: 2
---

# Phase 49 Plan 02: Prompt-Actions and CLI-Profile-Actions Tests Summary

Unit tests for `prompt-actions.ts` and `cli-profile-actions.ts` — two server action modules with "default uniqueness" logic and security validation (COV-04, COV-06). Tests cover transaction call order, content length guards, command allowlist, baseArgs metacharacter rejection, envVars blocked system keys, and Prisma P2025 error mapping.

## Tasks Completed

### Task 1: prompt-actions tests

**File:** `src/actions/__tests__/prompt-actions.test.ts`
**Commit:** 2bbc281
**Tests:** 15 passing

Covers:
- `getPrompts` with/without workspaceId (OR clause scoping vs global)
- `getPromptById` id pass-through
- `createPrompt` / `updatePrompt` content length guard (>100,000 chars throws, exactly 100,000 passes)
- `deletePrompt` with path revalidation
- `setDefaultPrompt` — key test: `updateMany` (unset previous) executes BEFORE `update` (set new), verified via call-order array; scoped (workspaceId) vs global (no workspaceId) where clause tested separately

### Task 2: cli-profile-actions tests

**File:** `src/actions/__tests__/cli-profile-actions.test.ts`
**Commit:** 51cc192
**Tests:** 23 passing

Covers:
- `getDefaultCliProfile` found (shape check) and not found (null)
- `updateCliProfile` command allowlist: `claude` and `claude-code` pass; `/usr/bin/claude` basename check passes; `bash` and `sh` rejected
- `baseArgs` validation: invalid JSON, non-array JSON, metacharacters (`;`, `|`, `` ` ``), non-string array elements
- `envVars` validation: invalid JSON, JSON array rejected, blocked keys `PATH` / `NODE_OPTIONS` / `LD_PRELOAD`, case-insensitive normalization (lowercase `path` also blocked)
- P2025 error mapped to user-friendly message "CLI Profile 不存在"; non-P2025 errors re-thrown as-is

## Verification

```
Test Files  2 passed (2)
Tests       38 passed (38)
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- `src/actions/__tests__/prompt-actions.test.ts` — FOUND
- `src/actions/__tests__/cli-profile-actions.test.ts` — FOUND
- commit 2bbc281 — FOUND
- commit 51cc192 — FOUND
