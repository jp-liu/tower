---
phase: 17-review-merge-workflow
plan: "00"
subsystem: testing
tags: [test-stubs, wave-0, vitest, review-merge]
dependency_graph:
  requires: []
  provides: [test-stub-files-wave-0]
  affects: [17-01, 17-02, 17-03]
tech_stack:
  added: []
  patterns: [vitest-todo-stubs]
key_files:
  created:
    - tests/unit/api/stream-persist-result.test.ts
    - tests/unit/api/diff-route.test.ts
    - tests/unit/api/merge-route.test.ts
    - tests/unit/api/stream-send-back.test.ts
  modified: []
decisions:
  - "Test stubs use it.todo() for all placeholder cases — runnable by vitest without errors, 16 todo tests total"
metrics:
  duration: 52s
  completed: "2026-03-31"
  tasks_completed: 1
  files_changed: 4
---

# Phase 17 Plan 00: Wave 0 Test Stubs Summary

Four vitest stub files created for Phase 17 review-merge-workflow, establishing test scaffolding before implementation begins.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Create four test stub files for Phase 17 API routes | fe7d322 |

## What Was Built

Four test stub files under `tests/unit/api/` using `it.todo()` placeholders:

- **stream-persist-result.test.ts**: 3 stubs for IN_REVIEW status transition when exitCode=0
- **diff-route.test.ts**: 5 stubs for GET `/api/tasks/[taskId]/diff` response shape validation
- **merge-route.test.ts**: 5 stubs for POST `/api/tasks/[taskId]/merge` squash merge + conflict detection
- **stream-send-back.test.ts**: 3 stubs for send-back flow transitioning IN_REVIEW → IN_PROGRESS

All 16 todo tests are recognized by vitest with `4 skipped` files and zero errors.

## Verification Results

```
Test Files: 1 passed | 4 skipped (5)
Tests: 14 passed | 16 todo (30)
```

Overall `tests/unit/api/` directory passes with `--passWithNoTests`.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

All test cases in the four new files are intentional stubs (it.todo). They will be filled in during plans 17-01 through 17-03 as implementation proceeds. These stubs do not prevent the plan's goal (Wave 0 scaffolding) from being achieved.
