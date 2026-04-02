# Feature Research

**Domain:** Browser-based terminal (xterm.js + node-pty + WebSocket) for AI task execution
**Researched:** 2026-03-31
**Confidence:** HIGH (xterm.js API — official docs + npm); MEDIUM (session management patterns — multiple community sources); MEDIUM (Next.js WebSocket integration — community-verified)

---

## Scope

This document covers ONLY the new v0.7 features: replacing SSE chat bubbles with a real browser terminal. Existing shipped features (Kanban board, AI chat bubbles, SSE streaming, git worktree, file tree, Monaco editor, diff view, preview panel) are treated as context, not subjects of research.

The five feature domains are: (1) terminal display, (2) input handling, (3) session management, (4) terminal resize, (5) reconnection.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features a user expects in any browser terminal. Missing any of these makes the terminal feel broken compared to ttyd or code-server.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **ANSI color + escape code rendering** | Claude CLI outputs colored output, progress bars, cursor movement; without this the terminal is illegible | LOW | xterm.js handles this natively — instantiate `Terminal`, call `term.write(data)`. Zero extra code. |
| **Text selection + copy (mouse)** | Users expect to select output and copy it like any native terminal | LOW | xterm.js enables mouse text selection by default. `@xterm/addon-clipboard` adds Ctrl+Shift+C shortcut. |
| **Keyboard input forwarding** | Users type commands; keystrokes must reach the PTY process | LOW | `term.onData(data => pty.write(data))` — one line. Any key not wired = terminal is read-only. |
| **Ctrl+C (SIGINT) passthrough** | Users expect to interrupt the running Claude CLI process | LOW | Forward raw `\x03` byte to PTY. node-pty `handleSIGINT` option (default true) controls whether library intercepts it first. |
| **Scrollback buffer** | Output longer than the viewport must be scrollable | LOW | xterm.js `scrollback` constructor option (default 1,000 lines). Set to 5,000–10,000 for AI output volume. |
| **Fit terminal to container** | Terminal must fill the panel without overflow or whitespace gaps | LOW | `@xterm/addon-fit` — call `fitAddon.fit()` on mount and whenever the containing panel resizes. |
| **PTY resize sync** | When the browser panel resizes, the PTY must resize so ncurses layout and Claude CLI line-wrapping are correct | MEDIUM | Two-step: `fitAddon.fit()` fires `term.onResize(cols, rows)` → handler sends message over WebSocket → server calls `pty.resize(cols, rows)`. Debounce recommended to avoid rapid-fire resize during drag. |
| **Session destroy on task end** | When execution completes or is cancelled, the PTY must be killed and memory freed | LOW | `pty.kill()` + remove from server-side session map. Detect PTY exit event, notify client with structured exit message. |
| **WebSocket bidirectional communication** | Terminal output flows server→client; keyboard input flows client→server. SSE is one-directional and cannot carry input. | MEDIUM | Next.js App Router Route Handlers do not natively support HTTP Upgrade for WebSocket. Requires custom server (`server.js`) or the `next-ws` library. This is the foundational infrastructure dependency. |
| **Terminal cursor display** | Blinking or block cursor shows where input will appear | LOW | xterm.js renders cursor by default. `cursorBlink`, `cursorStyle` constructor options. |
| **Execution status update on PTY exit** | Workbench header and task card must reflect "Completed" / "Failed" when Claude CLI exits | LOW | Server sends structured `{type: "exit", code: N}` message on PTY exit event. Client calls `stopTaskExecution` server action. |

### Differentiators (Competitive Advantage)

