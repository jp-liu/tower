---
phase: 05-mcp-knowledge-tools
plan: 01
subsystem: mcp
tags: [mcp, fuzzy-matching, project-identification, scoring]
dependency_graph:
  requires: [src/mcp/db.ts]
  provides: [src/mcp/tools/knowledge-tools.ts, knowledgeTools.identify_project]
  affects: [src/mcp/server.ts (needs registration)]
tech_stack:
  added: []
  patterns: [confidence-scoring, js-side-filtering, tdd]
key_files:
  created:
    - src/mcp/tools/knowledge-tools.ts
    - tests/unit/mcp/identify-project.test.ts
  modified: []
decisions:
  - "scoreProject uses Math.max across name/alias/desc tiers — single function, no ambiguity about which field wins"
  - "Fetch all projects in JS then score (no mode:insensitive SQLite limitation) — correct approach for small-to-medium project sets"
  - "Export scoreProject separately for direct unit testing — keeps handler logic thin and testable"
metrics:
  duration: 101s
  completed: 2026-03-27T08:26:19Z
  tasks: 1
  files_created: 2
---

# Phase 05 Plan 01: identify_project MCP Tool Summary

**One-liner:** Fuzzy project identification MCP tool using confidence-scored name/alias/description matching with MIN_CONFIDENCE=0.3 filter and DESC sort.

## What Was Built

Created `src/mcp/tools/knowledge-tools.ts` exporting:
- `scoreProject(project, query)` — pure function returning 0-1 confidence using tiered matching: name exact (1.0) > name starts-with (0.9) > alias exact (0.85) > name contains (0.75) = alias starts-with (0.75) > alias contains (0.6) > desc contains (0.4)
- `knowledgeTools` object with `identify_project` tool: fetches all projects from DB, scores each in JS, filters out < 0.3, sorts DESC, returns `{ projectId, name, alias, workspaceId, workspaceName, confidence }`

Created `tests/unit/mcp/identify-project.test.ts` with 17 tests covering all scoring tiers and handler behavior.

## Decisions Made

1. **scoreProject exported as named export** — direct unit testing of scoring logic without DB calls; handler stays thin
2. **JS-side scoring** — SQLite does not support `mode: "insensitive"` Prisma filter; fetching all projects and scoring in JS is correct for local-use tool with small project sets
3. **Math.max across tiers** — prevents double-counting; the best matching field wins per project

## Deviations from Plan

None — plan executed exactly as written. TDD flow: RED (file not found error) → GREEN (all 17 tests pass).

## Test Results

```
Test Files  1 passed (1)
     Tests  17 passed (17)
  Duration  281ms
```

All scoring tiers confirmed: exact name=1.0, startsWith=0.9, exact alias=0.85, contains name/alias-startsWith=0.75, alias-contains=0.6, desc-contains=0.4, no-match=0.0.

## Known Stubs

None — `identify_project` returns real DB data with real scoring. No stub data or placeholder values.

## Self-Check

Files exist:
- [x] `/Users/liujunping/project/i/ai-manager/src/mcp/tools/knowledge-tools.ts` — FOUND
- [x] `/Users/liujunping/project/i/ai-manager/tests/unit/mcp/identify-project.test.ts` — FOUND

Commits:
- [x] `e4f4078` — `feat(05-01): implement identify_project MCP tool with scored matching`
