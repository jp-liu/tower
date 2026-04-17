---
phase: 36-assistant-backend
plan: 02
subsystem: api
tags: [websocket, pty, next-js, internal-api, assistant]

# Dependency graph
requires:
  - phase: 36-assistant-backend-01
    provides: startAssistantSession/stopAssistantSession/getAssistantSessionStatus actions, ASSISTANT_SESSION_KEY constant, internal-api-guard

provides:
  - WebSocket server immediately destroys __assistant__ session on WS close (no keepalive)
  - POST /api/internal/assistant — starts assistant PTY session, returns sessionKey
  - DELETE /api/internal/assistant — stops assistant PTY session
  - GET /api/internal/assistant — returns session status (running/idle)
  - Vitest test stubs for ws-server assistant WS behavior (Wave 0)

affects: [36-assistant-ui, phase-37-ui-components]

# Tech tracking
tech-stack:
  added: []
  patterns: [localhost-only internal API routes, immediate PTY destroy on WS close for stateless sessions]

key-files:
  created:
    - src/app/api/internal/assistant/route.ts
    - src/lib/pty/__tests__/ws-server-assistant.test.ts
  modified:
    - src/lib/pty/ws-server.ts

key-decisions:
  - "ASSISTANT_SESSION_KEY imported from @/lib/assistant-constants in ws-server.ts and route.ts (not from use server file)"
  - "Internal assistant API does not call validateTaskId — __assistant__ is not a CUID format"
  - "Assistant WS close destroys session immediately (no keepalive) — stateless design: each open = fresh session"

patterns-established:
  - "Pattern: Stateless session types bypass keepalive via identity check (ASSISTANT_SESSION_KEY) before setTimeout"
  - "Pattern: Internal API routes import shared constants from lib/, not from use server action files"

requirements-completed: [BE-04, BE-05]

# Metrics
duration: 2min
completed: 2026-04-17
---

# Phase 36 Plan 02: Assistant Backend — WebSocket + API Route Summary

**WebSocket immediate-destroy for __assistant__ sessions and POST/DELETE/GET internal API at /api/internal/assistant, all localhost-guarded**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-17T10:22:00Z
- **Completed:** 2026-04-17T10:23:32Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Added Vitest test stubs for WS assistant behavior (3 todos covering BE-05 scenarios)
- Modified ws-server.ts close handler to immediately destroy `__assistant__` sessions on WS disconnect — no keepalive delay for stateless assistant
- Created `/api/internal/assistant` route with POST (start), DELETE (stop), GET (status) handlers, all guarded by `requireLocalhost`

## Task Commits

Each task was committed atomically:

1. **Task 0: Create ws-server-assistant test stub** - `0ab1f0b` (test)
2. **Task 1: Add assistant keepalive bypass in ws-server** - `4fc75ef` (feat)
3. **Task 2: Create internal assistant API route** - `a09ad35` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/lib/pty/__tests__/ws-server-assistant.test.ts` - Vitest stubs for assistant WS behavior (Wave 0 Nyquist requirement)
- `src/lib/pty/ws-server.ts` - Added ASSISTANT_SESSION_KEY import + immediate-destroy guard in WS close handler (BE-05)
- `src/app/api/internal/assistant/route.ts` - Internal API route: POST start, DELETE stop, GET status — all localhost-guarded

## Decisions Made
- `ASSISTANT_SESSION_KEY` is imported from `@/lib/assistant-constants` (not from `@/actions/assistant-actions` which uses "use server") in both ws-server.ts and route.ts to avoid module boundary issues
- `validateTaskId` is deliberately NOT called — `__assistant__` is not CUID format
- The assistant guard in ws-server.ts checks `taskId === ASSISTANT_SESSION_KEY` before the keepalive setTimeout block, ensuring stateless behavior

## Deviations from Plan

### Auto-fixed Issues

**1. [Plan context note applied] Import ASSISTANT_SESSION_KEY from @/lib/assistant-constants**
- **Found during:** Task 1 and Task 2
- **Issue:** Plan originally showed import from `@/actions/assistant-actions`; important_context note clarified this would cause "use server" module boundary issues
- **Fix:** Imported `ASSISTANT_SESSION_KEY` from `@/lib/assistant-constants` in both ws-server.ts and route.ts; kept action function imports from assistant-actions.ts for the API route
- **Files modified:** src/lib/pty/ws-server.ts, src/app/api/internal/assistant/route.ts
- **Verification:** TypeScript compilation — no errors in new files

---

**Total deviations:** 1 (planned import path adjustment per important_context note)
**Impact on plan:** No scope creep. Adjustment ensures correct module boundary compliance.

## Issues Encountered
- Pre-existing test failures (instrumentation, component tests) unrelated to this plan — not addressed (out of scope)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- WebSocket and HTTP API layer complete for assistant session lifecycle
- Phase 37 UI components can now start/stop assistant via POST/DELETE to `/api/internal/assistant` and stream output via WebSocket with `taskId=__assistant__`
- No blockers

---
*Phase: 36-assistant-backend*
*Completed: 2026-04-17*
