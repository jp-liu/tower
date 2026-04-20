---
phase: 30-schema-foundation
plan: "01"
subsystem: database
tags: [prisma, sqlite, schema, cli-profile, task-execution]

# Dependency graph
requires: []
provides:
  - CliProfile model in Prisma schema with name/command/baseArgs/envVars/isDefault fields
  - TaskExecution.callbackUrl nullable field
  - Default CliProfile row seeded (command=claude, baseArgs=[--dangerously-skip-permissions], isDefault=true)
  - Prisma client exports CliProfile type
affects:
  - 31-cli-profile-api
  - 32-notify-agi
  - 33-mcp-terminal-tools
  - 34-idle-detection-callback
  - 35-data-model-cleanup

# Tech tracking
tech-stack:
  added: []
  patterns:
    - JSON-serialized string arrays in SQLite (baseArgs, envVars) with JSON.parse() on consumer side
    - Idempotent seed via upsert({ where: { name }, update: {}, create: {...} })

key-files:
  created: []
  modified:
    - prisma/schema.prisma
    - prisma/seed.ts

key-decisions:
  - "CliProfile.baseArgs stored as JSON string (not String[]) — SQLite has no native array type; consumers call JSON.parse()"
  - "CliProfile.envVars stored as JSON string object — same SQLite string storage pattern as baseArgs"
  - "Default CliProfile uses upsert (not create) for idempotent seeding"
  - "callbackUrl placed between exitCode and terminalLog in TaskExecution — nullable String? for DATA-01"

patterns-established:
  - "JSON string columns: baseArgs/envVars follow same pattern as AgentConfig.settings — String column, JSON.stringify on write, JSON.parse on read"
  - "Idempotent seed upsert: upsert with update: {} means re-running seed never fails on unique constraint"

requirements-completed: [DATA-01, DATA-02, CLIP-01]

# Metrics
duration: 5min
completed: 2026-04-11
---

# Phase 30 Plan 01: Schema Foundation Summary

**CliProfile model with command/baseArgs/envVars/isDefault added to Prisma schema + TaskExecution.callbackUrl field + default seeded row for Claude CLI spawning**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-11T02:03:00Z
- **Completed:** 2026-04-11T02:08:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added CliProfile model to Prisma schema with all fields required for configurable CLI spawning (CLIP-01)
- Added TaskExecution.callbackUrl nullable field for external dispatch notification (DATA-01)
- Ran prisma db push + prisma generate — database and client in sync (DATA-02)
- Seeded default CliProfile row: command="claude", baseArgs=["--dangerously-skip-permissions"], isDefault=true
- Verified seed is idempotent — running twice exits 0 without unique constraint violation

## Task Commits

Each task was committed atomically:

1. **Task 1: Add CliProfile model and TaskExecution.callbackUrl to Prisma schema** - `c3aeabf` (feat)
2. **Task 2: Seed default CliProfile row** - `3cfc112` (feat)

## Files Created/Modified
- `prisma/schema.prisma` - Added CliProfile model (after AgentConfig) and callbackUrl field on TaskExecution
- `prisma/seed.ts` - Added cliProfile.deleteMany() + cliProfile.upsert() for default row

## Decisions Made
- CliProfile.baseArgs stored as JSON string (not String[]) — SQLite has no native array type; consumers call JSON.parse(). Consistent with existing AgentConfig.settings pattern.
- Default profile uses upsert (not create) for idempotent seeding — avoids unique constraint failure on repeated db:seed runs.
- callbackUrl placed between exitCode and terminalLog in TaskExecution — maintains logical field order (execution result fields grouped together).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing tsc errors in agent-config-actions.ts and pty-session.test.ts were present before this plan (noted in STATE.md). No new errors introduced by schema changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Prisma client now exports CliProfile type — Phase 31 (CLI Profile API) can import and use it
- callbackUrl on TaskExecution ready for Phase 34 (idle detection callback) to populate
- Default CliProfile row in database — Phase 31 API endpoints can query `where: { isDefault: true }`

---
*Phase: 30-schema-foundation*
*Completed: 2026-04-11*
