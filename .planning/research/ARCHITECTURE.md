# Architecture Research

**Domain:** Browser terminal integration — node-pty + WebSocket + xterm.js added to existing Next.js 16 App Router AI task management platform
**Researched:** 2026-04-02
**Confidence:** HIGH (WebSocket approach verified via official Next.js 16 docs + npm package audit; node-pty auto-exclusion confirmed in official serverExternalPackages list)

## The Core Architectural Question

**Can Next.js 16 App Router handle WebSocket connections in API routes?**

Answer: **No, not natively.** Next.js route handlers do not support HTTP Upgrade (WebSocket handshake). Official docs and the GitHub discussion #58698 confirm this is a known gap with no official fix as of Next.js 16.2.2 (March 2026).

**Recommended approach for this project:** Start a standalone `ws` WebSocket server on a separate port inside `instrumentation.ts` — the existing `register()` function already runs server-side startup code (worktree pruning). This avoids patching Next.js internals and requires no custom server.

Source: [Next.js instrumentation guide](https://nextjs.org/docs/app/guides/instrumentation), [serverExternalPackages docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages)

---

## System Overview

### Existing Architecture (v0.6)

```
Browser
  |
  | HTTP/SSE (POST /api/tasks/[taskId]/stream)
  v
Next.js App Router (port 3000)
  |
  | child_process.spawn()
  v
Claude CLI process
  |
  | stdout stream-json
  v
stream/route.ts SSE handler
  |
  | SSE events (log/tool/result/status)
  v
Browser — TaskConversation chat bubbles
```

### Target Architecture (v0.7)

```
Browser
  |-- HTTP (Next.js App Router, port 3000)  — pages, server actions, file APIs
  |-- WebSocket (WS Server, port 3001)      — PTY terminal I/O
  v
+--------------------------------------------------+
|  Same Node.js Process                            |
|                                                  |
|  Next.js (port 3000)                             |
|  instrumentation.ts → register()                 |
|    └── starts WS server (port 3001)              |
|    └── PTY session store (Map<taskId, PtySession>)|
|                                                  |
|  ws server (port 3001)                           |
|    WS message: { type: "input", data: string }   |
|    WS message: { type: "resize", cols, rows }    |
|    ← PTY output → WS broadcast                   |
|                                                  |
|  node-pty (native module, server-excluded)       |
|    ptyProcess.spawn("claude", args, { cwd })     |
|    ptyProcess.onData → ws.send(data)             |
|    ptyProcess.write(userInput)                   |
|    ptyProcess.resize(cols, rows)                 |
+--------------------------------------------------+
  |
  | xterm.js (browser)
  | @xterm/addon-fit  — resize to container
  | WebSocket client
  v
TaskTerminal component (replaces TaskConversation)
```

### Component Responsibilities

| Component | Responsibility | Location |
|-----------|----------------|----------|
| `instrumentation.ts` | Starts WS server at app boot (nodejs runtime only) | `src/instrumentation.ts` |
| `src/lib/pty/session-store.ts` | Map of taskId → PtySession; create/destroy/reconnect | `src/lib/pty/` |
| `src/lib/pty/ws-server.ts` | `ws.WebSocketServer` on port 3001; message routing | `src/lib/pty/` |
| `src/lib/pty/pty-session.ts` | node-pty spawn, onData, write, resize, lifecycle | `src/lib/pty/` |
| `TaskTerminal` | xterm.js component, WebSocket client, addon-fit | `src/components/task/task-terminal.tsx` |
| `task-page-client.tsx` | Replace left panel (chat → terminal), keep right tabs | `src/app/workspaces/.../task-page-client.tsx` |
| Existing `stream/route.ts` | Keep for reference/fallback; replace in UI only | `src/app/api/tasks/[taskId]/stream/route.ts` |
| Existing `process-manager.ts` | Extend to manage PTY processes alongside ChildProcess | `src/lib/adapters/process-manager.ts` |

---

## Recommended Project Structure (New Files)

```
src/
├── lib/
│   └── pty/
│       ├── session-store.ts     # Singleton Map<taskId, PtySession>
│       ├── pty-session.ts       # node-pty spawn + lifecycle
│       └── ws-server.ts         # ws.WebSocketServer + message routing
├── components/
│   └── task/
│       └── task-terminal.tsx    # xterm.js client component (dynamic import)
└── instrumentation.ts           # Extended: add WS server bootstrap
```

### next.config.ts additions

`node-pty` is already on Next.js's automatic `serverExternalPackages` exclusion list (confirmed in [Next.js docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages)). No manual configuration needed.

---

## Architectural Patterns

### Pattern 1: instrumentation.ts WS Server Bootstrap

**What:** Export `register()` in `instrumentation.ts` that conditionally starts a WebSocket server on the nodejs runtime. This runs once at Next.js server startup, in the same process.

**When to use:** Localhost tools where a separate process is undesirable. Avoids needing a custom `server.ts` file or patching Next.js internals.

**Trade-offs:** WS port (3001) must be hardcoded or env-configured. Browser must connect to a different port than the Next.js app. Works perfectly for localhost dev tools.

**Example:**
```typescript
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await pruneOrphanedWorktrees();   // existing
    const { startWsServer } = await import("./lib/pty/ws-server");
    startWsServer();                  // new: idempotent, port 3001
  }
}
```

### Pattern 2: PTY Session Lifecycle Mapped to TaskExecution

**What:** Each `TaskExecution` row corresponds to exactly one PTY session. Session identified by `taskId` (one active per task). Create PTY on WS "start" message, destroy on "stop" or disconnect.

**When to use:** Always. This is the only sensible mapping for this domain.

**Trade-offs:** Reconnect must reattach to existing PTY (not spawn new), or terminal history must be replayed. Simplest approach: replay buffered output on reconnect.

**Session states:**

```
WS connect → session exists? → yes → send buffered output, attach onData
                             → no  → spawn PTY, store session
WS disconnect → keep PTY alive for 30s (reconnect window)
                → timer fires → kill PTY, update DB execution.status
"stop" message → kill PTY immediately → update DB execution.status
```

**Example:**
```typescript
// src/lib/pty/pty-session.ts
interface PtySession {
  pty: IPty;
  taskId: string;
  executionId: string;
  outputBuffer: string[];    // Last N lines for reconnect replay
  clients: Set<WebSocket>;   // Multiple tabs reconnecting
  disconnectTimer?: NodeJS.Timeout;
}
```

### Pattern 3: xterm.js as Pure Passthrough Display

**What:** xterm.js renders PTY output verbatim — no JSON parsing, no filtering, no chat bubble formatting. ANSI escape codes are preserved. User input is forwarded directly to PTY.

**When to use:** Always for PTY terminals. Do not strip or filter output.

**Trade-offs:** DB storage of terminal output must happen server-side (PTY session), not client-side. No more `assistantContent` assembly in the stream route.

**Data flow:**
```
User types → xterm.js onData → WS send { type: "input", data: "\r" }
PTY stdout → WS send binary/text frame → xterm.js term.write(data)
User resizes container → addon-fit → { type: "resize", cols, rows } → pty.resize()
```

---

## Data Flow

### Full Round-Trip: User Input to Terminal Output

```
1. User types in xterm.js
   term.onData(data) → ws.send(JSON.stringify({ type:"input", data }))

2. WS server receives message
   ws.on("message") → parse → session.pty.write(data)

3. node-pty writes to Claude CLI PTY
   pty.write(data) → Claude CLI stdin (running in real TTY)

4. Claude CLI produces output (ANSI colored, cursor-positioned)
   pty.onData(chunk) → ws.send(chunk) to all session.clients

5. Browser receives PTY output
   ws.onmessage → xterm.term.write(event.data)
```

### Session Start Flow

```
1. User clicks "Start Execution" on task page
2. POST /api/tasks/[taskId]/execute (existing route, creates TaskExecution row)
3. UI opens WebSocket: ws://localhost:3001
4. WS client sends: { type: "start", taskId, executionId, cwd, args }
5. WS server: session-store.createSession(taskId)
   → node-pty.spawn("claude", buildArgs(), { name:"xterm-256color", cwd })
   → register pty.onData → broadcast to ws clients
   → store session in Map
6. PTY output streams to xterm.js
7. On Claude exit: update DB (execution.status, task.status)
   → WS server sends { type: "exit", exitCode }
```

### Session Stop / Kill Flow

```
1. User clicks "Stop"
2. WS client sends: { type: "stop", executionId }
   OR: user closes browser tab (WS disconnect)
3. WS server: session-store.destroySession(taskId)
   → pty.kill("SIGTERM")
   → db.taskExecution.update({ status: "FAILED" })
4. WS closes
```

### Reconnect Flow (browser refresh)

```
1. WS client connects with { type: "reconnect", taskId }
2. WS server checks session-store: session exists?
   → yes: cancel disconnect timer, send buffered output, attach client
   → no: send { type: "session_not_found" } → UI shows "no active session"
```

---

## Integration Points

### With Existing Code

| Existing Component | Integration | Notes |
|--------------------|-------------|-------|
| `instrumentation.ts` | Extend `register()` to start WS server | Keep worktree prune; add WS bootstrap after |
| `process-manager.ts` | Add PTY process tracking alongside ChildProcess | Or create separate `pty-process-manager.ts` |
| `/api/tasks/[taskId]/execute/route.ts` | Keep as-is — creates TaskExecution row | UI calls this before opening WS |
| `/api/tasks/[taskId]/stream/route.ts` | Keep but unused by new UI | Remove in a later cleanup phase |
| `task-page-client.tsx` | Replace left panel: chat → terminal | Right panel (files/diff/preview) unchanged |
| `TaskConversation` + `TaskMessageInput` | Remove from workbench page | Keep for any other usage |
| `worktree.ts` + `createWorktree()` | WS server must call this before spawning PTY | Same logic as current stream route |

### New External Dependencies

| Library | Role | Notes |
|---------|------|-------|
| `node-pty` | PTY process spawning | Native module; auto-excluded by Next.js |
| `ws` | WebSocket server | Lightweight; prefer over socket.io for simplicity |
| `@xterm/xterm` | Browser terminal renderer | Use scoped package, not legacy `xterm` |
| `@xterm/addon-fit` | Resize terminal to container | Required for responsive layout |

### Port Configuration

| Service | Port | Config |
|---------|------|--------|
| Next.js | 3000 | Default |
| WS server | 3001 | `TERMINAL_WS_PORT` env var, default 3001 |

The browser connects to `ws://localhost:${TERMINAL_WS_PORT}`. The port must be exposed in the client via an env var prefixed with `NEXT_PUBLIC_` or hardcoded for localhost-only tools.

---

## Build Order (Phase Dependencies)

```
Phase A: WS Server + PTY Session Backend
  → instrumentation.ts extension
  → src/lib/pty/session-store.ts
  → src/lib/pty/pty-session.ts
  → src/lib/pty/ws-server.ts
  → Manual test: curl/wscat to verify WS handshake

Phase B: xterm.js Terminal Component
  → Install @xterm/xterm, @xterm/addon-fit, ws
  → src/components/task/task-terminal.tsx (dynamic import, ssr:false)
  → Wire to WS server
  → Manual test: terminal renders, input echoes

Phase C: Workbench Integration
  → Replace left panel in task-page-client.tsx
  → Remove TaskConversation from workbench
  → DB lifecycle: create/update execution on start/stop
  → Claude CLI args: same as stream route (--dangerously-skip-permissions, cwd, etc.)

Phase D: Lifecycle + Edge Cases
  → Reconnect on refresh
  → Disconnect timer
  → Stop/kill handling
  → Exit code → DB status update (COMPLETED/FAILED)
  → Task status transition (IN_PROGRESS → IN_REVIEW on success)

Phase E: v0.6 Bug Fixes (parallel, no PTY dependency)
  → Can be done alongside Phase A or B
```

---

## Anti-Patterns

### Anti-Pattern 1: WebSocket in Next.js Route Handlers

**What people do:** Try to handle the WebSocket upgrade inside an App Router route handler (e.g., `src/app/api/terminal/route.ts`).

**Why it's wrong:** Next.js route handlers do not support HTTP Upgrade. The internal Next.js server intercepts and rejects upgrade requests before they reach route handler code. No workaround exists without patching Next.js internals.

**Do this instead:** Start a `ws.WebSocketServer` in `instrumentation.ts` on a separate port.

### Anti-Pattern 2: Parsing PTY Output Like SSE JSON

**What people do:** Continue parsing `stream-json` from Claude CLI and constructing chat messages from PTY output.

**Why it's wrong:** node-pty provides a real TTY. Claude CLI will output ANSI escape codes, interactive prompts, progress spinners — none of which are valid JSON. The stream-json format only appears when Claude CLI runs with `--output-format stream-json --print -`, which suppresses TTY behavior.

**Do this instead:** Pass PTY output verbatim to xterm.js. Store terminal transcripts in a separate field if DB persistence is needed. Remove `--output-format stream-json` and `--print -` from the Claude CLI args when running in PTY mode.

### Anti-Pattern 3: Spawning PTY in a Next.js Route Handler

**What people do:** Create a PTY session in a POST route handler (like the current stream route pattern).

**Why it's wrong:** Route handlers run per-request. PTY sessions outlive HTTP requests. The PTY must live in a singleton store (the WS server module scope), not inside a request handler's closure.

**Do this instead:** All PTY lifecycle management lives in `src/lib/pty/session-store.ts`, initialized at server startup via `instrumentation.ts`.

### Anti-Pattern 4: One PTY per WebSocket Connection

**What people do:** Spawn a new PTY whenever a client connects to the WebSocket.

**Why it's wrong:** Browser refresh would kill the running Claude session. Multiple browser tabs to the same task would spawn multiple Claude processes.

**Do this instead:** Keyed by `taskId`. One PTY per task. WebSocket connections are clients that attach/detach from the existing session.

### Anti-Pattern 5: next-ws Package Patching

**What people do:** Use the `next-ws` package to patch Next.js and add WebSocket support to route files.

**Why it's wrong:** Patches Next.js internals (fragile, breaks on Next.js upgrades). Adds a build step (`next-ws patch`). Unnecessary complexity for a localhost tool that can simply use a second port.

**Do this instead:** Standalone WS server in `instrumentation.ts`.

---

## Scaling Considerations

This is a localhost-only single-user tool. Scaling is not a real concern. The relevant constraint is **concurrent PTY sessions**: the existing `maxConcurrentExecutions` config (default 3) should gate PTY creation, same as the current SSE stream route.

| Concern | Approach |
|---------|----------|
| Too many Claude processes | Reuse existing `canStartExecution()` guard before spawning PTY |
| PTY memory leak | Destroy session on exit + 30s disconnect timer |
| WS server startup order | `instrumentation.register()` is awaited before server handles requests |

---

## Sources

- [Next.js instrumentation docs](https://nextjs.org/docs/app/guides/instrumentation) — official, version 16.2.2, 2026-03-31
- [Next.js serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) — confirms `node-pty` is auto-excluded, version 16.2.2
- [GitHub discussion #58698](https://github.com/vercel/next.js/discussions/58698) — WebSocket in route handlers: not supported
- [next-ws package](https://github.com/apteryxxyz/next-ws) — patching approach; not recommended
- [xterm.js](https://xtermjs.org/) — official site, addon guide
- [@xterm/addon-fit npm](https://www.npmjs.com/package/@xterm/addon-fit) — v0.11.0, active 2025
- [Web terminal with xterm.js + node-pty + WebSockets](https://ashishpoudel.substack.com/p/web-terminal-with-xtermjs-node-pty) — architecture pattern reference

---

*Architecture research for: node-pty + WebSocket + xterm.js terminal integration in Next.js 16 App Router*
*Researched: 2026-04-02*
