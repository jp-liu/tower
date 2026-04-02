# Project Research Summary

**Project:** ai-manager v0.7
**Domain:** Browser terminal integration — node-pty + WebSocket + xterm.js replacing SSE chat bubbles
**Researched:** 2026-04-02
**Confidence:** HIGH

## Executive Summary

The v0.7 milestone replaces the existing SSE-based chat bubble UI with a real browser terminal powered by node-pty, WebSocket, and xterm.js. The goal is to give users a genuine TTY experience — ANSI colors, interactive prompts, cursor positioning — rather than parsed JSON chat messages. This is a well-understood architectural pattern (VS Code terminal, ttyd, code-server all use the same primitives), and the technology choices are unambiguous: `node-pty` for PTY spawning, `ws` for WebSocket, `@xterm/xterm` for rendering.

The most consequential architectural decision is how to integrate WebSocket support into a Next.js 16 App Router application. Next.js App Router route handlers do not support HTTP Upgrade natively. The ARCHITECTURE.md and PITFALLS.md research converge on the same recommendation: run a standalone `ws.WebSocketServer` on port 3001, started from `instrumentation.ts`. This avoids patching Next.js internals (`next-ws` approach) and avoids replacing the dev script with a custom `server.ts`. The two research files diverge on one point — PITFALLS.md recommends a custom `server.ts` for production stability while ARCHITECTURE.md recommends the `instrumentation.ts` approach as simpler. For a localhost-only single-user tool, either is acceptable; `instrumentation.ts` is preferred as the lower-friction path.

The critical risks are: (1) Turbopack's inability to handle node-pty's native `.node` addon — addressed by switching to `--webpack` mode; (2) PTY process leaks if the session registry is not implemented before any UI work; and (3) double-kill exceptions that can crash the entire server if PTY lifecycle is not carefully guarded. All three are Phase 1 concerns and have clear, documented prevention strategies.

---

## Key Findings

### Recommended Stack

The base stack (Next.js 16, React 19, Prisma 6, SQLite, Tailwind CSS v4, zustand, `@xterm/xterm`, `@xterm/addon-fit`) is unchanged. Four new dependencies are needed for v0.7:

**Core technologies:**
- `node-pty ^1.1.0`: Spawns Claude CLI in a real pseudo-terminal — provides the genuine TTY environment Claude Code requires for ANSI rendering, interactive prompts, and progress indicators. Microsoft-maintained, powers VS Code terminal. Auto-excluded from Next.js bundling via the built-in `serverExternalPackages` allowlist.
- `ws ^8.18.0`: Raw WebSocket server, minimal and fast. Peer dependency of `next-ws`; used directly in the `instrumentation.ts` standalone server pattern.
- `next-ws ^2.2.2` (optional alternative): Patches Next.js to expose `SOCKET` handlers in route files. Viable for localhost tools but fragile across Next.js upgrades. PITFALLS.md recommends the custom server / instrumentation approach instead.
- `@xterm/addon-attach ^0.12.0`: Official xterm.js addon that pipes raw WebSocket frames into the terminal buffer. The canonical bridge between a WebSocket carrying raw PTY bytes and xterm.js. The only missing xterm.js addon for v0.7.

**Critical version requirements:**
- Use `--webpack` flag (`"dev": "next dev --webpack"`) — Turbopack cannot reliably handle native `.node` addons from pnpm's isolated store (Next.js issue #85449, unresolved).
- Add `node-pty` to `pnpm.onlyBuiltDependencies` to ensure the native addon is compiled by pnpm.
- Remove `--output-format stream-json --print -` from the Claude CLI spawn args — these flags suppress TTY behavior; PTY mode requires raw terminal output.

### Expected Features

**Must have (P1 — v0.7 core terminal):**
- node-pty spawns Claude CLI in real PTY
- WebSocket bidirectional communication (foundational; all other features depend on it)
- xterm.js renders ANSI output with 5,000+ line scrollback
- `@xterm/addon-fit` + debounced PTY resize sync
- Keyboard input forwarding (one-line wire: `term.onData` to `pty.write`)
- Ctrl+C (`\x03`) SIGINT passthrough
- Session destroy on PTY exit (no zombie processes)
- Execution status update on PTY exit (DB and UI)
- Dark/light theme sync (wire to next-themes)
- `@xterm/addon-webgl` for GPU rendering (Claude CLI outputs at high volume)

