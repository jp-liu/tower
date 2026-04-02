# Pitfalls Research

**Domain:** Browser terminal integration — node-pty + WebSocket + xterm.js added to a Next.js 16 App Router application (v0.7 milestone)
**Researched:** 2026-03-31
**Confidence:** HIGH (verified against Next.js 16 upgrade guide, node-pty GitHub issues, xterm.js GitHub issues, Turbopack GitHub issues, WebSocket discussion threads, and VS Code terminal source)

---

## Critical Pitfalls

### Pitfall 1: Turbopack Cannot Bundle node-pty Native Addon

**What goes wrong:**
Next.js 16 uses Turbopack by default for both `next dev` and `next build`. node-pty is a native Node.js addon (compiled `.node` binary via `node-gyp`). Turbopack's module resolution does not support native `.node` addons the same way webpack does. Even when `serverExternalPackages: ['node-pty']` is declared in `next.config.ts`, Turbopack may still attempt to trace and bundle the package, leading to build failures or silent runtime errors where `node-pty` functions resolve to `undefined`.

A confirmed Next.js 16 issue ([#85449](https://github.com/vercel/next.js/issues/85449)) shows that Turbopack fails to load native node addons compiled as separate packages in pnpm workspaces — the symptom is `TypeError: (void 0) is not a function` at runtime even after correct `serverExternalPackages` configuration.

**Why it happens:**
Turbopack performs static module graph analysis at build time. Native addons loaded via `bindings` or relative `build/Release/pty.node` paths are not resolvable in the static analysis phase. The pnpm non-hoisting layout means the `.node` file is not at the expected path relative to the Next.js output directory.

**How to avoid:**
Use `--webpack` flag for builds that include the PTY server route:

```json
{
  "scripts": {
    "dev": "next dev --webpack",
    "build": "next build --webpack"
  }
}
```

Add `node-pty` to `serverExternalPackages` in `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  serverExternalPackages: ['node-pty'],
}
```

This is the same precedent already set by Monaco Editor in this project (`@monaco-editor/react` with CDN loader avoided the Turbopack/webpack-plugin conflict). Apply the same principle here: opt out of Turbopack where native modules are involved.

**Warning signs:**
- `TypeError: (void 0) is not a function` when calling `pty.spawn()`
- Build succeeds but runtime PTY creation throws on the first WebSocket connection
- `serverExternalPackages` is set but Turbopack ignores it for pnpm-installed packages

**Phase to address:**
Phase 1 (PTY backend foundation). Verify node-pty loads correctly in a minimal route handler before building any WebSocket or session management logic.

---

### Pitfall 2: WebSocket Upgrade Not Supported in Next.js App Router Route Handlers

**What goes wrong:**
Next.js App Router Route Handlers (`app/api/*/route.ts`) do NOT support HTTP upgrade requests (the mechanism WebSockets require). Next.js intercepts all `upgrade` events at the HTTP server level and closes the socket for routes it owns. There is no official stable API to handle WebSocket connections inside App Router route handlers as of Next.js 16.

Attempting to use the `ws` library inside a Route Handler will silently fail — the WebSocket handshake is rejected before the handler code runs.

**Why it happens:**
Next.js App Router was designed around the fetch-based Request/Response API, which is inherently request-response. HTTP upgrade to WebSocket is a different protocol transition that happens at the Node.js `http.Server` level, below where Next.js route handlers operate. The Next.js `upgrade` event handler actively closes sockets to prevent protocol confusion.

The feature request has been open since November 2023 ([discussion #58698](https://github.com/vercel/next.js/discussions/58698)) with no stable implementation timeline.

**How to avoid:**
Use a custom server (`server.ts`) that intercepts upgrade requests before passing other requests to Next.js. This is the same pattern Next.js docs describe for WebSocket integration:

```typescript
// server.ts
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer } from 'ws'
import { handlePtyUpgrade } from './src/lib/pty-server'

const app = next({ dev: process.env.NODE_ENV !== 'production' })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url!)
    if (pathname === '/api/terminal/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handlePtyUpgrade(ws, req)
      })
    } else {
      socket.destroy()
    }
  })

  httpServer.listen(3000)
})
```

Update `package.json` to run `server.ts` instead of `next start`:
```json
{
  "scripts": {
    "dev": "tsx server.ts",
    "start": "node dist/server.js"
  }
}
```

The `next-ws` library is an alternative that patches Next.js to re-enable upgrade handling, but it relies on Next.js internals that may break on minor version upgrades. The custom server approach is more stable for production use.

**Warning signs:**
- WebSocket connection shows `101 Switching Protocols` in the network tab but immediately closes
- Client `WebSocket.onclose` fires instantly after `onopen`
- No WebSocket upgrade logs appear in the Next.js server console despite connection attempts

**Phase to address:**
Phase 1 (PTY backend foundation). The custom server is foundational — all WebSocket work depends on it. Establish and test the upgrade handler before any PTY logic.

---

### Pitfall 3: node-pty Process Leaks on WebSocket Disconnect

**What goes wrong:**
When the browser tab is closed, the network connection drops, or the user navigates away, the WebSocket closes — but the node-pty process spawned for that session continues running indefinitely. Each new workbench session that opens the terminal creates another PTY process. After 5-10 sessions (open/close cycles), dozens of Claude CLI processes and their shell children are running on the host, consuming CPU, memory, and file descriptors.

On macOS/Linux, zombie shells survive until the OS reclaims them (which may be never without explicit cleanup). Each Claude CLI process also holds an open file lock on the git worktree directory, potentially blocking worktree operations from other phases.

**Why it happens:**
Node.js child processes spawned by node-pty are independent OS processes. They are not children of the WebSocket connection or the HTTP request — they live in the Node.js process tree. When the WebSocket closes, nothing automatically kills the spawned PTY shell. `ws` library `close` events fire on the WebSocket but the PTY process lifecycle is completely decoupled.

**How to avoid:**
Maintain a server-side session registry (module-level singleton):

```typescript
// src/lib/pty-registry.ts
import type { IPty } from 'node-pty'

interface PtySession {
  pty: IPty
  taskId: string
  createdAt: Date
}

const sessions = new Map<string, PtySession>()

export function registerSession(sessionId: string, pty: IPty, taskId: string) {
  sessions.set(sessionId, { pty, taskId, createdAt: new Date() })
}

export function destroySession(sessionId: string) {
  const session = sessions.get(sessionId)
  if (session) {
    try { session.pty.kill() } catch {}
    sessions.delete(sessionId)
  }
}

export function destroyAllSessions() {
  sessions.forEach((_, id) => destroySession(id))
}

// Register cleanup on process exit
process.on('exit', destroyAllSessions)
process.on('SIGTERM', () => { destroyAllSessions(); process.exit(0) })
process.on('SIGINT', () => { destroyAllSessions(); process.exit(0) })
```

Hook the WebSocket `close` event to destroy the session:

```typescript
ws.on('close', () => destroySession(sessionId))
ws.on('error', () => destroySession(sessionId))
```

Add a periodic cleanup sweep (every 5 minutes) to kill sessions whose WebSocket has been closed but cleanup was missed:

```typescript
setInterval(() => {
  sessions.forEach((session, id) => {
    // If PTY process has already exited, remove from registry
    if (session.pty.pid === undefined) destroySession(id)
  })
}, 5 * 60 * 1000)
```

**Warning signs:**
- `ps aux | grep claude` shows more processes than open terminal tabs
- Memory usage of the Next.js/custom server process grows linearly over the work session
- Git worktree operations hang after opening/closing the terminal several times

**Phase to address:**
Phase 1 (PTY backend foundation). Implement the registry before any terminal features. Verify with a close-and-reopen cycle that zero zombie processes remain.

---

### Pitfall 4: node-pty Compilation Fails with pnpm Due to Non-Hoisted Layout

**What goes wrong:**
pnpm's default module resolution uses a content-addressable store with symlinks — packages are NOT hoisted to `node_modules/node-pty` the way npm/yarn do. node-pty's install script runs `node-gyp rebuild`, which looks for build tool dependencies (Python, node headers, MSVC on Windows) using paths relative to the package location. The symlink structure can cause `node-gyp rebuild` to either fail silently or compile but put the `.node` file at a path that `bindings` cannot resolve at runtime.

A confirmed pnpm issue ([#7128](https://github.com/pnpm/pnpm/issues/7128)) shows `pnpm rebuild --build-addon-from-source` fails in certain configurations.

**Why it happens:**
pnpm's isolated node_modules layout places `node-pty` at `.pnpm/node-pty@X.Y.Z/node_modules/node-pty/` with symlinks from the project's `node_modules/node-pty`. The `node-gyp` build writes its output relative to the real package location, not the symlink. The `bindings` package (used by node-pty to locate the `.node` file) may resolve the symlink incorrectly.

**How to avoid:**
Add to `.npmrc` at the project root:
```
# Ensure node-gyp runs correctly for native addons under pnpm
shamefully-hoist=false
node-linker=isolated
```

After `pnpm install`, explicitly rebuild:
```bash
pnpm rebuild node-pty
```

Or use `node-pty-prebuilt-multiarch` (maintained by Homebridge) instead of `node-pty`. This fork provides prebuilt binaries for macOS/Linux/Windows on multiple architectures, eliminating the need for `node-gyp` entirely:

```bash
pnpm add node-pty-prebuilt-multiarch
```

Import from the prebuilt fork if standard `node-pty` compilation fails:
```typescript
import pty from 'node-pty-prebuilt-multiarch'
// API is identical to node-pty
```

**Warning signs:**
- `pnpm install` completes but `node-pty` is missing `build/Release/pty.node`
- `Error: Could not load native bindings` on first PTY spawn
- The `.node` file exists but at `.pnpm/node-pty.../build/Release/pty.node` — not accessible via the symlink resolution path

**Phase to address:**
Phase 1 (PTY backend foundation). Verify compilation by running a one-liner PTY test before any server code: `node -e "require('node-pty').spawn('/bin/bash', [], {})"`.

---

### Pitfall 5: xterm.js Terminal Not Disposed on React Component Unmount — Memory Leak

**What goes wrong:**
When the workbench component unmounts (user navigates to Kanban, closes the tab, or switches tasks), the xterm.js `Terminal` instance is not disposed. The Terminal object holds references to canvas elements, WebGL contexts (if WebGL renderer addon is used), DOM event listeners, and the internal buffer. These are retained in memory indefinitely.

VS Code's terminal implementation hit this exact bug and fixed it in 2025 — 10 idle terminals accumulated 167 MB of GPU memory because WebGL contexts were not released on terminal close ([VS Code PR #279579](https://github.com/microsoft/vscode/pull/279579)).

xterm.js WebGL memory leak in versions before 5.0.0 ([issue #3889](https://github.com/xtermjs/xterm.js/issues/3889)) was fixed in v5.0.0 — but the application-level failure to call `terminal.dispose()` is a separate issue that any version can suffer from.

**Why it happens:**
The xterm.js `Terminal` class is not garbage-collected automatically. It registers DOM listeners on `document` after mounting, and these listeners hold a reference to the Terminal object. Without calling `terminal.dispose()`, the Terminal (and its WebGL context) remains on the JavaScript heap even after the React component is removed from the DOM.

React's `useEffect` cleanup is the correct hook, but developers frequently forget to call `terminal.dispose()` there, especially when addons (WebGL renderer, FitAddon, WebLinksAddon) are also loaded and must be disposed in order.

**How to avoid:**
Always dispose in `useEffect` cleanup, in reverse instantiation order:

```typescript
useEffect(() => {
  const terminal = new Terminal({ /* options */ })
  const fitAddon = new FitAddon()
  const webglAddon = new WebglAddon()  // optional

  terminal.loadAddon(fitAddon)
  terminal.loadAddon(webglAddon)
  terminal.open(containerRef.current!)
  fitAddon.fit()

  return () => {
    // Dispose in reverse order
    webglAddon.dispose()  // disposes WebGL context first
    fitAddon.dispose()
    terminal.dispose()    // finally dispose the terminal
  }
}, [])
```

Never store the Terminal instance in React state (use `useRef`) — storing in state triggers re-renders that can create multiple Terminal instances if the effect runs multiple times.

**Warning signs:**
- Browser Task Manager shows the workbench tab memory growing by 15-30 MB per close/reopen cycle
- `document.querySelectorAll('.xterm').length` in the console grows beyond the number of open terminals
- WebGL context count in `chrome://gpu` grows without bound

**Phase to address:**
Phase 2 (xterm.js terminal component). Implement dispose in the very first version of the component. Add a test: mount → navigate away → navigate back → verify memory is not growing.

---

### Pitfall 6: Terminal Resize Not Synced to PTY — Causes Garbled Output

**What goes wrong:**
When the user resizes the browser window or the workbench panel, xterm.js reflows its internal buffer. But the PTY process on the server side still thinks the terminal is the old size. Commands like `vim`, `htop`, `git diff`, and Claude CLI's interactive TUI elements render based on the PTY's reported dimensions. If the PTY size is not updated, output is garbled — line wrapping at the wrong column, TUI elements overflowing, cursor in wrong position.

A subtler variant: the FitAddon calculates the correct `cols`/`rows` based on the container size, but if the resize message is sent to the PTY before the DOM finishes reflowing, the new dimensions are wrong — causing a second resize to be needed.

**Why it happens:**
The xterm.js `Terminal.onResize` event fires when the terminal's internal dimensions change. But the PTY resize (`pty.resize(cols, rows)`) must happen on the server side via the WebSocket. This means: client DOM resize → FitAddon recalculates → `terminal.resize(cols, rows)` → WebSocket message → server `pty.resize()`. There is a round-trip delay. If the user resizes rapidly, queued resize messages can arrive out of order or cause the PTY to thrash between sizes.

**How to avoid:**
1. Use `FitAddon.fit()` triggered by a `ResizeObserver` on the terminal container (not `window.resize`), so panel resizing is captured:

```typescript
const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit()
})
resizeObserver.observe(containerRef.current!)

// In useEffect cleanup:
resizeObserver.disconnect()
```

2. Debounce the resize message to the server (100ms debounce prevents thrashing):

```typescript
const debouncedResize = useMemo(
  () => debounce((cols: number, rows: number) => {
    ws.send(JSON.stringify({ type: 'resize', cols, rows }))
  }, 100),
  [ws]
)

terminal.onResize(({ cols, rows }) => {
  debouncedResize(cols, rows)
})
```

3. On the server, apply the resize immediately without queuing:

```typescript
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.type === 'resize') {
    pty.resize(msg.cols, msg.rows)
  } else if (msg.type === 'input') {
    pty.write(msg.data)
  }
})
```

4. Send the initial terminal size when creating the PTY session so it starts at the correct dimensions.

**Warning signs:**
- `vim` or `htop` renders correctly initially but becomes garbled after a panel resize
- Claude CLI's interactive prompts wrap at the wrong column width
- The terminal appears to have extra blank lines at the bottom that are not filled

**Phase to address:**
Phase 2 (xterm.js terminal component). Implement `ResizeObserver` + debounced resize from the start. Test explicitly by resizing the panel while a `watch` command is running.

---

### Pitfall 7: Double PTY Kill on Already-Exited Process Throws Uncaught Exception

**What goes wrong:**
When the PTY process exits naturally (Claude CLI finishes), node-pty emits an `onExit` event. If the cleanup code also calls `pty.kill()` in the WebSocket `close` handler, calling `kill()` on an already-exited process throws `Error: pty.kill: process already closed` (or a native binding error). If this exception is not caught, it crashes the custom server process — taking down all active terminal sessions.

A related issue: `pty.kill()` is called from two concurrent paths (WebSocket close + natural process exit) with no guard, creating a race condition where the second call always throws.

**Why it happens:**
node-pty's `kill()` method calls into the native binding, which calls `kill(pid, signal)` on the OS. If the process has already exited, the OS returns `ESRCH` (no such process). The native binding propagates this as a JavaScript exception. `pty.kill()` does not check whether the process is already dead before calling into the OS.

**How to avoid:**
Wrap all PTY kill calls in try-catch and use a "killed" flag to prevent double invocation:

```typescript
function destroySession(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session || session.killed) return

  session.killed = true
  try {
    session.pty.kill()
  } catch (e) {
    // Process may have already exited — this is safe to ignore
  }
  sessions.delete(sessionId)
}
```

Register the `onExit` handler to mark the session as killed when the process exits naturally:

```typescript
pty.onExit(() => {
  const session = sessions.get(sessionId)
  if (session) session.killed = true
  // Do NOT call pty.kill() here — the process already exited
})
```

**Warning signs:**
- Custom server crashes with `Error: pty.kill: process already closed` after a Claude CLI session completes
- All WebSocket connections drop simultaneously when one PTY process exits
- Unhandled exception in `process.on('uncaughtException')` originating from node-pty native code

**Phase to address:**
Phase 1 (PTY backend foundation). Test this case explicitly: let Claude CLI run to completion, then close the WebSocket — verify no exception is thrown.

---

### Pitfall 8: xterm.js SSR Import Fails in Next.js — Browser-Only Module

**What goes wrong:**
Importing `xterm` (or `@xterm/xterm`) in a Next.js component without `dynamic({ ssr: false })` causes a build error because xterm.js accesses `window`, `document`, and `navigator` at import time. This is the same class of error as Monaco Editor (Pitfall 1 in the v0.6 PITFALLS.md) but for xterm.js.

The `FitAddon`, `WebLinksAddon`, `WebglAddon`, and any other xterm.js addons have the same constraint — they must all be imported inside `dynamic` boundaries or using `import()` lazily inside `useEffect`.

**Why it happens:**
xterm.js is a DOM rendering library — it renders to a `<canvas>` element and reads `window.devicePixelRatio`. The entire package is browser-only. Next.js App Router pre-renders Client Components on the server (SSR), so any top-level import of xterm.js will run in Node.js where `window` does not exist.

**How to avoid:**
Either use `next/dynamic`:
```typescript
const XtermTerminal = dynamic(
  () => import('@/components/workbench/xterm-terminal'),
  { ssr: false }
)
```

Or import xterm lazily inside a `useEffect`:
```typescript
useEffect(() => {
  Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
  ]).then(([{ Terminal }, { FitAddon }]) => {
    const term = new Terminal(...)
    // ...
  })
}, [])
```

The dynamic import approach is cleaner. Ensure the terminal container component file has `'use client'` at the top AND is wrapped with `dynamic({ ssr: false })` in the parent.

**Warning signs:**
- Build error: `ReferenceError: window is not defined` or `document is not defined` from inside `@xterm/xterm`
- Error stack trace shows `node_modules/@xterm/xterm/lib/...` during `next build`

**Phase to address:**
Phase 2 (xterm.js terminal component). Establish the `dynamic({ ssr: false })` wrapper as the very first file created in this phase.

---

### Pitfall 9: WebSocket Flow Control — Fast PTY Output Overflows Client Buffer

**What goes wrong:**
Claude CLI can emit output very rapidly (hundreds of lines per second when streaming responses). The WebSocket client may not process incoming messages fast enough. When this happens:
1. The browser's WebSocket receive buffer fills up
2. TCP back-pressure propagates to the server
3. The server's WebSocket `send()` call blocks (or buffers in memory)
4. The server-side buffer grows unboundedly, consuming hundreds of MB of RAM per slow client

In practice for a localhost tool (client and server on the same machine), this is less severe — but it still causes the xterm.js render loop to lag, producing visible stutter and UI freeze while large output batches are processed.

**Why it happens:**
WebSocket does not have built-in flow control between the application layer and the transport. `ws.send(data)` in Node.js queues the data for transmission but does not wait for the client to process it. node-pty's `onData` callback fires synchronously for each chunk — rapid output chunks all queue immediately into the WebSocket's internal send buffer.

**How to avoid:**
Batch PTY output chunks before sending (combine multiple rapid chunks into one WebSocket message):

```typescript
let buffer = ''
let flushTimer: NodeJS.Timeout | null = null

pty.onData((data) => {
  buffer += data
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data: buffer }))
      }
      buffer = ''
      flushTimer = null
    }, 8) // ~8ms batching window (about 2 animation frames)
  }
})
```

Check `ws.bufferedAmount` before sending and skip frames if the client is falling behind:

```typescript
if (ws.bufferedAmount < 64 * 1024) { // 64KB threshold
  ws.send(data)
}
```

On the xterm.js side, use `terminal.write(data, callback)` — the optional callback fires when the data is fully processed. Use it to implement back-pressure signaling if needed.

**Warning signs:**
- `ws.bufferedAmount` in server-side logs grows above 1 MB during Claude output
- xterm.js terminal freezes for 1-2 seconds then displays a large block of output all at once
- Custom server memory usage spikes during Claude CLI streaming sessions

**Phase to address:**
Phase 1 (PTY backend foundation). Implement output batching before connecting xterm.js — test with a `yes` command (extremely high output rate) to verify the buffer stays bounded.

---

### Pitfall 10: Cross-Site WebSocket Hijacking (CSWSH) — WebSocket Has No Same-Origin Policy

**What goes wrong:**
Unlike fetch/XHR, WebSocket connections are NOT subject to the browser's same-origin policy by default. Any page — including a malicious page open in another tab — can open a WebSocket to `ws://localhost:3000/api/terminal/ws` and get full PTY shell access to the host machine. Since this project is localhost-only with no authentication, a malicious browser extension or a tab the user accidentally opened could silently spawn shells.

This is a well-documented attack class: Cross-Site WebSocket Hijacking (CSWSH), analogous to CSRF but for WebSockets.

**Why it happens:**
The WebSocket protocol sends an `Origin` header during the handshake, but servers must explicitly validate it. The `ws` library does not validate `Origin` by default — it accepts all connections. For a localhost tool without auth tokens, `Origin` validation is the primary defense.

**How to avoid:**
In the custom server's upgrade handler, validate the `Origin` header before accepting the WebSocket handshake:

```typescript
httpServer.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin || ''
  const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]

  if (!allowedOrigins.includes(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }

  // Proceed with WebSocket upgrade
  wss.handleUpgrade(req, socket, head, (ws) => {
    handlePtyUpgrade(ws, req)
  })
})
```

For extra protection, generate a short-lived token when the workbench page loads (Server Component generates it, passes as a prop), and require it in the WebSocket connection URL as a query parameter. Validate the token server-side before accepting the upgrade.

**Warning signs:**
- The WebSocket upgrade handler accepts connections with `Origin: null` or arbitrary origins
- No `Origin` header validation in the upgrade handler
- A test page on a different port can open a WebSocket to the PTY endpoint

**Phase to address:**
Phase 1 (PTY backend foundation). Add origin validation before the first PTY session is created. This is non-negotiable even for a localhost tool.

---

### Pitfall 11: PTY Spawns Shell Instead of Claude CLI Directly — Gives Full Interactive Shell

**What goes wrong:**
The common pattern `pty.spawn('/bin/bash', ['-c', command])` spawns a full interactive shell with the command as an argument. If `command` is composed from user input (task config, agent config fields), shell injection is possible. Additionally, spawning bash first then running Claude CLI means the user has access to full bash — they can `Ctrl-C` the Claude process and drop into a raw bash prompt with arbitrary command execution.

For a localhost single-user tool, the threat model is less severe, but spawning Claude CLI directly (not via a shell) is still the correct approach to avoid unintended behavior.

**Why it happens:**
Developers use `spawn('/bin/bash', ['-c', commandString])` because it is simpler — it handles PATH lookup and shell expansion. But string-interpolated commands are vulnerable to injection if any part of `commandString` comes from user-controlled data. This project already uses `execFileSync` for git operations to prevent injection — the same discipline applies here.

**How to avoid:**
Spawn Claude CLI directly with an array of arguments:

```typescript
const ptyProcess = pty.spawn('claude', ['--model', 'claude-opus-4-5', ...otherArgs], {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: task.worktreePath || project.localPath,
  env: process.env,
})
```

Never construct the command string by concatenating user-provided fields. Validate each argument against an allowlist before passing to `pty.spawn`. If Claude CLI requires a shell for PATH lookup, use `which claude` at server startup to get the absolute path, then use that path directly.

**Warning signs:**
- `pty.spawn('/bin/bash', ['-c', `claude ${userInput}`])` — injection risk
- User can `Ctrl-C` the Claude process and get a bash prompt
- Arbitrary environment variables from user input are passed in the `env` option

**Phase to address:**
Phase 1 (PTY backend foundation). Document the spawn call explicitly; code review must flag any shell string interpolation.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip `serverExternalPackages` and let Turbopack try to bundle node-pty | No config changes needed | Runtime `TypeError: (void 0) is not a function` — silent failure | Never |
| Use `next-ws` library instead of custom server | No server.ts needed | Patches Next.js internals; breaks on minor version upgrades | Only in prototype/spike; not production |
| No PTY session registry — create a new PTY per WebSocket | Simplest implementation | Zombie processes accumulate; resource exhaustion in hours | Never |
| No Origin validation on WebSocket upgrade | Simpler handler | CSWSH — any page can spawn a shell on localhost | Never |
| Call `pty.spawn('/bin/bash', ['-c', cmd])` with string interpolation | Easier command construction | Shell injection if any arg comes from user input | Never when user input is involved |
| Skip xterm.js `dynamic({ ssr: false })` and rely on `"use client"` | Slightly simpler component | Build fails with `window is not defined` | Never |
| No WebSocket flow control / output batching | Simpler data pipe | Memory spike and UI freeze during high-output Claude sessions | Acceptable only in an initial prototype |
| Single WebSocket session per browser tab (no session ID) | Simpler session tracking | Cannot reconnect to existing PTY after navigation; PTY killed on every route change | Acceptable if reconnection is explicitly out of scope |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| node-pty + Next.js 16 Turbopack | Rely on `serverExternalPackages` under Turbopack | Use `--webpack` flag for dev and build; `serverExternalPackages` for runtime exclusion |
| node-pty + pnpm | Assume `pnpm install` compiles the native addon | Run `pnpm rebuild node-pty` explicitly; consider `node-pty-prebuilt-multiarch` |
| WebSocket + App Router | Create Route Handler at `app/api/terminal/route.ts` | Use custom server with explicit `upgrade` event handler — Route Handlers cannot handle WebSocket upgrades |
| WebSocket + CSWSH | No Origin header validation | Validate `req.headers.origin` against allowlist before `handleUpgrade` |
| xterm.js + Next.js SSR | Import `@xterm/xterm` at top level of component | `next/dynamic({ ssr: false })` wrapper mandatory |
| xterm.js + React unmount | Call `terminal.dispose()` only | Dispose all addons (WebGL, Fit) in reverse order before `terminal.dispose()` |
| PTY output + WebSocket | Send each `onData` chunk immediately | Batch with 8ms timeout; check `bufferedAmount` before sending |
| PTY resize + FitAddon | Use `window.resize` event | Use `ResizeObserver` on the container element for panel resizes |
| PTY kill + natural process exit | Call `pty.kill()` unconditionally in cleanup | Guard with `session.killed` flag; wrap in try-catch |
| Claude CLI spawn | Use shell string: `pty.spawn('bash', ['-c', cmd])` | Spawn Claude directly with argument array; resolve path with `which claude` at startup |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| No PTY output batching | xterm.js freezes for 1-2s then jumps | Batch with 8ms setTimeout; combine rapid chunks | During any command with high output rate (git log, npm install) |
| FitAddon triggered on every `window.resize` | Multiple rapid PTY resize messages; garbled TUI | Use ResizeObserver + 100ms debounce | When user drags panel divider |
| xterm.js Terminal not disposed | Memory grows ~15-30 MB per close/reopen | `terminal.dispose()` in `useEffect` cleanup | After 5-10 open/close cycles in one session |
| PTY spawned per WebSocket message instead of per session | New shell process per message | Session-based: one PTY per session ID | Immediately if misimplemented |
| WebSocket bufferedAmount unchecked | Server OOM on slow client | Check `ws.bufferedAmount < 64KB` before send | When Claude CLI emits >1MB of output |
| No session cleanup on server restart | Orphaned PTYs survive Next.js hot-reload | `process.on('SIGTERM')` cleanup in session registry | On every Next.js dev server hot-reload |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| No Origin validation on WebSocket upgrade | CSWSH — any browser tab can spawn a shell | Validate `Origin` header allowlist in upgrade handler |
| Shell string interpolation in `pty.spawn` | Command injection via task/agent config fields | Spawn with argument array; never interpolate user input into shell strings |
| PTY exposed on `0.0.0.0` (all interfaces) | LAN users can access the terminal | Bind the custom server to `127.0.0.1` only |
| No session ID / token validation | Replay attacks — any WebSocket can attach to any PTY | Generate session token server-side; validate before upgrade |
| PTY CWD set to server root instead of task worktreePath | Claude CLI runs in wrong directory; can access all project files | Always set `cwd` to `task.worktreePath` or `project.localPath`; never to `process.cwd()` |
| Environment variables from user input passed to PTY | Arbitrary env injection | Build env explicitly from `process.env`; never spread user-supplied objects |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No loading state before PTY is ready | Blank terminal rectangle; user types before connection | Show "Connecting..." overlay until WebSocket is open and PTY is ready |
| PTY session destroyed on navigation | User loses terminal history when switching to Kanban view | Keep PTY session alive server-side; reconnect on return; replay buffer on reconnect |
| Resize not triggered on workbench panel resize | Claude CLI TUI garbled after panel drag | ResizeObserver on container; FitAddon.fit() on every size change |
| No indication when Claude CLI exits | Terminal appears frozen; user keeps typing | Detect `onExit` from PTY; display exit code banner; disable input |
| Terminal scrollback cleared on reconnect | User cannot see previous Claude output | Buffer last N lines server-side; replay to client on reconnect |
| Ctrl-C passes through to kill Claude mid-response | User accidentally cancels long-running task | Optionally show a confirmation for `Ctrl-C` when task execution is `IN_PROGRESS` |

---

## "Looks Done But Isn't" Checklist

- [ ] **node-pty compilation:** Run `node -e "require('node-pty').spawn('/bin/bash', [], {})"` — verify no native binding error
- [ ] **Turbopack conflict:** Run `next dev` (Turbopack default) with `serverExternalPackages: ['node-pty']` — verify PTY spawns correctly; if not, confirm `--webpack` flag resolves it
- [ ] **WebSocket upgrade:** Open `ws://localhost:3000/api/terminal/ws` from a browser — verify `101 Switching Protocols` in network tab and terminal output appears
- [ ] **Origin validation:** Open a WebSocket from a page on `http://localhost:3001` — verify the connection is rejected with 403
- [ ] **PTY process leak:** Open terminal, close tab, reopen 5 times — `ps aux | grep claude` must show zero orphaned processes
- [ ] **xterm.js memory:** Mount terminal component, unmount (navigate away), remount 10 times — browser Task Manager memory must not grow linearly
- [ ] **Resize sync:** Open `vim` in the terminal, resize the workbench panel — verify `vim` redraws correctly at new dimensions
- [ ] **Double kill guard:** Let Claude CLI finish naturally, then close the WebSocket — verify no uncaught exception in server logs
- [ ] **Flow control:** Run `yes | head -100000` in the terminal — verify server-side `ws.bufferedAmount` stays below 1 MB; UI remains responsive
- [ ] **SSR guard:** Run `next build` — verify no `window is not defined` or `document is not defined` errors from xterm.js imports
- [ ] **spawn security:** Verify `pty.spawn` is called with a fixed executable path and argument array — no string interpolation of user input in the command
- [ ] **pnpm rebuild:** After fresh `pnpm install`, verify node-pty native addon is present at the correct path before starting the server

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Turbopack / native addon build failure | LOW | Add `--webpack` flag to dev and build scripts; clear `.next` cache and rebuild |
| pnpm node-pty compilation failure | LOW | Run `pnpm rebuild node-pty`; if still failing, switch to `node-pty-prebuilt-multiarch` |
| WebSocket upgrade rejected (Route Handler approach used) | MEDIUM | Create `server.ts` custom server; update `package.json` scripts; test upgrade handler |
| PTY zombie process accumulation | LOW | `pkill -f "node .* claude"` to clear zombies; then implement session registry |
| xterm.js memory leak discovered | MEDIUM | Add `terminal.dispose()` + addon dispose to `useEffect` cleanup; reload page as immediate workaround |
| CSWSH vulnerability discovered | HIGH | Add `Origin` header validation immediately; audit all WebSocket upgrade paths; consider adding session tokens |
| Double kill crash bringing down server | MEDIUM | Add try-catch + `killed` flag around all `pty.kill()` calls; restart server immediately |
| PTY output flood causing server OOM | MEDIUM | Add output batching with `bufferedAmount` check; restart server; reduce Claude output verbosity |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Turbopack incompatibility with node-pty | Phase 1: PTY backend | `next build --webpack` succeeds; PTY spawns without runtime error |
| pnpm native addon compilation | Phase 1: PTY backend | `node -e "require('node-pty')"` succeeds after fresh install |
| WebSocket upgrade in App Router | Phase 1: PTY backend | Custom server `server.ts` handles upgrade; Route Handler not used |
| CSWSH / Origin validation | Phase 1: PTY backend | Cross-origin WebSocket connection rejected with 403 |
| PTY process leak | Phase 1: PTY backend | Zero zombie processes after 5 open/close cycles |
| Double kill crash | Phase 1: PTY backend | Natural PTY exit + WebSocket close does not throw uncaught exception |
| WebSocket flow control | Phase 1: PTY backend | `yes | head -100000` does not cause memory spike or UI freeze |
| xterm.js SSR import failure | Phase 2: xterm.js component | `next build` completes without `window is not defined` error |
| xterm.js terminal not disposed | Phase 2: xterm.js component | Memory stable across 10 mount/unmount cycles |
| Terminal resize not synced to PTY | Phase 2: xterm.js component | `vim` redraws correctly after panel resize |
| Claude CLI spawn security | Phase 1: PTY backend | Code review confirms argument array; no shell string interpolation |

---

## Sources

- [Next.js 16 upgrade guide — Turbopack by default](https://nextjs.org/docs/app/guides/upgrading/version-16) — webpack flag opt-out documented
- [Next.js issue #85449 — Turbopack fails to load native node addons in pnpm workspaces](https://github.com/vercel/next.js/issues/85449) — unresolved as of Dec 2025
- [Next.js issue #68805 — Turbopack can't locate serverExternalPackages in pnpm child dependencies](https://github.com/vercel/next.js/issues/68805)
- [Next.js discussion #58698 — WebSocket upgrade support in App Router route handlers](https://github.com/vercel/next.js/discussions/58698) — not yet supported
- [node-pty issue #382 — Proper PTY kill in Electron/Node](https://github.com/microsoft/node-pty/issues/382) — kill() best practices
- [node-pty issue #167 — Sending signal to process group](https://github.com/microsoft/node-pty/issues/167) — background process cleanup
- [pnpm issue #7128 — rebuild --build-addon-from-source failure](https://github.com/pnpm/pnpm/issues/7128)
- [pnpm issue #2135 — node-gyp rebuild failures](https://github.com/pnpm/pnpm/issues/2135)
- [node-pty-prebuilt-multiarch — Homebridge fork with prebuilt binaries](https://github.com/homebridge/node-pty-prebuilt-multiarch) — eliminates node-gyp dependency
- [xterm.js issue #3889 — WebGL addon GPU memory leak (fixed in v5.0.0)](https://github.com/xtermjs/xterm.js/issues/3889)
- [VS Code PR #279579 — Fix terminal WebGL context memory leak (2025)](https://github.com/microsoft/vscode/pull/279579)
- [xterm.js issue #1341 — Terminals retained forever without dispose()](https://github.com/xtermjs/xterm.js/issues/1341)
- [xterm.js discussion #5144 — resize/cols/rows not syncing to PTY](https://github.com/xtermjs/xterm.js/discussions/5144)
- [xterm.js issue #1914 — Terminal resize round-trip race condition](https://github.com/xtermjs/xterm.js/issues/1914)
- [WebSocket.org — CSWSH security guide](https://websocket.org/guides/security/) — Origin validation requirement
- [Heroku — WebSocket security](https://devcenter.heroku.com/articles/websocket-security) — authentication and CSWSH prevention
- [Gemini CLI issue #20941 — PTY shell orphans nested background processes](https://github.com/google-gemini/gemini-cli/issues/20941)
- [xterm.js flowcontrol guide](https://xtermjs.org/docs/guides/flowcontrol/) — buffering and back-pressure patterns

---
*Pitfalls research for: Browser terminal integration (v0.7) — node-pty + WebSocket + xterm.js in Next.js 16*
*Researched: 2026-03-31*
