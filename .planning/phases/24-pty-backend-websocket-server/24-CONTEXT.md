# Phase 24: PTY Backend & WebSocket Server - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning
**Mode:** Infrastructure phase — decisions locked by research

<domain>
## Phase Boundary

Build the server-side PTY terminal infrastructure: (1) install node-pty + ws, configure --webpack flag, (2) PTY session registry (Map<taskId, PtySession>) with create/get/destroy/cleanup, (3) WebSocket server on port 3001 started from instrumentation.ts, (4) WS↔PTY bidirectional I/O forwarding, (5) PTY keepalive on WS disconnect (30s timeout), (6) Origin validation (localhost only), (7) double-kill guard + cleanup on process exit.

</domain>

<decisions>
## Implementation Decisions

### Infrastructure
- **D-01:** Install `node-pty` + `ws`. Add `node-pty` to `pnpm.onlyBuiltDependencies` in package.json (follows existing pattern for prisma, esbuild).
- **D-02:** Switch `next dev --turbo` to `next dev --webpack` in package.json dev script. Turbopack cannot bundle node-pty native addon (Next.js issue #85449).
- **D-03:** `node-pty` is on Next.js's automatic `serverExternalPackages` list — no next.config changes needed.

### PTY Session Registry
- **D-04:** New `src/lib/pty-session-manager.ts` — module-level `Map<string, PtySession>` singleton. PtySession holds: `pty: IPty`, `taskId: string`, `buffer: string` (ring buffer for reconnect replay), `killed: boolean`, `disconnectTimer: NodeJS.Timeout | null`.
- **D-05:** `createSession(taskId, command, args, cwd)` → spawns node-pty, registers in map, sets up onData/onExit handlers.
- **D-06:** `destroySession(taskId)` → kills PTY (with double-kill guard: check `killed` flag + try-catch), clears from map.
- **D-07:** PTY onExit handler: sets `killed=true`, does NOT call `pty.kill()`, clears from registry after persisting exit info.
- **D-08:** Cleanup on SIGTERM: iterate all sessions and kill, called from `process.on('SIGTERM')`.

### WebSocket Server
- **D-09:** `src/lib/ws-server.ts` — creates `ws.WebSocketServer({ port: 3001 })`. Exported as `startWsServer()` called from `instrumentation.ts register()`.
- **D-10:** WS connection URL pattern: `ws://localhost:3001/terminal?taskId=xxx`. Parse taskId from URL, look up or create PTY session.
- **D-11:** Origin validation: reject connections where origin header is not localhost. Return 403 in upgrade handler.
- **D-12:** WS message → PTY: `ws.on('message', data => pty.write(data))`. PTY → WS: `pty.onData(data => ws.send(data))`.
- **D-13:** Resize message: JSON `{ type: "resize", cols: N, rows: N }` → `pty.resize(cols, rows)`. Distinguish from regular input by checking if message starts with `{`.
- **D-14:** WS close → don't kill PTY. Start 30s disconnect timer. If WS reconnects within 30s, cancel timer and replay buffer. If timeout, destroy session.
- **D-15:** Buffer: ring buffer (last 50KB) of PTY output for reconnect replay.

### Claude's Discretion
- Ring buffer implementation details (array vs string slice)
- Exact error message format for rejected origins
- Whether to log WS connections/disconnections (recommend: yes for debugging)
- Test file structure and mock strategy for node-pty

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/instrumentation.ts` — already runs at server start for worktree pruning, extend with WS server boot
- `src/lib/adapters/process-manager.ts` — existing process lifecycle pattern (Map<string, ChildProcess> singleton)
- `src/lib/adapters/preview-process-manager.ts` — simpler singleton pattern, good reference
- `pnpm.onlyBuiltDependencies` in package.json — already has `["@prisma/client", "prisma", "esbuild"]`

### Integration Points
- `instrumentation.ts register()` — add `startWsServer()` call
- `package.json` scripts.dev — change `--turbo` to `--webpack`
- Phase 25 will consume WS server from browser via `new WebSocket("ws://localhost:3001/terminal?taskId=xxx")`
- Phase 26 will trigger session creation when user clicks "Execute"

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase, follow research patterns.

</specifics>

<deferred>
## Deferred Ideas

- Terminal session reconnect with full buffer replay (WS-03 covers basic 30s keepalive, full reconnect deferred to v0.8)
- @xterm/addon-serialize for persistent terminal state

</deferred>

---

*Phase: 24-pty-backend-websocket-server*
*Context gathered: 2026-04-02*
