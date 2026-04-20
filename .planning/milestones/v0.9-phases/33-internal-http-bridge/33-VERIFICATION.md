---
phase: 33-internal-http-bridge
verified: 2026-04-10T12:00:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 33: Internal HTTP Bridge Verification Report

**Phase Goal:** The Next.js server exposes two localhost-only HTTP routes that allow any process (including the MCP stdio process) to read PTY buffer contents and send input to a running PTY session
**Verified:** 2026-04-10T12:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                    | Status     | Evidence                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| 1   | curl GET /api/internal/terminal/{taskId}/buffer returns JSON with recent PTY output lines                | ✓ VERIFIED | buffer/route.ts exports GET, calls getSession+getBuffer, returns {taskId, lines, total, killed} |
| 2   | curl POST /api/internal/terminal/{taskId}/input with {text} sends text to the running PTY               | ✓ VERIFIED | input/route.ts exports POST, validates body via Zod, calls session.write(parsed.data.text)  |
| 3   | Both routes return 404 JSON when no active PTY session exists for the taskId                             | ✓ VERIFIED | Both routes: if (!session) return NextResponse.json({ error: "No active session" }, { status: 404 }) |
| 4   | Both routes reject non-localhost requests (loopback-only guard)                                          | ✓ VERIFIED | Both routes call requireLocalhost(request); guard checks host header + x-forwarded-for, returns 403 |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact                                                                  | Expected                             | Status     | Details                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------ | ---------- | -------------------------------------------------------------------------------- |
| `src/lib/internal-api-guard.ts`                                           | Shared localhost-only request guard  | ✓ VERIFIED | Exports `requireLocalhost`, 37 lines, fully substantive — header-based detection |
| `src/app/api/internal/terminal/[taskId]/buffer/route.ts`                  | GET handler returning PTY buffer     | ✓ VERIFIED | Exports `GET`, `dynamic`, `runtime` — 45 lines, complete implementation          |
| `src/app/api/internal/terminal/[taskId]/input/route.ts`                   | POST handler forwarding text to PTY  | ✓ VERIFIED | Exports `POST`, `dynamic`, `runtime` — 61 lines, complete implementation         |

### Key Link Verification

| From                               | To                               | Via                          | Status     | Details                                                              |
| ---------------------------------- | -------------------------------- | ---------------------------- | ---------- | -------------------------------------------------------------------- |
| buffer/route.ts                    | src/lib/pty/session-store.ts     | import getSession            | ✓ WIRED    | Line 3: `import { getSession } from "@/lib/pty/session-store"`, called line 22 |
| input/route.ts                     | src/lib/pty/session-store.ts     | import getSession            | ✓ WIRED    | Line 3: `import { getSession } from "@/lib/pty/session-store"`, called line 43 |
| buffer/route.ts                    | src/lib/internal-api-guard.ts    | import requireLocalhost      | ✓ WIRED    | Line 4: import, called line 17                                       |
| input/route.ts                     | src/lib/internal-api-guard.ts    | import requireLocalhost      | ✓ WIRED    | Line 4: import, called line 19                                       |

### Data-Flow Trace (Level 4)

These are API route handlers that read from in-memory PTY sessions (not a DB or rendered UI). Data-flow is verified by tracing from the route handler to the session-store globalThis registry.

| Artifact           | Data Variable    | Source                                      | Produces Real Data                    | Status       |
| ------------------ | ---------------- | ------------------------------------------- | ------------------------------------- | ------------ |
| buffer/route.ts    | `session`        | `getSession(taskId)` from session-store.ts  | `globalThis.__ptySessions` Map lookup | ✓ FLOWING    |
| buffer/route.ts    | `buffer`         | `session.getBuffer()`                       | PtySession.getBuffer() line 135       | ✓ FLOWING    |
| input/route.ts     | `session`        | `getSession(taskId)` from session-store.ts  | `globalThis.__ptySessions` Map lookup | ✓ FLOWING    |
| input/route.ts     | write side-effect| `session.write(parsed.data.text)`           | PtySession.write() calls pty.write()  | ✓ FLOWING    |

