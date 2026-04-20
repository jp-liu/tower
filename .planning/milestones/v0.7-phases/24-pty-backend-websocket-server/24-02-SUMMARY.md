---
phase: 24-pty-backend-websocket-server
plan: 02
subsystem: infra
tags: [websocket, ws, pty, terminal, origin-validation, keepalive, ring-buffer]

# Dependency graph
requires:
  - 24-01 (PtySession class, session-store singleton with createSession/getSession/destroySession)
provides:
  - startWsServer() — WebSocket server on port 3001 with full PTY↔WS I/O forwarding
  - Origin validation (CSWSH prevention) — rejects non-localhost with HTTP 403
  - 30s disconnect keepalive — WS close does NOT kill PTY
  - Ring buffer replay on reconnect — 50KB of PTY output replayed on reconnect within 30s
  - 8ms output batching + 64KB flood guard — prevents WS buffer overflow
  - WS server auto-start at Next.js startup via instrumentation.ts
affects:
  - 25 (xterm.js component connects to ws://localhost:3001/terminal?taskId={taskId})
  - 26 (task execution calls createSession with real Claude CLI command)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - noServer: true + HTTP upgrade handler for proper 403 rejection of cross-origin connections
    - 8ms batch timer accumulates PTY output chunks before sending to WS
    - disconnectTimer on PtySession cancels itself on reconnect (WS-03 keepalive pattern)
    - Dynamic import of ws-server inside instrumentation.ts nodejs guard (same pattern as pruneOrphanedWorktrees)

key-files:
  created:
    - src/lib/pty/ws-server.ts
  modified:
    - src/instrumentation.ts

key-decisions:
  - "noServer + HTTP upgrade handler: correct 403 rejection path for standalone WS server (not attached to Next.js HTTP server)"
  - "makeBatchedSender closes over ws reference: onData callback captures WS from connection scope — no Map lookup per chunk"
  - "session! non-null assertion: session is guaranteed non-null after the if/else create branch"

requirements-completed: [WS-01, WS-02, WS-03, WS-04]

# Metrics
duration: 182s
completed: 2026-04-02
---

# Phase 24 Plan 02: WebSocket Server Summary

**WebSocket server on port 3001 with full PTY↔WS bidirectional I/O, origin validation (CSWSH prevention), 30s disconnect keepalive, 50KB ring buffer reconnect replay, and 8ms output batching**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-02T13:00:15Z
- **Completed:** 2026-04-02T13:03:17Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `src/lib/pty/ws-server.ts` — full WS server implementation (190 lines)
  - Origin validation: HTTP upgrade handler rejects non-localhost with 403
  - Bidirectional I/O: WS message → session.write(), PTY onData → ws.send()
  - JSON resize detection: `{ type: "resize", cols, rows }` → session.resize()
  - 30s keepalive: WS close starts timer, reconnect cancels timer and replays ring buffer
  - 8ms output batching + bufferedAmount < 64KB flood guard
  - Exports `startWsServer()` as the only public API
- `src/instrumentation.ts` — extended register() to call startWsServer() in nodejs guard

## Task Commits

1. **Task 1: Implement ws-server.ts** - `058842a` (feat)
2. **Task 2: Wire startWsServer into instrumentation.ts** - `0c16a89` (feat)

## End-to-End Verification Results

### Origin rejection test (WS-04)

Verified using inline Node.js WS client on test port 3099:

| Test | Origin | Expected | Result |
|------|--------|----------|--------|
| Evil origin | http://evil.example.com | HTTP 403 | PASS |
| Localhost origin | http://localhost:3000 | Connect + receive data | PASS |
| No origin | (none) | HTTP 403 | PASS |

### TypeScript compilation

`npx tsc --noEmit` — no new errors in ws-server.ts or instrumentation.ts. Pre-existing errors in agent-config-actions.ts (Prisma type mismatch) are unrelated to this plan.

### Zombie process test

Not run live (dev server hook prevents running `pnpm dev` in automation). The 30s keepalive logic is verified by code inspection: `destroySession(taskId)` is called after `DISCONNECT_TIMEOUT_MS` expires, which calls `session.kill()` with double-kill guard.

## Protocol Documentation (for Phase 25)

### Connection

```
ws://localhost:3001/terminal?taskId={taskId}
Origin: http://localhost:3000   (required — non-localhost returns 403)
```

### Messages (client → server)

**Terminal input:** Raw string (any UTF-8 character, control sequences, etc.)

**Resize:** JSON object
```json
{ "type": "resize", "cols": 120, "rows": 40 }
```

### Messages (server → client)

Raw PTY output as string (ANSI escape sequences, UTF-8). Batched in 8ms windows.

### Reconnect behavior

1. Client reconnects within 30s → ring buffer (last 50KB) replayed immediately
2. Client reconnects after 30s → PTY has been destroyed; server creates new session
3. PTY exits cleanly → server logs exit code; client receives any remaining output in the batch buffer

## Ring Buffer

- Size: 50KB (50 * 1024 bytes)
- Implementation: string slice (last N bytes of concatenated output)
- Defined in: `src/lib/pty/pty-session.ts` `PtySession.BUFFER_MAX`

## Keepalive Window

- Duration: 30 seconds
- Configured: `DISCONNECT_TIMEOUT_MS = 30_000` in `src/lib/pty/ws-server.ts`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — the WS server is fully implemented. The `createSession` call uses `bash` as the default command. Phase 26 will replace this with the actual Claude CLI command when a task execution is triggered.

## Self-Check: PASSED

- [x] `src/lib/pty/ws-server.ts` — created (verified by git log 058842a)
- [x] `src/instrumentation.ts` — modified (verified by git log 0c16a89)
- [x] All grep acceptance criteria pass
- [x] Origin rejection PASS (tested inline)
- [x] TypeScript compiles with no new errors
