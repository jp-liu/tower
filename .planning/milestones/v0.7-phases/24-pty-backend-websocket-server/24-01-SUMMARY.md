---
phase: 24-pty-backend-websocket-server
plan: 01
subsystem: infra
tags: [node-pty, websocket, ws, pty, terminal, native-addon]

# Dependency graph
requires: []
provides:
  - node-pty native addon installed and verified working on darwin-arm64
  - PtySession class with double-kill guard, ring buffer, lifecycle callbacks
  - session-store singleton (createSession/getSession/destroySession/destroyAllSessions)
  - SIGTERM handler for zombie process cleanup
affects:
  - 24-02 (WS server will import createSession/getSession/destroySession)
  - 25 (xterm.js connects to WS server that uses session-store)
  - 26 (task execution will call createSession)

# Tech tracking
tech-stack:
  added: [node-pty@1.1.0, ws@8.20.0, "@types/ws@8.18.1"]
  patterns:
    - Module-level Map<taskId, PtySession> singleton (same pattern as preview-process-manager)
    - Double-kill guard: killed boolean + try-catch on pty.kill()
    - Ring buffer for PTY output (50KB cap, string slice)
    - SIGTERM handler for graceful cleanup

key-files:
  created:
    - src/lib/pty/pty-session.ts
    - src/lib/pty/session-store.ts
  modified:
    - package.json

key-decisions:
  - "spawn-helper +x fix: pnpm strips execute permissions on native addon helpers; must chmod after rebuild"
  - "dev script --webpack (not --turbopack): Turbopack cannot bundle node-pty native addon (Next.js #85449)"
  - "node-pty in pnpm.onlyBuiltDependencies: required for native addon to compile during install"
  - "onExit sets killed=true but does NOT call pty.kill() — prevents double-kill crash (D-07)"
  - "No unit tests for session-store: node-pty native addon is hard to mock; integration tests deferred to Plan 02"

patterns-established:
  - "PtySession.killed flag guards all kill/write/resize operations"
  - "destroySession clears disconnectTimer before calling kill — prevents timer fires after session removal"
  - "createSession calls destroySession first — idempotent session creation"

requirements-completed: [PTY-01, PTY-02, PTY-03]

# Metrics
duration: 15min
completed: 2026-04-02
---

# Phase 24 Plan 01: PTY Backend Infrastructure Summary

**node-pty native addon installed + PtySession class with double-kill guard and ring buffer + session-store singleton with SIGTERM cleanup for zombie-free PTY lifecycle management**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-02T12:50:00Z
- **Completed:** 2026-04-02T13:05:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- node-pty 1.1.0 and ws 8.20.0 installed; native addon verified functional on darwin-arm64 (M1/M2/M3 Mac)
- Dev script switched from --turbopack to --webpack (required for native addon bundling)
- PtySession class: spawn/write/resize/kill with killed-flag double-kill guard and 50KB ring buffer
- session-store singleton: createSession/getSession/destroySession/destroyAllSessions + SIGTERM handler

## Task Commits

Each task was committed atomically:

1. **Task 1: Install packages and switch dev script to --webpack** - `859b0ca` (chore)
2. **Task 2: Implement PtySession class and session-store singleton** - `d02b9ae` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `package.json` - Changed dev script to --webpack; added node-pty to onlyBuiltDependencies; added node-pty, ws, @types/ws dependencies
- `src/lib/pty/pty-session.ts` - PtySession class with full lifecycle (spawn/write/resize/kill/buffer/onExit)
- `src/lib/pty/session-store.ts` - Module-level Map singleton with create/get/destroy/destroyAll + SIGTERM handler

## Decisions Made
- **spawn-helper permissions:** pnpm 10.x strips +x bit from native addon helpers. Fixed with `chmod +x`. This is a known pnpm behavior; rebuild via `pnpm rebuild node-pty` does not restore permissions. Documented for future devs.
- **No test file for session-store:** node-pty's native addon (.node) cannot be easily mocked in vitest. Integration tests will cover session-store behavior when the WS server is wired in Plan 02.
- **onExit does NOT call kill():** Per D-07, the PTY process has already exited when onExit fires. Calling kill() again would throw. Setting killed=true in onExit prevents any subsequent kill() calls from the double-kill guard.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed spawn-helper missing execute permissions**
- **Found during:** Task 1 (install packages)
- **Issue:** `pnpm rebuild node-pty` completed but `pty.spawn()` threw `posix_spawnp failed` because pnpm strips +x from the spawn-helper binary during unpack
- **Fix:** `chmod +x node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`
- **Files modified:** none (binary permissions only)
- **Verification:** `node -e "pty.spawn('/bin/bash', ['-c', 'echo ok'], ...)"` printed `ok`
- **Committed in:** 859b0ca (Task 1 commit, permission fix is runtime — not tracked in git)

---

**Total deviations:** 1 auto-fixed (1 bug — permissions)
**Impact on plan:** Required for node-pty to function at all. No scope creep.

## Issues Encountered
- pnpm 10.28.2 strips execute permissions from native addon `spawn-helper` binary on macOS. This is a known limitation. Future `pnpm install` runs after a fresh clone will also need `chmod +x` or a postinstall script. Noted as a concern for onboarding.

## User Setup Required
None — no external service configuration required. All changes are local.

## Next Phase Readiness
- Plan 02 can import `{ createSession, getSession, destroySession }` from `src/lib/pty/session-store.ts` directly
- Plan 02 can import `PtySession` from `src/lib/pty/pty-session.ts` for type annotations
- WS server (Plan 02) will call `createSession(taskId, 'bash', [], cwd, onData, onExit)` and wire onData to ws.send()
- No blockers for Plan 02

---
*Phase: 24-pty-backend-websocket-server*
*Completed: 2026-04-02*