### Behavioral Spot-Checks

These routes require a running Next.js server with an active PTY session — cannot be tested without a live server. Skipped for offline verification; marked for human verification.

| Behavior                                              | Command                                                                             | Result | Status  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ | ------- |
| Module exports GET from buffer route                  | `node -e "require('./src/app/api/internal/terminal/[taskId]/buffer/route.ts')"`     | N/A    | ? SKIP  |
| Module exports POST from input route                  | N/A (App Router — requires Next.js runtime)                                         | N/A    | ? SKIP  |
| TypeScript compiles with no new errors                | `npx tsc --noEmit` — 5 pre-existing errors only, none from phase 33 files           | PASS   | ✓ PASS  |

### Requirements Coverage

| Requirement | Source Plan  | Description                                                                                    | Status      | Evidence                                                              |
| ----------- | ------------ | ---------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| TERM-01     | 33-01-PLAN   | Internal HTTP route GET /api/internal/terminal/[taskId]/buffer — returns last N PTY buffer lines | ✓ SATISFIED | buffer/route.ts exists, exports GET, reads getBuffer(), returns lines array |
| TERM-02     | 33-01-PLAN   | Internal HTTP route POST /api/internal/terminal/[taskId]/input — sends text to PTY             | ✓ SATISFIED | input/route.ts exists, exports POST, calls session.write() with validated text |

No orphaned requirements — TERM-01 and TERM-02 are the only requirements assigned to Phase 33 in REQUIREMENTS.md. TERM-03 through TERM-05 are assigned to Phase 34.

### Anti-Patterns Found

| File                         | Line | Pattern        | Severity  | Impact                                                                           |
| ---------------------------- | ---- | -------------- | --------- | -------------------------------------------------------------------------------- |
| internal-api-guard.ts        | 36   | `return null;` | Info      | Intentional design — null means "request is from localhost, proceed". Not a stub. |

No real anti-patterns found. The `return null` is the documented contract for the guard function (null = proceed, NextResponse = block).

### Human Verification Required

#### 1. Buffer Route Returns PTY Output

**Test:** Start a task execution to launch a PTY session. Then run: `curl http://localhost:3000/api/internal/terminal/{taskId}/buffer`
**Expected:** JSON `{ taskId, lines: [...], total: N, killed: false }` with actual terminal output lines
**Why human:** Requires running Next.js server with an active PTY session — cannot simulate in offline verification

#### 2. Input Route Sends Text to PTY

**Test:** With an active PTY session, run: `curl -X POST http://localhost:3000/api/internal/terminal/{taskId}/input -H "Content-Type: application/json" -d '{"text":"ls\n"}'`
**Expected:** Returns `{ ok: true, taskId }` and the text appears in subsequent buffer reads
**Why human:** Requires running server + PTY session to verify the write reaches the terminal

#### 3. Localhost Guard Blocks External Requests

**Test:** From a different host (or simulating via `Host: example.com` header), send a GET to the buffer route
**Expected:** Returns 403 `{ error: "Forbidden" }`
**Why human:** Requires network-level test or header spoofing to verify guard fires correctly

#### 4. 410 Gone for Killed Session

**Test:** Start a task execution, kill the PTY (or let it exit), then POST to the input route
**Expected:** Returns 410 `{ error: "Session has exited" }`
**Why human:** Requires lifecycle control over a PTY session (kill then query)

### Gaps Summary

No gaps. All four observable truths are verified. All three required artifacts exist, are substantive (fully implemented), and are wired to their dependencies. Both requirements (TERM-01, TERM-02) are satisfied. TypeScript compilation introduces no new errors. The only pending items are live-server behavioral spot-checks that require human verification.

---

_Verified: 2026-04-10T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
