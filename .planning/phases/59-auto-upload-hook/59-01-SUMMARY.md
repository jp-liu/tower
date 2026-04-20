---
phase: 59-auto-upload-hook
plan: 01
subsystem: hooks
tags: [posttooluse, hook, upload, env-vars, internal-api]

requires:
  - phase: 35-env-injection
    provides: PTY env injection pattern (envOverrides)
provides:
  - TOWER_TASK_ID/TOWER_API_URL env injection in all PTY sessions
  - Internal upload API at /api/internal/hooks/upload (GET config + POST upload)
  - PostToolUse hook script for auto-capturing file outputs
affects: [60-resource-attribution]

tech-stack:
  added: []
  patterns: [PostToolUse hook pattern, fire-and-forget upload]

key-files:
  created:
    - src/app/api/internal/hooks/upload/route.ts
    - scripts/post-tool-hook.js
  modified:
    - src/actions/agent-actions.ts
    - .claude/rules/security.md

key-decisions:
  - "Hook uses Node.js builtins only (http, fs, path) for Node 16+ compatibility"
  - "GET endpoint returns type whitelist so hook can dynamically check allowed extensions"
  - "Filename collision resolved by appending timestamp before extension"

patterns-established:
  - "PostToolUse hook: gate on env var, parse stdin JSON, fire-and-forget HTTP"
  - "Internal hooks API: localhost-guarded, CUID-validated, config-driven whitelist"

requirements-completed: [HOOK-01, HOOK-02, HOOK-04, HOOK-05]

duration: 4min
completed: 2026-04-20
---

# Phase 59 Plan 01: Auto-Upload Hook Summary

**PostToolUse hook script + internal upload API + AI_MANAGER_* to TOWER_* env var migration for automatic asset capture during task execution**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-20T16:57:40Z
- **Completed:** 2026-04-20T17:01:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Renamed all AI_MANAGER_* environment variables to TOWER_* equivalents across 3 injection sites
- Created internal upload API with size limit, type whitelist, localhost guard, and DB record creation
- Built PostToolUse hook script that auto-captures file outputs matching configured extensions

## Task Commits

Each task was committed atomically:

1. **Task 1: Env var rename and upload API endpoint** - `f22d02d` (feat)
2. **Task 2: PostToolUse hook script** - `a26f487` (feat)

## Files Created/Modified
- `src/actions/agent-actions.ts` - Renamed env vars, added TOWER_API_URL injection
- `src/app/api/internal/hooks/upload/route.ts` - GET (config) + POST (upload) handlers
- `scripts/post-tool-hook.js` - PostToolUse hook for Claude Code
- `.claude/rules/security.md` - Updated signal dir reference

## Decisions Made
- Hook uses only Node.js builtins (no fetch) for Node 16+ compatibility
- GET endpoint returns type whitelist so hook can dynamically adapt to config changes
- Filename collision uses timestamp suffix rather than random UUID (simpler, debuggable)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Upload API and hook script ready for integration testing
- Phase 59 Plan 02 can build on the hook infrastructure for signal-based notifications

---
*Phase: 59-auto-upload-hook*
*Completed: 2026-04-20*
