---
phase: 02-cli-adapter-verification
plan: 01
subsystem: cli-adapter
tags: [adapter, testing, i18n, tdd]
dependency_graph:
  requires: []
  provides: [version-check-backend, i18n-aitools-keys, cli-tester-test-scaffold]
  affects: [src/lib/adapters/claude-local/test.ts, src/lib/i18n.tsx, tests/unit/components/cli-adapter-tester.test.tsx]
tech_stack:
  added: []
  patterns: [best-effort-check, tdd-red-scaffold]
key_files:
  created:
    - tests/unit/components/cli-adapter-tester.test.tsx
  modified:
    - src/lib/adapters/claude-local/test.ts
    - src/lib/i18n.tsx
decisions:
  - "Version check always passes=true (best-effort) — never blocks overall test result (D-06)"
  - "Version check inserted as Check 2, between command resolution and API key check"
  - "Test scaffold is intentionally RED until Plan 02 creates the CLIAdapterTester component"
metrics:
  duration: "~8 minutes"
  completed: "2026-03-26"
  tasks: 2
  files: 3
---

# Phase 02 Plan 01: Version Check Backend + i18n Keys + Test Scaffold Summary

**One-liner:** Version check step added to testEnvironment() as best-effort Check 2, 7 settings.aiTools.* i18n keys added to both zh/en, and 7-test RED scaffold created for CLIAdapterTester component.

## What Was Built

### Task 1: Version Check in testEnvironment() + i18n Keys

**test.ts changes:** Inserted `claude_version` check as Check 2 in `testEnvironment()`, after command resolution succeeds and before the API key check. The check:
- Runs `claude --version` via `runChildProcess` with 5s timeout
- Extracts version string from stdout or stderr
- Always sets `passed: true` (never blocks the test)
- Falls back to "Version: unknown" on any error

**i18n.tsx changes:** Added 7 new `settings.aiTools.*` keys to both `zh` and `en` objects:
- `settings.aiTools.title`
- `settings.aiTools.cliVerification`
- `settings.aiTools.cliVerificationDesc`
- `settings.aiTools.testConnection`
- `settings.aiTools.testing`
- `settings.aiTools.testPassed`
- `settings.aiTools.testFailed`

### Task 2: CLIAdapterTester Test Scaffold (TDD RED)

Created `tests/unit/components/cli-adapter-tester.test.tsx` with 7 test cases:
1. Renders "测试连接" button
2. Clicking triggers fetch to `/api/adapters/test` with correct POST body
3. Button shows "测试中..." and is disabled during loading
4. After successful fetch, renders all TestCheck rows
5. Version check row displays "Version: 1.0.17" from check message
6. No result card shown before test is run
7. Button is disabled during testing (no double-trigger)

Tests are intentionally RED — the component `@/components/settings/cli-adapter-tester` does not exist yet; it will be created in Plan 02.

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Hash | Task | Description |
|------|------|-------------|
| 4be7c5d | Task 1 | feat(02-01): add version check to testEnvironment() and i18n keys |
| a9c7296 | Task 2 | test(02-01): add failing test scaffold for CLIAdapterTester component |

## Self-Check: PASSED