**Should have (P2 — v0.7 polish, add after core is stable):**
- `@xterm/addon-web-links` — clickable URLs (one line of code, high perceived quality)
- `@xterm/addon-clipboard` — Ctrl+Shift+C copy shortcut
- Input disabled while WebSocket is disconnected
- Automatic reconnection with server-side ring buffer replay
- Ctrl+C updating task status to CANCELLED

**Defer to v0.8+:**
- Session persistence across page navigations (requires `@xterm/addon-serialize` + server-side PTY keepalive; high complexity, validate whether users actually navigate away mid-execution first)
- Search in terminal output (`@xterm/addon-search`)
- Full PTY output log file archival

**Anti-features (do not build):**
- Infinite scrollback (memory exhaustion)
- Multiple terminal tabs per task (scope creep for v0.7)
- tmux/screen integration (unnecessary complexity; server restart still kills PTYs)
- Real-time shared terminal (out of scope — localhost single-user tool)

### Architecture Approach

The architecture adds three new source modules (`src/lib/pty/session-store.ts`, `src/lib/pty/pty-session.ts`, `src/lib/pty/ws-server.ts`) and one new component (`src/components/task/task-terminal.tsx`), bootstrapped from `instrumentation.ts`. The WS server runs on port 3001 alongside the Next.js app on port 3000 — same process, separate port. The workbench left panel (`task-page-client.tsx`) replaces `TaskConversation` with `TaskTerminal`; the right panel (files/diff/preview) is unchanged.

**Major components:**
1. `instrumentation.ts` — bootstraps the WS server at Next.js startup (nodejs runtime guard); extends the existing `register()` function that already runs worktree pruning
2. `src/lib/pty/session-store.ts` — singleton `Map<taskId, PtySession>`; PTY lifecycle mapped 1:1 to `TaskExecution` rows; reconnect window is 30 seconds before PTY is killed
3. `src/lib/pty/ws-server.ts` — `ws.WebSocketServer` on port 3001; routes `input`, `resize`, `start`, `stop`, `reconnect` messages; broadcasts PTY output to all session clients
4. `src/lib/pty/pty-session.ts` — node-pty spawn/write/resize/kill; output ring buffer for reconnect replay; `killed` flag guards double-kill
5. `TaskTerminal` (`task-terminal.tsx`) — `"use client"` + `next/dynamic({ ssr: false })` wrapper; xterm.js instance with FitAddon and WebGL addon; `ResizeObserver` on container for panel resize; `useEffect` cleanup disposes all addons in reverse order

**Key patterns:**
- PTY session is keyed by `taskId`, not by WebSocket connection — browser refresh reattaches without killing the process
- WS server started in `instrumentation.ts` (not a custom `server.ts`) — preserves the existing `next dev --webpack` workflow
- xterm.js is a pure passthrough renderer — no JSON parsing, no message assembly; DB persistence decision deferred to phase planning (raw transcript or no persistence)

### Critical Pitfalls

1. **Turbopack cannot bundle node-pty native addon** — Add `--webpack` to dev and build scripts; add `serverExternalPackages: ['node-pty']` to `next.config.ts`. Verify with `node -e "require('node-pty').spawn('/bin/bash', [], {})"` before any other work. Phase 1.

2. **WebSocket upgrade not supported in Next.js App Router route handlers** — Do not attempt `app/api/terminal/route.ts` for WebSocket. Use standalone WS server in `instrumentation.ts` on port 3001, or a custom `server.ts`. Attempting the Route Handler approach results in silent handshake rejection. Phase 1.

3. **PTY process leaks on WebSocket disconnect** — Implement session registry (`Map<sessionId, PtySession>`) before any terminal UI. Hook `ws.on('close')` and `ws.on('error')` to `destroySession()`. Register `process.on('SIGTERM')` cleanup. Phase 1.

