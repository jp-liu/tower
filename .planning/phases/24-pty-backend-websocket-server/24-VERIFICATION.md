---
phase: 24-pty-backend-websocket-server
verified: 2026-03-31T00:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 24: PTY Backend & WebSocket Server — Verification Report

**Phase Goal:** A working, leak-proof WebSocket server that spawns Claude CLI in a PTY, streams output, handles input and resize, and cleans up correctly
**Verified:** 2026-03-31
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | node-pty package is installed and its native addon compiles successfully | VERIFIED | `node -e "require('node-pty')"` exits 0; spawn test prints `ok` from bash subprocess |
| 2 | dev script uses --webpack flag (not --turbopack) | VERIFIED | `package.json` line 6: `"dev": "next dev --webpack"` |
| 3 | PtySession class can spawn a shell process in a real PTY | VERIFIED | `pty-session.ts` calls `pty.spawn(command, args, {...})` in constructor; end-to-end spawn test passes |
| 4 | Session store singleton holds sessions keyed by taskId | VERIFIED | `session-store.ts` module-level `const sessions = new Map<string, PtySession>()` with `createSession`/`getSession` |
| 5 | destroySession kills the PTY with double-kill guard and removes it from the map | VERIFIED | `destroySession` calls `sessions.delete(taskId)` then `session.kill()`; `kill()` has `if (this.killed) return` guard |
| 6 | PTY onExit sets killed=true without calling kill() to prevent double-kill crash | VERIFIED | `pty-session.ts` line 41-44: `this._pty.onExit(({ exitCode, signal }) => { this.killed = true; onExit(exitCode, signal); })` — no `kill()` call |
| 7 | SIGTERM handler iterates all sessions and destroys them (no zombie processes) | VERIFIED | `session-store.ts` lines 44-48: `process.on("SIGTERM", () => { destroyAllSessions(); })` |
| 8 | WebSocket server starts on port 3001 when Next.js starts | VERIFIED | `instrumentation.ts` calls `startWsServer()` inside `NEXT_RUNTIME === "nodejs"` guard; `startWsServer()` resolves after `httpServer.listen(3001, ...)` |
| 9 | Cross-origin connections (non-localhost origin) are rejected with 403 | VERIFIED | `ws-server.ts` uses `noServer: true` + HTTP upgrade handler; non-allowlisted origins get `HTTP/1.1 403 Forbidden` + `socket.destroy()` |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/pty/pty-session.ts` | PtySession class: spawn/write/resize/kill with killed flag guard | VERIFIED | 74 lines; exports `PtySession`; `killed` flag appears 7 times; 50KB ring buffer; double-kill guard in `kill()` |
| `src/lib/pty/session-store.ts` | Module-level Map singleton with create/get/destroy/cleanup | VERIFIED | 49 lines; exports `createSession`, `getSession`, `destroySession`, `destroyAllSessions`; SIGTERM handler registered |
| `src/lib/pty/ws-server.ts` | startWsServer() — WebSocket server on port 3001, handles connections, I/O forwarding, origin validation, reconnect keepalive | VERIFIED | 191 lines; exports `startWsServer`; all behavioral patterns confirmed |
| `src/instrumentation.ts` | register() calls startWsServer() in nodejs runtime guard | VERIFIED | Line 5-6: dynamic import of `ws-server` and `await startWsServer()` inside `NEXT_RUNTIME === "nodejs"` block |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/lib/pty/session-store.ts` | `src/lib/pty/pty-session.ts` | `new PtySession(taskId, command, args, cwd)` | WIRED | Line 17: `const session = new PtySession(taskId, command, args, cwd, onData, onExit)` |
| `package.json` | node-pty native addon | `pnpm.onlyBuiltDependencies` | WIRED | Line 24: `"node-pty"` in `onlyBuiltDependencies` array; `node-pty` in dependencies at line 47 |
| `src/instrumentation.ts` | `src/lib/pty/ws-server.ts` | dynamic import inside register() nodejs guard | WIRED | Line 5: `const { startWsServer } = await import("@/lib/pty/ws-server")` inside `NEXT_RUNTIME === "nodejs"` |
| `src/lib/pty/ws-server.ts` | `src/lib/pty/session-store.ts` | `createSession / getSession / destroySession` | WIRED | Line 4: static import of all three; used at lines 85, 104, 150, 156 |
| WS message handler | `pty.write()` | `session.write(data)` | WIRED | Lines 141-143: `session!.write(data)` called after JSON resize check |
| `pty.onData` | `ws.send()` | 8ms batch timer + bufferedAmount check | WIRED | `makeBatchedSender(ws)` passed as onData callback; batches with `BATCH_INTERVAL_MS = 8`; guards with `ws.bufferedAmount < SEND_BUFFER_MAX` |

---

### Data-Flow Trace (Level 4)

This phase produces infrastructure (PTY session manager + WS server) — not a data-rendering component. Data flow is validated through code inspection of I/O paths rather than DB/render tracing.

