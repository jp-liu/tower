---
phase: 64
plan: "01"
subsystem: search
tags: [server-action, ripgrep, code-search, tdd]
dependency_graph:
  requires: []
  provides: [searchCode, SearchMatch, SearchResult]
  affects: [64-02-PLAN.md, 64-03-PLAN.md]
tech_stack:
  added: []
  patterns: [execFileSync without shell, vi.hoisted mock pattern, Zod server-action validation]
key_files:
  created:
    - src/actions/search-code-actions.ts
    - src/actions/__tests__/search-code-actions.test.ts
  modified: []
decisions:
  - Use "child_process" (without node: prefix) consistent with project convention — node: prefix caused vitest mock resolution failure
  - vi.hoisted() with default export in mock — required for child_process in vitest jsdom environment
metrics:
  duration: "339 seconds (~6 minutes)"
  completed: "2026-04-21"
  tasks_completed: 3
  files_count: 2
---

# Phase 64 Plan 01: searchCode Server Action Summary

**One-liner:** ripgrep-based `searchCode` server action with rg availability check, glob filter, relative path output, and result truncation.

## What Was Built

`src/actions/search-code-actions.ts` — Server action that wraps ripgrep for code search:

- **Types exported:** `SearchMatch` (filePath, lineNumber, lineText, submatches), `SearchResult` (matches, truncated, error?)
- **`searchCode(localPath, pattern, glob?, maxResults=200)`** — async server action:
  - Zod validation: localPath (abs path), pattern (1-500 chars), glob (200 chars max), maxResults (1-500)
  - Checks rg availability via `execFileSync("which", ["rg"])` — returns user-friendly error if missing
  - Builds `rg --json -n [pattern] [--glob glob] [path]` args (no shell)
  - Parses JSON output lines, filters `type==="match"`, strips localPath prefix for relative paths
  - rg exit code 1 (no matches) → `{ matches: [], truncated: false }` (not an error)
  - rg exit code 2+ → `{ matches: [], truncated: false, error: String(err) }`
  - Truncates at maxResults, sets `truncated: true` when exceeded

## Test Coverage

`src/actions/__tests__/search-code-actions.test.ts` — 8 tests, all passing:

1. rg exit 0 → returns non-empty matches array, no error
2. rg exit 1 → empty matches, truncated=false, no error
3. rg exit 2+ → error string returned
4. rg not installed → error includes "ripgrep"
5. glob filter → --glob and value passed to execFileSync args
6. filePath is relative (strips localPath prefix)
7. match has lineNumber, lineText, submatches with start/end
8. 250 matches with maxResults=200 → 200 matches, truncated=true

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Changed child_process import from node: prefix to bare specifier**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** `import { execFileSync } from "node:child_process"` caused vitest to throw "No 'default' export defined on mock" — the node: prefix prevents the mock from being applied correctly in jsdom environment
- **Fix:** Changed to `import { execFileSync } from "child_process"` and updated test mock to include `default: { execFileSync: mockExecFileSync }` — consistent with project-actions.ts convention
- **Files modified:** `src/actions/search-code-actions.ts`, `src/actions/__tests__/search-code-actions.test.ts`
- **Commit:** 3e07d2e

## Commits

| Hash | Message |
|------|---------|
| 18e0a47 | test(code-search-64.01): add failing tests for searchCode server action |
| 3e07d2e | feat(code-search-64.01): implement searchCode server action with ripgrep integration |

## Known Stubs

None — all logic is fully implemented with real rg invocation and JSON parsing.

## Self-Check: PASSED
