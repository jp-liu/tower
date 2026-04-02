# Stack Research

**Domain:** Browser-based terminal interaction — node-pty + WebSocket + xterm.js replacing SSE chat bubbles (v0.7)
**Researched:** 2026-04-02
**Confidence:** HIGH — core library choices verified via official npm pages, Next.js 16.2.2 official docs, and GitHub release history. node-pty's automatic exemption from bundling confirmed directly in Next.js official documentation.

---

## Scope

This is a **delta research document** for the v0.7 milestone. The base stack (Next.js 16, React 19, Prisma 6, SQLite, Tailwind CSS v4, zustand, `@xterm/xterm`, `@xterm/addon-fit`) is validated and unchanged.

This document covers only what is **new or changed** for the browser terminal:

1. PTY backend — creating real pseudo-terminals for Claude CLI
2. WebSocket server — bidirectional communication replacing SSE
3. xterm.js addons — bridging the WebSocket to the terminal
4. Session lifecycle management — create/destroy/reconnect

---

## Recommended Stack

### New Dependencies

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| `node-pty` | `^1.1.0` | Spawn Claude CLI in a real PTY (pseudo-terminal) | Only production-quality PTY library for Node.js. Microsoft-maintained, powers VS Code's integrated terminal. v1.1.0 is the latest stable (Dec 2025). Runs Claude Code in a genuine TTY environment so ANSI colors, cursor movement, and interactive prompts all work natively — the exact "local terminal" experience the v0.7 milestone requires. |
| `ws` | `^8.18.0` | WebSocket server (RFC 6455) | The de facto standard Node.js WebSocket library. Minimal, fast, no framework dependencies. Required peer dependency of `next-ws` (see below). v8 targets Node.js 18+, compatible with the project's Node.js 22. |
| `next-ws` | `^2.2.2` | WebSocket support inside Next.js App Router API routes | Patches Next.js to expose `SOCKET` upgrade handlers in route files, eliminating the need for a separate custom server. Latest release is 2.2.2 (March 2026), actively maintained. Designed for server-based (non-serverless) deployments — the project is localhost-only, so this is exactly the right fit. Requires a `"prepare": "next-ws patch"` script in `package.json`. |
| `@xterm/addon-attach` | `^0.12.0` | Attach a WebSocket to an xterm.js terminal | Official xterm.js addon that pipes raw WebSocket frames directly into the terminal buffer and sends keystrokes back. When a WebSocket carries raw PTY bytes (which node-pty produces), this addon is the canonical bridge. `@xterm/xterm` and `@xterm/addon-fit` are already installed — this is the only missing piece. |

### Already Installed — No Version Change Needed

| Library | Installed Version | Role in v0.7 |
|---------|-----------------|--------------|
| `@xterm/xterm` | `^6.0.0` | Terminal renderer in the browser |
| `@xterm/addon-fit` | `^0.11.0` | Resize the terminal to fill its container |

### Supporting Libraries — No Install Needed

| Capability | Approach |
|-----------|---------|
| Terminal session registry | In-memory `Map<sessionId, IPty>` in a server-side module — same pattern as the existing `process-manager.ts` for Claude CLI processes. No Redis, no DB changes. |
| ANSI / resize messages | Use a simple JSON envelope on the WebSocket: `{ type: 'data', payload: string }` for PTY output, `{ type: 'resize', cols: number, rows: number }` for terminal resize events. The attach addon handles the raw path; this envelope is used for control messages. |

---

## WebSocket Integration: next-ws vs Custom Server

### Recommendation: next-ws

**Use `next-ws`** because:

1. The project runs locally as a persistent server — the critical limitation of next-ws (no serverless/Vercel support) does not apply.
2. next-ws keeps WebSocket handlers co-located with the rest of the API routes (`app/api/terminal/[sessionId]/route.ts`), consistent with the existing codebase pattern.
3. A custom server requires replacing `next dev --turbopack` with `tsx server.ts`, which requires maintaining a separate server entrypoint and changes the dev script. The project's Turbopack setup (`"dev": "next dev --turbopack"`) is unchanged with next-ws.
4. next-ws 2.2.2 was released March 2026, showing active maintenance.

### When Custom Server Would Be Right Instead

Use a custom `server.ts` if:
- next-ws breaks with a future Next.js patch (the patch approach is inherently fragile)
- Turbopack-specific incompatibilities are discovered during implementation
- The WS server needs to be accessible by the MCP process as well as the browser

The custom server approach (official Next.js docs example) passes `turbopack: true` to the `next()` function call, preserving Turbopack in dev mode. Switching is a contained change — the session management logic is identical either way.

---

## node-pty: Native Addon Considerations

### Next.js 16 Automatic Exemption

`node-pty` is on Next.js 16's **built-in `serverExternalPackages` allowlist** (confirmed in Next.js 16.2.2 official docs at `nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages`). This means:

- No manual `serverExternalPackages: ['node-pty']` entry needed in `next.config.ts`
- Next.js will not attempt to bundle node-pty through webpack or Turbopack
- Native `.node` addon file is loaded via native `require()` at runtime

### Native Compilation

node-pty compiles a native C++ addon on `npm install`. Requirements:

- **macOS (this project's runtime):** Xcode command line tools (`xcode-select --install`) — almost certainly already installed on a developer machine
- **Node.js version:** Requires Node.js 16+. Project runs Node.js 22 — fully compatible
- **pnpm:** Add `node-pty` to `pnpm.onlyBuiltDependencies` in `package.json` (alongside the existing `@prisma/engines`, `esbuild`, `prisma`) to ensure the native build runs in pnpm's isolated store

### pnpm Configuration

```json
"pnpm": {
  "onlyBuiltDependencies": [
    "@prisma/engines",
    "esbuild",
    "node-pty",
    "prisma"
  ]
}
```

---

## next-ws Setup

### Installation

```bash
pnpm add next-ws ws @xterm/addon-attach
pnpm add -D @types/ws
```

### package.json scripts addition

```json
{
  "scripts": {
    "prepare": "next-ws patch"
  }
}
```

Run `pnpm prepare` after install to patch Next.js. The patch must be re-applied after every Next.js upgrade.

### Route handler pattern

```typescript
// src/app/api/terminal/[sessionId]/route.ts
import { type NextRequest } from "next/server"

export function SOCKET(
  client: import("ws").WebSocket,
  request: NextRequest,
  server: import("ws").WebSocketServer
) {
  // Attach to PTY session, wire up bidirectional data flow
}
```

---

## xterm.js: What Addons Are Needed

| Addon | Status | Purpose |
|-------|--------|---------|
| `@xterm/xterm` | Already installed | Core terminal renderer |
| `@xterm/addon-fit` | Already installed | Fill container dimensions |
| `@xterm/addon-attach` | **New — install** | Pipe WebSocket ↔ terminal buffer |

**Not needed:**
- `@xterm/addon-web-links` — link detection is cosmetic; skip for v0.7
- `@xterm/addon-search` — terminal search is out of scope for v0.7
- `@xterm/addon-canvas` / `@xterm/addon-webgl` — the default DOM renderer is sufficient for this use case; GPU renderers add complexity without meaningful benefit for a single embedded terminal

### Client-side terminal component

The terminal component must be:
1. Marked `"use client"`
2. Lazy-loaded with `next/dynamic` + `{ ssr: false }` — xterm.js requires a DOM environment

```typescript
const Terminal = dynamic(() => import("@/components/workbench/TerminalPanel"), {
  ssr: false,
})
```

---

## Claude Code CLI: Terminal Rendering Behavior

Claude Code uses **Ink (React for CLI)** which re-renders the full screen buffer via ANSI escape sequences on every state change. This means:

- Claude Code **requires a real TTY** to render correctly. When spawned via `child_process.spawn` (the current SSE approach), it detects a non-TTY stdout and either switches to plain JSON output mode (`--output-format stream-json`) or disables color/formatting.
- When spawned via `node-pty`, it gets a genuine PTY — Claude Code renders exactly as it does in a local terminal: colored output, cursor positioning, progress indicators, interactive permission prompts.
- The current `--output-format stream-json` flag will be **removed** when switching to PTY mode. The PTY carries raw terminal bytes; there is no structured JSON to parse. The DB persistence logic (storing assistant messages, tool calls) needs to be reconsidered — v0.7's scope replaces the SSE chat UI with a terminal, so raw terminal bytes are the output rather than parsed message objects.

**Implication for DB writes:** The existing `persistResult()` function in `stream/route.ts` extracts structured content from `stream-json` events to write `TaskMessage` records. In PTY mode, this structured extraction is no longer available. The v0.7 implementation should decide: (a) write the raw terminal transcript as a single `TaskMessage` after the session ends, or (b) drop DB message persistence for terminal sessions entirely. This is a design decision for the phase planning, not a stack question.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `next-ws` | Custom `server.ts` | Custom server requires replacing `next dev --turbopack` dev script and maintaining a separate Node.js entrypoint. next-ws preserves the existing dev workflow entirely. Fallback to custom server is viable if next-ws proves incompatible. |
| `next-ws` | Socket.IO | Socket.IO is 3x heavier than raw `ws`, adds a custom protocol layer, and is overkill for a localhost terminal where a raw WebSocket is sufficient. Socket.IO's reconnection logic would also conflict with the custom session management the PTY lifecycle requires. |
| `node-pty` | `node-pty-prebuilt-multiarch` | The prebuilt fork (homebridge) targets specific Node.js versions and may lag behind the Microsoft upstream. Since this is a developer machine (Xcode installed), compiling from source with `node-pty` v1.1.0 is cleaner and keeps the dependency tree minimal. |
| `@xterm/addon-attach` | Manual WebSocket message handling | The attach addon handles binary/text frame detection, buffering, and terminal write correctly. Reimplementing this is unnecessary complexity. |
| Raw PTY bytes over WebSocket | JSON-framed chunks | JSON framing adds parsing overhead and requires re-encoding binary data. Raw PTY bytes over WebSocket binary frames is what the attach addon expects and is the lowest-latency approach. For control messages (resize, session end), a separate `{ type, payload }` envelope on text frames is sufficient. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `socket.io` | Custom protocol overhead, unnecessary for localhost WebSocket | `ws` (peer dep of next-ws) |
| `xterm-addon-attach` (old package, not `@xterm/...`) | The legacy `xterm-addon-attach` package is incompatible with `@xterm/xterm` v5+ | `@xterm/addon-attach` (scoped package) |
| `@xterm/addon-webgl` or `@xterm/addon-canvas` | GPU renderers add ~200KB and complexity; default DOM renderer is fine for a single embedded terminal | Default renderer in `@xterm/xterm` |
| `node-pty-prebuilt-multiarch` | Prebuilt fork may lag behind upstream, adds another dependency | `node-pty` v1.1.0 compiled from source |
| `--output-format stream-json` flag (kept from SSE era) | PTY mode produces raw terminal bytes, not structured JSON. Keeping the flag would disable Claude Code's interactive rendering. | Remove flag when switching to PTY execution |
| Manual `serverExternalPackages: ['node-pty']` in next.config.ts | Already on Next.js 16's automatic allowlist — manually adding it is harmless but redundant | No change to next.config.ts needed |

---

## Installation

```bash
# New runtime dependencies
pnpm add node-pty next-ws ws @xterm/addon-attach

# New type definitions
pnpm add -D @types/ws

# Patch Next.js for WebSocket support (run once, re-run after Next.js upgrades)
pnpm prepare
```

Add to `package.json`:
```json
{
  "scripts": {
    "prepare": "next-ws patch"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "@prisma/engines",
      "esbuild",
      "node-pty",
      "prisma"
    ]
  }
}
```

---

## Version Compatibility

| Package | Version | Compatibility Notes |
|---------|---------|---------------------|
| `node-pty` | `^1.1.0` | Node.js 16+ required; Node.js 22 (project runtime) is fully supported. Compiles native addon — Xcode CLI tools required on macOS. Automatically excluded from Next.js bundling (on built-in allowlist). |
| `ws` | `^8.18.0` | Node.js 18+ target; compatible with Node.js 22. Peer dependency of next-ws. |
| `next-ws` | `^2.2.2` | Built for Next.js App Router only (not Pages Router). Requires `prepare: "next-ws patch"` lifecycle script. Must be re-patched after Next.js version upgrades. Compatible with localhost server deployments only. |
| `@xterm/addon-attach` | `^0.12.0` | Requires `@xterm/xterm` v5+. Project has `^6.0.0` — compatible. |
| `@xterm/xterm` | `^6.0.0` (existing) | Already installed. No version change. |
| `@xterm/addon-fit` | `^0.11.0` (existing) | Already installed. No version change. |
| `next` | `16.2.1` | node-pty on built-in serverExternalPackages list since Next.js 15+. Verified in 16.2.2 docs. |

---

## Sources

- [Next.js 16.2.2 serverExternalPackages official docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) — confirmed `node-pty` on automatic allowlist — HIGH confidence (official docs, version 16.2.2, updated 2026-03-31)
- [next-ws GitHub (apteryxxyz/next-ws)](https://github.com/apteryxxyz/next-ws) — latest version 2.2.2 (March 2026), SOCKET handler API, prepare script requirement — HIGH confidence (official repo)
- [microsoft/node-pty GitHub](https://github.com/microsoft/node-pty) — version 1.1.0 (Dec 2025), Node.js 16+ requirement, macOS compilation needs — HIGH confidence (official repo)
- [@xterm/addon-attach on npm](https://www.npmjs.com/package/@xterm/addon-attach) — version 0.12.0, WebSocket bridge functionality — HIGH confidence (official scoped package)
- [Next.js Custom Server docs](https://nextjs.org/docs/pages/guides/custom-server) — turbopack option available in next() function call; custom server tradeoffs — HIGH confidence (official docs)
- [Next.js 16 Turbopack blog](https://nextjs.org/blog/next-16) — Turbopack stable by default in Next.js 16 — HIGH confidence (official announcement)
- `package.json` codebase inspection — confirmed existing deps, Node.js 22 runtime, pnpm usage, `--turbopack` dev flag — HIGH confidence (direct codebase read)

---

*Stack research for: ai-manager v0.7 — browser terminal (node-pty + WebSocket + xterm.js)*
*Researched: 2026-04-02*