Features that raise the terminal experience above baseline ttyd-level, appropriate for an integrated AI task workbench.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Automatic reconnection with output buffer replay** | Network blip or hot-reload during dev does not lose terminal state | MEDIUM | Client: exponential backoff reconnect loop. Server: ring buffer of last N bytes per session. On reconnect, flush ring buffer before resuming live stream. |
| **Session persistence across page navigations** | User navigates to Kanban and back — running Claude CLI process and terminal history survive | HIGH | Requires: server-side session map keyed by taskId (PTY stays alive), `@xterm/addon-serialize` serializes terminal buffer on disconnect, client replays serialized state on reconnect. |
| **WebGL-accelerated rendering** | High-throughput AI output (thousands of lines/sec) renders without frame drops | LOW | `@xterm/addon-webgl` is a drop-in addon. Falls back to canvas renderer automatically if WebGL unavailable. Strongly recommended given Claude CLI's output volume. |
| **Clickable URLs in output** | URLs printed by Claude CLI open in browser with one click | LOW | `@xterm/addon-web-links` — one addon registration. High perceived quality for very low effort. |
| **Dark/light theme sync** | Terminal colors follow the app theme automatically | LOW | xterm.js `theme` option accepts a color map object. Wire to next-themes current theme. Maintain two theme configs (dark/light). |
| **Input disabled while disconnected** | Visual indicator and input block prevent silently dropped keystrokes when WebSocket is closed | LOW | `term.options.disableStdin = true` while WebSocket disconnected. Re-enable on reconnect. |
| **Ctrl+C stops execution cleanly** | Forwards interrupt to Claude CLI, updates task status to CANCELLED, no zombie process | MEDIUM | Forward `\x03` to PTY. Detect PTY exit, call `stopTaskExecution` server action. Guard against double-kill. |
| **Search in terminal output** | Find specific error or filename in scrollback history | MEDIUM | `@xterm/addon-search` provides `findNext`/`findPrevious`. Requires search input UI. Optional for v0.7 core but worthwhile for dense AI output. |
| **PTY spawn with correct TERM environment** | Claude CLI and shell utilities that check `$TERM` behave correctly (color support detection, readline) | LOW | node-pty sets `TERM=xterm-256color` by default. Ensure `COLORTERM=truecolor` is set for full color support. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Infinite scrollback buffer** | "I want all output preserved" | Browser memory exhaustion — Claude CLI can produce millions of lines in long sessions. xterm.js holds all lines in JS heap. 10,000 lines ≈ 10–40 MB depending on line length. | Set scrollback to 10,000 lines. Persist full PTY output to a log file server-side if archival is needed; surface via file tree + Monaco. |
| **Multiple terminal tabs per task** | "I want a shell alongside Claude" | Scope creep for v0.7 — goal is replacing chat bubbles with one terminal per task. Multiple tabs require tab UI, session multiplexing, and additional state. | Ship one terminal per task. The existing "open in system terminal" button (v0.6 Preview panel) covers extra shell needs. |
| **tmux/screen integration** | "Persistent sessions even after server restarts" | PTY sessions do not survive Node.js process exit regardless of tmux. Attaching to existing tmux sessions requires exec-ing into them, complicates session management, and tmux is not universally available. | Server-side session map with serialize/replay covers 95% of the reconnection use case without the complexity. Document that server restarts require re-running execution. |
| **Real-time shared terminal (collaboration)** | "Watch the AI agent's terminal together" | Single-user localhost tool by explicit design constraint. Broadcasting requires auth, session fan-out, cursor multiplexing. | Out of scope per PROJECT.md. Not applicable to localhost-only tool. |
| **Terminal recording/playback (asciinema)** | "Record sessions for post-execution review" | Serialization format, playback UI, storage management are all separate features. High cost for low frequency use. | Store raw PTY output to log file. User can open it in Monaco editor for review. No additional infrastructure needed. |
| **Custom shell per task** | "I want zsh for this task, bash for that one" | Claude CLI is the process, not a general shell. node-pty spawns Claude CLI directly. User does not pick a shell; Claude CLI inherits the system shell. | Claude CLI inherits system shell via PTY environment. No configuration needed. |
| **Paste confirmation dialog** | "Warn before pasting large content" | Claude CLI expects pasted content to flow directly to its readline. A dialog interrupts the flow and adds no safety in a single-user tool. | Use `term.paste()` which applies correct bracketed paste escape sequences. Trust the user. |

---

## Feature Dependencies

```
[WebSocket bidirectional comms]
    └──required by──> [Keyboard input forwarding]
    └──required by──> [PTY resize sync message]
    └──required by──> [Execution status update on PTY exit]
    └──required by──> [Automatic reconnection with buffer replay]
    └──required by──> [Session persistence across navigations]

[node-pty PTY spawn]
    └──required by──> [ANSI color + escape rendering]  (PTY provides VT100 data stream)
    └──required by──> [Ctrl+C SIGINT passthrough]
    └──required by──> [PTY resize sync]
    └──required by──> [Session destroy on task end]

[@xterm/addon-fit]
    └──required by──> [PTY resize sync]  (fit() triggers onResize event; no other way to detect container resize)

[Server-side session map (taskId → PTY)]
    └──required by──> [Session persistence across navigations]
    └──required by──> [Automatic reconnection with buffer replay]
    └──required by──> [Session destroy on task end]

[@xterm/addon-serialize]
    └──required by──> [Session persistence across navigations]

[Server-side PTY output ring buffer]
    └──required by──> [Automatic reconnection with buffer replay]

[@xterm/addon-webgl]
    └──enhances──> [ANSI color rendering]  (performance upgrade, not functional dependency)

[@xterm/addon-web-links]
    └──enhances──> [ANSI color rendering]  (cosmetic addon layered on top)

[@xterm/addon-clipboard]
    └──enhances──> [Text selection + copy]  (adds Ctrl+Shift+C shortcut; selection still works without it)
```