4. **Double PTY kill crashes the server** — Guard all `pty.kill()` calls with a `session.killed` boolean flag and wrap in try-catch. Register `pty.onExit` to set `killed = true` (do not call `kill()` inside `onExit`). A crash here takes down all active sessions. Phase 1.

5. **xterm.js SSR import failure** — xterm.js accesses `window` at import time. Mandatory: `next/dynamic({ ssr: false })` wrapper for the terminal component. Never import `@xterm/xterm` at the top level of any component. Phase 2.

6. **xterm.js terminal not disposed on unmount** — Always call `addon.dispose()` in reverse load order, then `terminal.dispose()`, in `useEffect` cleanup. Store Terminal in `useRef`, not `useState`. VS Code hit this exact bug in 2025 (167 MB GPU memory leak across 10 idle terminals). Phase 2.

7. **Terminal resize not synced to PTY** — Use `ResizeObserver` on the container element (not `window.resize`) to catch panel resizes. Debounce the WS resize message at 100ms to prevent PTY thrashing. Send initial size when spawning PTY. Phase 2.

8. **Cross-site WebSocket hijacking (CSWSH)** — WebSocket has no same-origin policy. Validate `req.headers.origin` against `['http://localhost:3000', 'http://127.0.0.1:3000']` in the upgrade handler before accepting. Reject with 403 otherwise. Phase 1 — non-negotiable.

9. **Shell injection via pty.spawn** — Always spawn Claude CLI directly with an argument array: `pty.spawn('claude', [...args], { cwd })`. Never use `pty.spawn('/bin/bash', ['-c', commandString])` when any part of the command comes from user input. Phase 1.

10. **WebSocket output flood** — Batch PTY `onData` chunks with an 8ms setTimeout before sending. Check `ws.bufferedAmount < 64KB` before each send. Test with `yes | head -100000` to verify memory stays bounded. Phase 1.

---

## Implications for Roadmap

Based on the dependency graph and pitfall-to-phase mapping from research, the implementation should follow this phase structure:

### Phase 1: PTY Backend Foundation

**Rationale:** Every terminal feature depends on a working, leak-proof PTY server. All critical (server-crashing) pitfalls live here. Build and verify this completely before touching the browser side.

**Delivers:** A working WebSocket server that spawns Claude CLI in a PTY, streams output, handles input and resize, and cleans up correctly. Verifiable via `wscat` without any UI changes.

**Implements:** `instrumentation.ts` extension, `src/lib/pty/session-store.ts`, `src/lib/pty/pty-session.ts`, `src/lib/pty/ws-server.ts`, `package.json` script changes (`--webpack`), `pnpm.onlyBuiltDependencies` update

**Must address in this phase:**
- Turbopack vs. node-pty (switch to `--webpack`)
- pnpm native addon compilation (`pnpm rebuild node-pty`)
- WebSocket via instrumentation.ts, not Route Handler
- PTY session registry with cleanup hooks
- Double-kill guard with `killed` flag + try-catch
- CSWSH Origin validation
- Claude CLI spawn via argument array (no shell interpolation)
- Output batching (8ms window + bufferedAmount check)

**Verification before Phase 2:**
- `node -e "require('node-pty')"` passes
- `wscat` connects and receives Claude CLI output
- Cross-origin connection rejected with 403
- 5 open/close cycles yield zero zombie processes
- Natural PTY exit + WS close generates no uncaught exception
- `yes | head -100000` keeps server memory stable

### Phase 2: xterm.js Terminal Component

**Rationale:** Frontend layer. Depends entirely on Phase 1 being stable. Pitfalls here are containable (memory leaks, rendering glitches) rather than server-crashing.

**Delivers:** A `TaskTerminal` React component that renders PTY output correctly, handles resize, and integrates with the existing workbench layout.

**Implements:** `src/components/task/task-terminal.tsx`, `next/dynamic({ ssr: false })` wrapper, WebSocket client, FitAddon + ResizeObserver, WebGL addon, dark/light theme sync

