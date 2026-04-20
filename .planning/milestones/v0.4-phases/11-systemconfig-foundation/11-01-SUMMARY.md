---
phase: 11-systemconfig-foundation
plan: "01"
subsystem: database
tags: [prisma, sqlite, server-actions, config, key-value]

# Dependency graph
requires: []
provides:
  - SystemConfig Prisma model with key @unique and JSON-serialized value
  - getConfigValue<T>(key, defaultValue) server action with JSON.parse fallback
  - setConfigValue(key, value) upsert server action
  - getConfigValues(keys[]) batch read server action with CONFIG_DEFAULTS fallback
  - ConfigEntry interface and empty CONFIG_DEFAULTS registry (src/lib/config-defaults.ts)
affects:
  - 12-gitpath-config
  - 13-system-params
  - 14-config-reactivity

# Tech tracking
tech-stack:
  added: []
  patterns: [JSON-serialized config values in SQLite, typed getConfigValue<T> with defaultValue fallback]

key-files:
  created:
    - prisma/schema.prisma (SystemConfig model added)
    - src/actions/config-actions.ts
    - src/lib/config-defaults.ts
    - tests/unit/actions/config-actions.test.ts
  modified:
    - prisma/schema.prisma

key-decisions:
  - "Values stored as JSON strings — supports string, number, boolean, object uniformly via JSON.parse/stringify"
  - "getConfigValue<T> returns defaultValue on missing row or malformed JSON — never throws"
  - "setConfigValue uses upsert — single call handles both create and update paths"
  - "CONFIG_DEFAULTS registry empty in Phase 11 — Phase 12-13 will add entries as parameters are wired"
  - "revalidatePath omitted from setConfigValue — settings page is client component, no effect"

patterns-established:
  - "Config read: db.systemConfig.findUnique + JSON.parse with try/catch defaultValue fallback"
  - "Config write: db.systemConfig.upsert with JSON.stringify"
  - "Batch config read: db.systemConfig.findMany({ where: { key: { in: keys } } }) + CONFIG_DEFAULTS fallback"

requirements-completed: [CFG-01]

# Metrics
duration: 4min
completed: "2026-03-30"
---

# Phase 11 Plan 01: SystemConfig Foundation Summary

**Prisma SystemConfig table + typed getConfigValue/setConfigValue/getConfigValues server actions with JSON round-trip, upsert, and CONFIG_DEFAULTS registry**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-30T09:19:57Z
- **Completed:** 2026-03-30T09:23:46Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 4

## Accomplishments

- SystemConfig model added to Prisma schema (key @unique, value String, createdAt, updatedAt)
- `prisma db push` created SystemConfig table in SQLite
- Three server actions exported: getConfigValue (typed generic with fallback), setConfigValue (upsert), getConfigValues (batch with CONFIG_DEFAULTS fallback)
- ConfigEntry interface and empty CONFIG_DEFAULTS registry ready for Phase 12-13 entries
- 9 unit tests passing covering: default fallback, string/number/boolean round-trips, upsert update path, malformed JSON fallback, batch read with missing key

## Task Commits

Each task was committed atomically:

1. **TDD RED: SystemConfig test file** - `2f8b7b4` (test)
2. **TDD GREEN: SystemConfig implementation** - `1b56b17` (feat)

_Note: TDD tasks have two commits (test RED → feat GREEN)_

## Files Created/Modified

- `prisma/schema.prisma` - Added SystemConfig model (key @unique, value String, timestamps)
- `src/actions/config-actions.ts` - Three server actions: getConfigValue, setConfigValue, getConfigValues
- `src/lib/config-defaults.ts` - ConfigEntry interface + empty CONFIG_DEFAULTS registry
- `tests/unit/actions/config-actions.test.ts` - 9 unit tests (9/9 passing)

## Decisions Made

- Values stored as JSON strings (not typed columns) — uniform treatment of string/number/boolean/object
- `getConfigValue<T>` catches JSON.parse errors and returns defaultValue — never throws to caller
- `revalidatePath` not called in `setConfigValue` — settings page is a client component, cache invalidation has no effect (Phase 14 CFG-02 will add reactivity)
- CONFIG_DEFAULTS registry starts empty — Phase 12-13 will populate it as concrete parameters are wired

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Worktree node_modules were missing on first run — resolved by running `pnpm install` in the worktree directory
- First `prisma db push` prompted about FTS5 WAL file tables — second run succeeded cleanly as WAL was reconciled

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SystemConfig infrastructure complete — Phase 12 (Git path mapping) and Phase 13 (system params) can immediately call getConfigValue/setConfigValue
- CONFIG_DEFAULTS registry ready for Phase 12-13 to add entries
- FTS5 notes_fts virtual table may need re-initialization after db push (existing pattern: `pnpm db:init-fts`)

## Self-Check: PASSED

- FOUND: prisma/schema.prisma
- FOUND: src/actions/config-actions.ts
- FOUND: src/lib/config-defaults.ts
- FOUND: tests/unit/actions/config-actions.test.ts
- FOUND: 11-01-SUMMARY.md
- FOUND commit: 2f8b7b4 (test RED)
- FOUND commit: 1b56b17 (feat GREEN)

---
*Phase: 11-systemconfig-foundation*
*Completed: 2026-03-30*
