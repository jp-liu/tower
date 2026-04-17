---
phase: 36-assistant-backend
plan: 01
subsystem: api
tags: [pty, claude-cli, server-actions, config, vitest]

# Dependency graph
requires:
  - phase: 35-missions-dashboard
    provides: PTY session-store (createSession/destroySession/getSession), CliProfile DB model
provides:
  - ASSISTANT_SESSION_KEY = "__assistant__" constant
  - startAssistantSession server action — spawns Claude CLI PTY with --allowedTools mcp__tower__* and --append-system-prompt
  - stopAssistantSession server action — destroys assistant PTY session
  - getAssistantSessionStatus server action — returns running/idle
  - assistant.systemPrompt and assistant.displayMode config entries in CONFIG_DEFAULTS
affects: [36-assistant-backend, 36-02, ws-server, api-internal-terminal]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Assistant session uses special __assistant__ key separate from task sessions
    - No AI_MANAGER_TASK_ID injection for assistant (stateless, no task binding)
    - vitest.config.ts include pattern extended to discover src/**/__tests__/**

key-files:
  created:
    - src/actions/assistant-actions.ts
    - src/actions/__tests__/assistant-actions.test.ts
  modified:
    - src/lib/config-defaults.ts
    - vitest.config.ts

key-decisions:
  - "ASSISTANT_SESSION_KEY exported as a constant so ws-server and API routes can import it"
  - "No AI_MANAGER_TASK_ID in assistant envOverrides — assistant is stateless and not bound to a task"
  - "vitest include pattern extended to also cover src/**/__tests__/**/*.test.{ts,tsx}"

patterns-established:
  - "Pattern 1: Assistant session key __assistant__ isolates assistant PTY from task PTYs in shared session-store"
  - "Pattern 2: destroySession called before createSession in startAssistantSession to guarantee fresh session"

requirements-completed: [BE-01, BE-02, BE-03, BE-05, BE-06, UX-01]

# Metrics
duration: 15min
completed: 2026-04-17
---

# Phase 36 Plan 01: Assistant Backend Summary

**Claude CLI PTY session lifecycle server actions for global assistant — spawns restricted session with --allowedTools mcp__tower__* and --append-system-prompt, keyed by __assistant__**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-17T10:14:57Z
- **Completed:** 2026-04-17T10:30:00Z
- **Tasks:** 3 (Task 0, Task 1, Task 2)
- **Files modified:** 4

## Accomplishments

- Created assistant-actions.ts with three exported server actions (start/stop/status)
- Registered assistant.systemPrompt and assistant.displayMode in CONFIG_DEFAULTS
- Added Vitest test stub for Nyquist compliance; extended vitest.config.ts include pattern

## Task Commits

Each task was committed atomically:

1. **Task 0: Create assistant-actions test stub** - `b404307` (test)
2. **Task 1: Register assistant config keys** - `6ec08f9` (feat)
3. **Task 2: Create assistant-actions.ts** - `11d9f0b` (feat)

## Files Created/Modified

- `src/actions/assistant-actions.ts` - Three server actions: startAssistantSession, stopAssistantSession, getAssistantSessionStatus; exports ASSISTANT_SESSION_KEY
- `src/actions/__tests__/assistant-actions.test.ts` - 8 it.todo Vitest stubs for Nyquist compliance
- `src/lib/config-defaults.ts` - Added assistant.systemPrompt and assistant.displayMode entries
- `vitest.config.ts` - Extended include pattern to discover src/**/__tests__/**/*.test.{ts,tsx}

## Decisions Made

- Exported ASSISTANT_SESSION_KEY so downstream modules (ws-server, API routes) can import it without string duplication
- No AI_MANAGER_TASK_ID in assistant env overrides — assistant is a stateless operator, not a task executor
- Extended vitest config include pattern as a Rule 3 auto-fix since test stub path was outside the original include glob

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended vitest include pattern to discover src/__tests__ files**
- **Found during:** Task 0 (Create test stub)
- **Issue:** vitest.config.ts only included `tests/**/*.test.{ts,tsx}`; plan specified creating file at `src/actions/__tests__/assistant-actions.test.ts` which was outside the include glob
- **Fix:** Added `"src/**/__tests__/**/*.test.{ts,tsx}"` to the include array in vitest.config.ts
- **Files modified:** vitest.config.ts
- **Verification:** `pnpm vitest run --reporter=verbose src/actions/__tests__/assistant-actions.test.ts` shows 8 todo tests discovered
- **Committed in:** b404307 (Task 0 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking config issue)
**Impact on plan:** Necessary fix; plan goal of Vitest discovering the stub file required config update.

## Issues Encountered

None beyond the vitest config deviation documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- assistant-actions.ts is ready for Plan 02 (WebSocket + UI integration)
- ASSISTANT_SESSION_KEY exported for ws-server and API route consumption
- Config keys registered, readable via readConfigValue in any server context
- No blockers

---
*Phase: 36-assistant-backend*
*Completed: 2026-04-17*