| Flow | Source | Sink | Produces Real Data | Status |
|------|--------|------|--------------------|--------|
| PTY output → WS client | `pty.onData` callback | `ws.send(pending)` via `makeBatchedSender` | Yes — real PTY process output | FLOWING |
| WS client input → PTY | `ws.on("message", ...)` | `session.write(data)` → `pty.write(data)` | Yes — raw terminal input bytes | FLOWING |
| Resize JSON → PTY resize | `ws.on("message", ...)` JSON parse | `session.resize(cols, rows)` → `pty.resize()` | Yes — actual terminal size change | FLOWING |
| Reconnect ring buffer | `session.getBuffer()` | `ws.send(buffer)` on reconnect | Yes — last 50KB of real PTY output | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| node-pty native addon loads | `node -e "require('node-pty')"` | Exit 0, no error | PASS |
| node-pty spawn produces output | `node -e "pty.spawn('/bin/bash', ['-c', 'echo ok'], ...)"` | Prints `ok` | PASS |
| ws package exports correct types | `node -e "const m = require('ws'); console.log(typeof m.WebSocketServer)"` | `function` | PASS |
| TypeScript compilation (phase files) | `npx tsc --noEmit` filtered to phase files | 0 errors in pty-session.ts / session-store.ts / ws-server.ts / instrumentation.ts | PASS |
| Pre-existing TS errors unaffected | `npx tsc --noEmit` total non-node_modules errors | 2 errors in `agent-config-actions.ts` only — pre-existing, not introduced by phase 24 | PASS |
| Commit hashes verified | `git log --oneline 058842a 0c16a89 d02b9ae 859b0ca` | All 4 commits exist in git history | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PTY-01 | 24-01-PLAN.md | 系统可通过 node-pty 为每个任务创建 PTY 伪终端会话 | SATISFIED | `PtySession` constructor calls `pty.spawn()`; `createSession` in session-store wires taskId to session |
| PTY-02 | 24-01-PLAN.md | PTY 会话注册表管理会话生命周期（创建/查询/销毁） | SATISFIED | `session-store.ts` exports `createSession`, `getSession`, `destroySession`, `destroyAllSessions` over a module-level `Map` |
| PTY-03 | 24-01-PLAN.md | PTY 进程退出或任务完成时自动清理（防止僵尸进程） | SATISFIED | SIGTERM handler calls `destroyAllSessions()`; `onExit` sets `killed=true`; `destroySession` clears disconnectTimer then calls `kill()` with double-kill guard |
| WS-01 | 24-02-PLAN.md | `instrumentation.ts` 启动独立 WebSocket server (port 3001) | SATISFIED | `instrumentation.ts` dynamically imports and calls `startWsServer()` inside nodejs runtime guard; listens on port 3001 |
| WS-02 | 24-02-PLAN.md | WebSocket 双向转发 xterm.js ↔ PTY 输入输出 | SATISFIED | `ws.on("message")` → `session.write(data)`; `makeBatchedSender` passes PTY output to `ws.send()` |
| WS-03 | 24-02-PLAN.md | WebSocket 连接断开时 PTY 保活（不立即销毁，等待重连） | SATISFIED | `ws.on("close")` starts 30s `disconnectTimer`; reconnect path cancels timer and replays `getBuffer()` |
| WS-04 | 24-02-PLAN.md | WebSocket Origin 校验防止 CSWSH 攻击 | SATISFIED | HTTP upgrade handler checks `ALLOWED_ORIGINS` set; non-matching origins receive `HTTP/1.1 403 Forbidden` + `socket.destroy()` |

**Orphaned requirements check:** REQUIREMENTS.md maps all 7 IDs (PTY-01 through WS-04) to Phase 24, all claimed in plan frontmatter. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/pty/ws-server.ts` | 103-116 | `createSession` called with `"bash"` as command | Info | Expected — Phase 26 will replace with real Claude CLI command. Not a stub: the WS server is fully functional with bash; the command is a known placeholder for the CLI integration phase. |

No blockers or warnings found. The `bash` default command is explicitly documented in both the SUMMARY and inline code comment ("Phase 26 will pass the real Claude CLI command"). All lifecycle, I/O, and safety patterns are fully implemented.

---

### Human Verification Required

#### 1. Live Connection Test

**Test:** Run `pnpm dev`, then connect via `wscat -c "ws://localhost:3001/terminal?taskId=test-1" -H "Origin: http://localhost:3000"` or a browser WebSocket client.
**Expected:** Terminal session opens, bash prompt appears, keystrokes are echoed, `{ "type": "resize", "cols": 120, "rows": 40 }` triggers resize without error.
**Why human:** Requires running the Next.js dev server and an interactive terminal client.

#### 2. Keepalive Behavior

**Test:** Connect, disconnect the WS client, wait 5 seconds, reconnect within 30 seconds.
**Expected:** Reconnected client receives ring buffer replay of previous output; bash session is still alive (PID unchanged).
**Why human:** Requires live timing across two WS connections to the same taskId.

#### 3. Zombie Process Check After Keepalive Expiry

**Test:** Connect, disconnect, wait 35 seconds, run `ps aux | grep -c defunct`.
**Expected:** Zero zombie processes; PTY session cleaned up by `destroySession` after 30s timer fires.
**Why human:** Requires live 35-second wait and process table inspection.

---

### Gaps Summary

No gaps found. All 9 observable truths are verified, all 4 artifacts exist and are substantive, all 6 key links are wired, all 7 requirement IDs are satisfied, and the TypeScript compilation introduces no new errors. The only noted item is the `bash` placeholder command, which is intentional and documented — Phase 26 replaces it with the actual Claude CLI invocation.

---

_Verified: 2026-03-31_
_Verifier: Claude (gsd-verifier)_