**Must address in this phase:**
- `dynamic({ ssr: false })` wrapper as the very first file (before any xterm.js import)
- Terminal dispose in reverse addon order in `useEffect` cleanup
- ResizeObserver on container + 100ms debounced resize WS message
- Initial size sent when opening WebSocket connection

**Uses from STACK.md:** `@xterm/xterm ^6.0.0` (existing), `@xterm/addon-fit ^0.11.0` (existing), `@xterm/addon-attach ^0.12.0` (new), `@xterm/addon-webgl` (new)

### Phase 3: Workbench Integration

**Rationale:** Wire the backend (Phase 1) and component (Phase 2) into the existing workbench UI. Replace `TaskConversation` with `TaskTerminal` in `task-page-client.tsx`. Handle DB lifecycle.

**Delivers:** Full end-to-end terminal experience in the workbench — start execution, Claude CLI runs in terminal, status updates when done.

**Implements:** `task-page-client.tsx` left panel swap, execution lifecycle (create TaskExecution before WS connect, update status on PTY exit), Claude CLI arg migration (remove `--output-format stream-json`, remove `--print -`), DB persistence decision (raw transcript or no persistence)

**Key decision during phase planning:** Whether to write raw terminal transcript as a single `TaskMessage` after session ends, or drop DB message persistence for terminal sessions entirely. The existing `persistResult()` function in `stream/route.ts` cannot be reused.

### Phase 4: Polish and Reliability

**Rationale:** Quality-of-life improvements that do not block the core replacement but significantly raise the experience.

**Delivers:** Reconnection after hot-reload, visual disconnect state, clean Ctrl+C cancellation, clickable URLs.

**Implements:** Exponential backoff reconnect loop, server-side ring buffer (last N bytes per session), input-disabled-while-disconnected state, `@xterm/addon-web-links`, `@xterm/addon-clipboard`, Ctrl+C to CANCELLED task status flow

### Phase 5: v0.6 Bug Fixes (Parallel Track)

**Rationale:** Bug fixes identified in v0.6 that are independent of the PTY work. Can run in parallel with Phase 1 or Phase 2.

**Delivers:** v0.6 stability without coupling to the v0.7 terminal feature.

### Phase Ordering Rationale

- Phases 1 through 3 are strictly sequential: backend must exist before the component, and both must exist before workbench integration.
- Phase 4 is additive and can be partially parallelized with Phase 3.
- Phase 5 is fully independent and can run at any point.
- All server-crashing risks are concentrated in Phase 1, ensuring they are verified before Phase 2 or 3 work begins.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Workbench Integration):** DB persistence decision for terminal sessions is unresolved. Two valid approaches (raw transcript vs. no persistence) have different implications for the task history UI. Needs a design decision before coding.
- **Phase 4 (Reconnection):** The ring buffer size and reconnect window (currently suggested at 30s) need validation against real Claude CLI session lengths. The `@xterm/addon-serialize` approach for full buffer replay is a P3 feature worth prototyping here.

Phases with standard patterns (skip research-phase):
- **Phase 1 (PTY Backend):** All patterns are well-documented in research. node-pty + ws + session registry is a proven pattern.
- **Phase 2 (xterm.js Component):** Official xterm.js docs cover all required APIs. `dynamic({ ssr: false })` is the established pattern for DOM-only libraries in this codebase (same approach as Monaco Editor).
- **Phase 5 (Bug Fixes):** Existing codebase, no new research needed.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All library choices verified via official npm pages, GitHub release history, and Next.js 16.2.2 official docs. node-pty auto-exclusion confirmed in official serverExternalPackages list. |
| Features | HIGH (table stakes) / MEDIUM (differentiators) | Core terminal features verified against official xterm.js docs and node-pty GitHub. Session persistence and reconnection patterns based on community sources (ttyd, code-server analysis). |
| Architecture | HIGH | WebSocket-in-App-Router limitation confirmed via official Next.js docs and GitHub discussion #58698. instrumentation.ts approach confirmed via official Next.js instrumentation guide. |
| Pitfalls | HIGH | Pitfalls 1-4 and 8-9 confirmed via official Next.js issue tracker, node-pty GitHub, pnpm GitHub, and VS Code codebase. CSWSH pitfall confirmed via WebSocket security documentation. |