### Dependency Notes

- **WebSocket is the foundational infrastructure dependency.** Every interactive terminal feature — input, resize, reconnection, session management — depends on it. This must be designed and implemented first. The existing SSE infrastructure cannot be upgraded to support bidirectional comms.
- **node-pty is the second foundational dependency.** The PTY is the data source; xterm.js is the renderer. Both must exist before any terminal feature works.
- **`@xterm/addon-fit` must load before PTY resize sync is wired.** FitAddon's `fit()` call is what fires the `terminal.onResize` event. Without it, the resize handler has no trigger.
- **Session persistence requires both client-side (`@xterm/addon-serialize`) and server-side (ring buffer + PTY keepalive).** Half-measures do not work: serialize without keepalive means the PTY is dead on reconnect; keepalive without serialize means the client shows a blank terminal for a running process.
- **`@xterm/addon-webgl` is independent** — it can be added or removed without affecting any other feature. Recommended as a day-one addon given Claude CLI output volume.

---

## MVP Definition

### Launch With — v0.7 Core Terminal

The minimum needed to replace chat bubbles with a working browser terminal.

- [ ] node-pty spawns Claude CLI in a PTY (real TTY environment)
- [ ] WebSocket route — bidirectional comms (custom server or `next-ws`)
- [ ] xterm.js renders PTY output with ANSI colors, cursor, scrollback (5,000+ lines)
- [ ] `@xterm/addon-fit` + debounced PTY resize sync — terminal fills its panel
- [ ] Keyboard input forwarding — user can type into Claude CLI
- [ ] Ctrl+C forwarding (`\x03`) — user can interrupt execution
- [ ] Session destroy on PTY exit — clean lifecycle, no zombie PTY processes
- [ ] Execution status message on PTY exit — task status updates automatically
- [ ] Dark/light theme sync — terminal theme follows app theme
- [ ] `@xterm/addon-webgl` — GPU rendering for high-throughput AI output

### Add After Core is Stable — v0.7 Polish

- [ ] `@xterm/addon-web-links` — clickable URLs in output (one line of code)
- [ ] `@xterm/addon-clipboard` — Ctrl+Shift+C copy shortcut
- [ ] Input disabled while disconnected — prevents silently dropped keystrokes
- [ ] Automatic reconnection with ring buffer replay — needed if hot-reload disrupts sessions during development
- [ ] Ctrl+C clean cancellation — forward interrupt AND update task status to CANCELLED

### Future Consideration — v0.8+

- [ ] Session persistence across page navigations (serialize + server keepalive) — high complexity; validate whether users actually navigate away mid-execution
- [ ] Search in terminal output (`@xterm/addon-search`) — useful for dense AI output; not blocking
- [ ] Full PTY output log file archival — long-running task review

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| node-pty PTY spawn | HIGH | MEDIUM | P1 |
| WebSocket bidirectional comms | HIGH | MEDIUM | P1 |
| xterm.js ANSI rendering + scrollback | HIGH | LOW | P1 |
| Keyboard input forwarding | HIGH | LOW | P1 |
| Fit addon + PTY resize sync | HIGH | LOW | P1 |
| Ctrl+C SIGINT passthrough | HIGH | LOW | P1 |
| Session destroy on PTY exit | HIGH | LOW | P1 |
| Execution status on PTY exit | HIGH | LOW | P1 |
| Dark/light theme sync | MEDIUM | LOW | P1 |
| WebGL rendering (@xterm/addon-webgl) | MEDIUM | LOW | P1 |
| Clickable URLs (@xterm/addon-web-links) | LOW | LOW | P2 |
| Clipboard addon (Ctrl+Shift+C) | LOW | LOW | P2 |
| Automatic reconnection + ring buffer | MEDIUM | MEDIUM | P2 |
| Input disabled while disconnected | MEDIUM | LOW | P2 |
| Ctrl+C → CANCELLED task status | MEDIUM | LOW | P2 |
| Session persistence across navigations | MEDIUM | HIGH | P3 |
| Search in terminal output | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for v0.7 — chat bubble replacement is incomplete without these
- P2: Should have — quality-of-life improvements, add in same milestone if time permits
- P3: Defer to v0.8+ — useful but not blocking

---

## Competitor Feature Analysis

Reference implementations in the browser terminal ecosystem:

| Feature | VS Code Terminal | ttyd | code-server | Our Approach |
|---------|-----------------|------|-------------|--------------|
| ANSI rendering | xterm.js (forked) | xterm.js | xterm.js | xterm.js `@xterm/xterm` |
| Input forwarding | IPC (Electron) | WebSocket | WebSocket | WebSocket |
| PTY resize | IPC resize message | WebSocket resize msg | WebSocket | WebSocket + FitAddon |
| Session persistence | Process-local (Electron) | No (reconnect kills) | Yes (server-side) | Server session map + serialize addon |
| Reconnection | Auto (process-local) | Configurable timeout; known bugs | Yes | Exponential backoff + ring buffer |
| Scrollback | 1,000 lines default, configurable | Configurable | Configurable | 5,000–10,000 lines (AI output is dense) |
| GPU rendering | WebGL addon (default on) | Canvas only | WebGL addon | WebGL addon (opt-in P1) |
| Theme | VS Code theme tokens | None | VS Code themes | next-themes integration |
| Clickable URLs | Web links addon | No | Web links addon | Web links addon (P2) |
| Input guard on disconnect | Yes | No | Yes | Yes (P2) |

**Key insight from wetty analysis:** Wetty's reconnect does not resume session — it kills the PTY and starts fresh. This is the failure mode to avoid. The correct pattern (from ttyd, code-server, WebSocket.org guide) is: issue a session ID on first connection, store it client-side, present it on reconnect, server re-associates WebSocket with the surviving PTY.

---

## Sources

- [xterm.js official site](https://xtermjs.org/) — terminal class overview, addon index (HIGH confidence)
- [xterm.js Terminal class API](https://xtermjs.org/docs/api/terminal/classes/terminal/) — onData, onResize, resize, paste, input, buffer, dispose methods (HIGH confidence)
- [xterm.js addons guide](https://xtermjs.org/docs/guides/using-addons/) — FitAddon, WebGLAddon, WebLinksAddon, SearchAddon, ClipboardAddon list (HIGH confidence)
- [@xterm/addon-serialize npm](https://www.npmjs.com/package/@xterm/addon-serialize) — buffer serialization for reconnection replay; v0.14.0 (HIGH confidence)
- [@xterm/addon-clipboard npm](https://www.npmjs.com/package/@xterm/addon-clipboard) — browser clipboard access; v0.2.0 (HIGH confidence)
- [node-pty GitHub (microsoft/node-pty)](https://github.com/microsoft/node-pty) — PTY spawn, resize, kill, signal handling (HIGH confidence)
- [node-pty SIGINT handling PR #240](https://github.com/microsoft/node-pty/pull/240/files) — `handleSIGINT` option details (MEDIUM confidence)
- [Efficient node-pty with Socket.io — multiple users](https://medium.com/@deysouvik700/efficient-and-scalable-usage-of-node-js-pty-with-socket-io-for-multiple-users-402851075c4a) — TerminalManager session map pattern (MEDIUM confidence)
- [WebSocket reconnection: state sync and recovery](https://websocket.org/guides/reconnection/) — session ID issuance, detach/resume, ring buffer, exponential backoff (MEDIUM confidence)
- [xterm.js scrollback issue #518](https://github.com/xtermjs/xterm.js/issues/518) — default 10,000 lines, memory trade-offs (MEDIUM confidence)
- [next-ws GitHub (apteryxxyz/next-ws)](https://github.com/apteryxxyz/next-ws) — WebSocket support in Next.js App Router (MEDIUM confidence)
- [Next.js WebSocket discussion #58698](https://github.com/vercel/next.js/discussions/58698) — App Router WebSocket upgrade limitations and workarounds (MEDIUM confidence)
- [ttyd reconnection issue #1068](https://github.com/tsl0922/ttyd/issues/1068) — known reconnection edge cases in reference implementation (MEDIUM confidence)
- [Wetty reconnection issue #447](https://github.com/butlerx/wetty/issues/447) — wetty does not support session resume (MEDIUM confidence)
- [xterm.js resize debounce recommendation (VS Code wiki)](https://github.com/microsoft/vscode/wiki/Working-with-xterm.js/) — debounce best practice for resize (MEDIUM confidence)
- [xterm.js terminal resize roundtrip issue #1914](https://github.com/xtermjs/xterm.js/issues/1914) — async resize race condition detail (MEDIUM confidence)
- [xterm.js scrollback in alt screen issue #802](https://github.com/xtermjs/xterm.js/issues/802) — alt screen buffer (vim, htop) does not use scrollback (MEDIUM confidence)

---

*Feature research for: ai-manager v0.7 browser-based terminal*
*Researched: 2026-03-31*
