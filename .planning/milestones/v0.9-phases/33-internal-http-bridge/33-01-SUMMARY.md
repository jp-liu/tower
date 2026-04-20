---
phase: 33-internal-http-bridge
plan: "01"
subsystem: api-routes
tags: [internal-api, pty, mcp-bridge, security]
dependency_graph:
  requires:
    - "src/lib/pty/session-store.ts (getSession)"
    - "src/lib/pty/pty-session.ts (PtySession)"
  provides:
    - "GET /api/internal/terminal/[taskId]/buffer — PTY buffer read endpoint"
    - "POST /api/internal/terminal/[taskId]/input — PTY input write endpoint"
    - "src/lib/internal-api-guard.ts — localhost-only request guard"
  affects:
    - "Phase 34 MCP tools (get_task_terminal_output, send_task_terminal_input)"
tech_stack:
  added: []
  patterns:
    - "Next.js App Router route handlers with async params (Next.js 15)"
    - "Header-based localhost detection (no request.ip dependency)"
    - "Zod query/body validation in route handlers"
key_files:
  created:
    - src/lib/internal-api-guard.ts
    - src/app/api/internal/terminal/[taskId]/buffer/route.ts
    - src/app/api/internal/terminal/[taskId]/input/route.ts
  modified: []
decisions:
  - "Header-based localhost detection only — request.ip is unreliable in all Next.js runtimes"
  - "404 (not 500) for missing session — clean signal for MCP tools to report 'not running'"
  - "410 Gone for killed sessions — distinct from 404 (never existed) vs 410 (existed and exited)"
  - "lines param capped at 500 via Zod coerce — prevents oversized responses"
metrics:
  duration: 113s
  completed_date: "2026-04-11"
  tasks_completed: 3
  files_created: 3
  files_modified: 0
---

# Phase 33 Plan 01: Internal HTTP Bridge — Summary

**One-liner:** Localhost-only HTTP bridge routes exposing in-memory PTY sessions to MCP stdio process via GET buffer read and POST input write endpoints.

## What Was Built

Three new files create the IPC channel between the MCP stdio process (Phase 34) and the in-memory PTY session registry:

1. **`src/lib/internal-api-guard.ts`** — Shared `requireLocalhost()` utility that validates inbound requests are from loopback addresses via `host` header and optional `x-forwarded-for` header check. Returns 403 for non-local requests, null to proceed.

2. **`src/app/api/internal/terminal/[taskId]/buffer/route.ts`** — GET handler that reads the PTY buffer for a running session and returns the last N lines as a JSON array (`?lines=100`, max 500). Returns 404 for missing sessions, 403 for non-localhost.

3. **`src/app/api/internal/terminal/[taskId]/input/route.ts`** — POST handler that validates a `{ text: string }` body (Zod, 1–10000 chars) and forwards it to the PTY via `session.write()`. Returns 404 for missing sessions, 410 Gone for killed sessions, 403 for non-localhost.

## Why These Routes Work

The MCP stdio process runs in a separate Node.js process with its own `globalThis`, so it cannot directly import `session-store.ts`. The App Router route handlers in this plan run in the **same** Next.js Node.js process that initialized `globalThis.__ptySessions` via `instrumentation.ts → ws-server.ts → session-store.ts`. HTTP calls to `localhost:3000` are the correct IPC channel.

## Key Decisions Made

- **Header-only localhost detection**: `request.ip` is not reliably populated across all Next.js runtimes. Both `host` header and optional `x-forwarded-for` header are checked instead.
- **404 for missing session**: Clean signal (not 500) — MCP tools can report "task not running" without treating it as an error.
- **410 Gone for killed session**: Distinct from 404 (session never existed) — lets callers know the session ran but has since exited.
- **Params via `await params`**: Used Next.js 15 async params pattern (`params: Promise<{ taskId: string }>`) as confirmed by existing `[taskId]/diff/route.ts` in the codebase.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all three files are fully functional implementations.

## Self-Check: PASSED

Files:
- FOUND: src/lib/internal-api-guard.ts
- FOUND: src/app/api/internal/terminal/[taskId]/buffer/route.ts
- FOUND: src/app/api/internal/terminal/[taskId]/input/route.ts

Commits:
- 8ccb2ea: feat(ai-manager-33.01): create localhost guard utility
- 0901a25: feat(ai-manager-33.01): create GET /api/internal/terminal/[taskId]/buffer route (TERM-01)
- d092ab9: feat(ai-manager-33.01): create POST /api/internal/terminal/[taskId]/input route (TERM-02)

Type errors: 0 new (5 pre-existing errors in agent-config-actions.ts and pty-session.test.ts — unrelated, noted in STATE.md)