**Overall confidence:** HIGH

### Gaps to Address

- **DB persistence for terminal sessions:** The existing `TaskMessage` model was designed for structured chat messages, not raw PTY transcripts. Decide during Phase 3 planning: (a) write compressed terminal transcript as a single `TaskMessage` of role `ASSISTANT` after session ends, or (b) skip DB persistence for terminal sessions and rely on the server-side ring buffer for recent history only.

- **Turbopack dev experience trade-off:** Switching to `--webpack` means slower incremental compilation compared to Turbopack. This is the correct trade-off for correctness. Monitor Next.js issue #85449 for Turbopack native addon support — if resolved, revert to `--turbopack`.

- **next-ws vs. instrumentation.ts:** STACK.md recommends `next-ws` while ARCHITECTURE.md and PITFALLS.md both recommend the standalone `instrumentation.ts` approach. Resolution: use `instrumentation.ts` + standalone WS server on port 3001. If `next-ws` is chosen, budget time for re-patching after each Next.js upgrade.

- **TERMINAL_WS_PORT client exposure:** The client must know the WS server port (3001). For localhost, hardcoding is acceptable. If configurable, expose via `NEXT_PUBLIC_TERMINAL_WS_PORT` env var and document in `.env.example`.

---

## Sources

### Primary (HIGH confidence)
- [Next.js 16.2.2 serverExternalPackages official docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) — `node-pty` on auto-exclusion list
- [Next.js instrumentation guide](https://nextjs.org/docs/app/guides/instrumentation) — `register()` pattern for server-side startup code
- [microsoft/node-pty GitHub v1.1.0](https://github.com/microsoft/node-pty) — PTY spawn API, macOS compilation requirements
- [apteryxxyz/next-ws GitHub v2.2.2](https://github.com/apteryxxyz/next-ws) — `SOCKET` handler API, prepare script requirement
- [@xterm/addon-attach npm v0.12.0](https://www.npmjs.com/package/@xterm/addon-attach) — WebSocket bridge for xterm.js
- [xterm.js official docs](https://xtermjs.org/) — Terminal class API, addon index, flowcontrol guide
- [Next.js 16 Turbopack upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) — `--webpack` opt-out documented
- Project `package.json` — confirmed existing deps, Node.js 22, pnpm, Turbopack dev flag

### Secondary (MEDIUM confidence)
- [GitHub discussion #58698](https://github.com/vercel/next.js/discussions/58698) — WebSocket upgrade not supported in App Router route handlers
- [Next.js issue #85449](https://github.com/vercel/next.js/issues/85449) — Turbopack fails to load native addons in pnpm workspaces (unresolved Dec 2025)
- [pnpm issue #7128](https://github.com/pnpm/pnpm/issues/7128) — rebuild failure with native addons
- [VS Code PR #279579](https://github.com/microsoft/vscode/pull/279579) — xterm.js WebGL context memory leak fix (2025)
- [node-pty issue #382](https://github.com/microsoft/node-pty/issues/382) — `kill()` best practices
- [xterm.js issue #3889](https://github.com/xtermjs/xterm.js/issues/3889) — WebGL addon memory leak (fixed v5.0.0)
- [WebSocket.org CSWSH security guide](https://websocket.org/guides/security/) — Origin validation requirement
- [@xterm/addon-serialize npm v0.14.0](https://www.npmjs.com/package/@xterm/addon-serialize) — buffer serialization for reconnection replay
- [homebridge/node-pty-prebuilt-multiarch](https://github.com/homebridge/node-pty-prebuilt-multiarch) — prebuilt binaries fallback if node-gyp fails
- [Web terminal with xterm.js + node-pty + WebSockets](https://ashishpoudel.substack.com/p/web-terminal-with-xtermjs-node-pty) — architecture pattern reference

---
*Research completed: 2026-04-02*
*Ready for roadmap: yes*
