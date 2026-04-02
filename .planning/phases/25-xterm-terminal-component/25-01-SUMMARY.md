---
phase: 25-xterm-terminal-component
plan: "01"
subsystem: ui
tags: [xterm, terminal, i18n, websocket, webgl]

# Dependency graph
requires:
  - phase: 24-pty-backend-websocket-server
    provides: WebSocket server on port 3001 accepting taskId param
provides:
  - "@xterm/addon-attach installed for WS<->xterm piping"
  - "@xterm/addon-webgl installed for GPU-accelerated terminal rendering"
  - "terminal.* i18n keys in both zh and en locales (6 keys each)"
affects:
  - 25-02-task-terminal-component

# Tech tracking
tech-stack:
  added:
    - "@xterm/addon-attach 0.12.0"
    - "@xterm/addon-webgl 0.19.0"
  patterns: []

key-files:
  created: []
  modified:
    - package.json
    - pnpm-lock.yaml
    - src/lib/i18n.tsx

key-decisions:
  - "@xterm/addon-webgl 0.19.0 installed (latest, not pinned) — plan specified 'latest'"
  - "Pre-existing TypeScript errors in agent-config-actions.ts are out of scope — not introduced by this plan"

patterns-established: []

requirements-completed:
  - TERM-01
  - TERM-02
  - TERM-03
  - TERM-04

# Metrics
duration: 3min
completed: 2026-04-02
---

# Phase 25 Plan 01: xterm Addon Dependencies and Terminal i18n Keys

**Installed @xterm/addon-attach (WS bridge) and @xterm/addon-webgl (GPU renderer), plus 12 terminal.* i18n keys across zh and en locales for Phase 25 TaskTerminal component**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-02T13:15:00Z
- **Completed:** 2026-04-02T13:18:00Z
- **Tasks:** 2
- **Files modified:** 3 (package.json, pnpm-lock.yaml, src/lib/i18n.tsx)

## Accomplishments
- Installed @xterm/addon-attach 0.12.0 — enables automatic WebSocket<->xterm bidirectional piping (AttachAddon)
- Installed @xterm/addon-webgl 0.19.0 — enables GPU-accelerated canvas renderer for high-volume PTY output
- Added 6 terminal.* i18n keys to zh locale (connecting, connected, disconnected, reconnecting, noWorktree, noWorktreeDesc)
- Added 6 terminal.* i18n keys to en locale with English translations

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @xterm/addon-attach and @xterm/addon-webgl** - `e6df5e2` (chore)
2. **Task 2: Add terminal i18n keys to both zh and en locales** - `8eacf7d` (feat)

## Files Created/Modified
- `package.json` - Added @xterm/addon-attach and @xterm/addon-webgl to dependencies
- `pnpm-lock.yaml` - Updated lockfile with new packages
- `src/lib/i18n.tsx` - Added 6 terminal.* keys to zh block (line 416-421) and 6 to en block (line 814-819)

## Decisions Made
- @xterm/addon-webgl resolved to 0.19.0 (latest at time of install) — plan specified "latest"
- Pre-existing TypeScript errors in agent-config-actions.ts are out of scope for this plan — not introduced by i18n changes; i18n.tsx type extension works correctly via `TranslationKey = keyof typeof translations.zh`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing TypeScript errors exist in agent-config-actions.ts (Prisma InputJsonValue type mismatch) — confirmed not related to this plan's changes, no action taken.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both xterm addons importable from node_modules
- All terminal.* i18n keys available in both locales
- Plan 25-02 (TaskTerminal component) can proceed: @xterm/addon-attach + @xterm/addon-webgl + i18n keys are ready

---
*Phase: 25-xterm-terminal-component*
*Completed: 2026-04-02*
