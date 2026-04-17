---
phase: 36-assistant-backend
verified: 2026-04-17T10:30:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 36: Assistant Backend Verification Report

**Phase Goal:** The system can spawn a dedicated Claude CLI PTY session for the global assistant with restricted tools and a predefined identity, independent of any task.
**Verified:** 2026-04-17T10:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `startAssistantSession` creates a PTY session keyed by `__assistant__` | VERIFIED | `createSession(ASSISTANT_SESSION_KEY, ...)` at line 73 of `assistant-actions.ts`; `ASSISTANT_SESSION_KEY = "__assistant__"` in `assistant-constants.ts` |
| 2 | The spawned CLI process includes `--allowedTools mcp__tower__*` and `--append-system-prompt` | VERIFIED | Lines 61-65 of `assistant-actions.ts` push both flags as separate array elements |
| 3 | `stopAssistantSession` destroys the `__assistant__` session | VERIFIED | `destroySession(ASSISTANT_SESSION_KEY)` at line 87 of `assistant-actions.ts` |
| 4 | `startAssistantSession` destroys any existing `__assistant__` session before creating a new one | VERIFIED | `destroySession(ASSISTANT_SESSION_KEY)` at line 23, before `createSession` at line 73 |
| 5 | `assistant.displayMode` and `assistant.systemPrompt` config keys are registered in `CONFIG_DEFAULTS` | VERIFIED | `config-defaults.ts` lines 83-93 contain both entries with correct types and default values |
| 6 | WebSocket server accepts `taskId=__assistant__` and immediately destroys the session on WS close (no keepalive) | VERIFIED | `ws-server.ts` lines 106-110: guard checks `taskId === ASSISTANT_SESSION_KEY` and calls `destroySession(taskId)` + returns before keepalive timeout block |
| 7 | POST/DELETE/GET `/api/internal/assistant` manage the assistant session lifecycle with localhost guard | VERIFIED | `route.ts` exports POST, DELETE, GET; all three call `requireLocalhost(request)` before acting |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/actions/assistant-actions.ts` | `startAssistantSession`, `stopAssistantSession`, `getAssistantSessionStatus` server actions | VERIFIED | File exists, 99 lines, exports all three async functions with `"use server"` directive |
| `src/lib/assistant-constants.ts` | `ASSISTANT_SESSION_KEY = "__assistant__"` | VERIFIED | 2-line file exporting the constant; imported by all three consumers (`assistant-actions.ts`, `ws-server.ts`, `route.ts`) |
| `src/lib/config-defaults.ts` | `assistant.systemPrompt` and `assistant.displayMode` config entries | VERIFIED | Both entries present at lines 83-93 with correct `type` and `defaultValue` |
| `src/app/api/internal/assistant/route.ts` | POST (start), DELETE (stop), GET (status) endpoints | VERIFIED | File exists, exports all three handlers, all guarded by `requireLocalhost` |
| `src/lib/pty/ws-server.ts` | Immediate-destroy on WS close for `__assistant__` session | VERIFIED | Lines 105-110 implement the guard correctly before the keepalive timeout |
| `src/actions/__tests__/assistant-actions.test.ts` | Vitest test stubs — 8 todo items | VERIFIED | File exists, discovered by vitest, 8 todo items match planned behaviors |
| `src/lib/pty/__tests__/ws-server-assistant.test.ts` | Vitest test stubs — 3 todo items | VERIFIED | File exists, discovered by vitest, 3 todo items match planned behaviors |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/actions/assistant-actions.ts` | `src/lib/pty/session-store.ts` | `createSession(ASSISTANT_SESSION_KEY, ...)` | WIRED | Line 73 of `assistant-actions.ts` calls `createSession` with `ASSISTANT_SESSION_KEY` as first arg |
| `src/actions/assistant-actions.ts` | `src/lib/config-reader.ts` | `readConfigValue("assistant.systemPrompt", ...)` | WIRED | Lines 49-52 call `readConfigValue<string>("assistant.systemPrompt", DEFAULT_SYSTEM_PROMPT)` |
| `src/app/api/internal/assistant/route.ts` | `src/actions/assistant-actions.ts` | `import startAssistantSession, stopAssistantSession` | WIRED | Lines 4-7 of `route.ts` import all three actions; each handler calls the corresponding function |
| `src/lib/pty/ws-server.ts` | `src/lib/pty/session-store.ts` | `destroySession(taskId)` in `__assistant__` guard | WIRED | Line 108 of `ws-server.ts` calls `destroySession(taskId)` inside the assistant guard block |
| `src/lib/pty/ws-server.ts` | `src/lib/assistant-constants.ts` | `import ASSISTANT_SESSION_KEY` | WIRED | Line 5 of `ws-server.ts` imports `ASSISTANT_SESSION_KEY`; used at line 106 for the guard condition |

**Note on ASSISTANT_SESSION_KEY export location:** Plan 01 specified that `ASSISTANT_SESSION_KEY` would be exported from `assistant-actions.ts`. The implementation moved it to `src/lib/assistant-constants.ts` (commit `81189bf` — "use server" files cannot export non-async values). All three consumers import from `assistant-constants.ts` directly. The contract is fulfilled: the constant is accessible to all callers and the value is `"__assistant__"` as required.

---

### Data-Flow Trace (Level 4)

Not applicable. Phase 36 produces server-side lifecycle actions and API routes, not components that render dynamic data.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `ASSISTANT_SESSION_KEY` value is `"__assistant__"` | `grep 'ASSISTANT_SESSION_KEY = ' src/lib/assistant-constants.ts` | `"__assistant__"` | PASS |
| `--allowedTools` and `mcp__tower__*` pushed as separate array elements | `grep -A1 '"--allowedTools"' src/actions/assistant-actions.ts` | line 62: `"--allowedTools"`, line 63: `"mcp__tower__*"` | PASS |
| `--append-system-prompt` present in CLI args | `grep '"--append-system-prompt"' src/actions/assistant-actions.ts` | line 64 | PASS |
| `AI_MANAGER_TASK_ID` NOT injected into envOverrides | `grep 'AI_MANAGER_TASK_ID' src/actions/assistant-actions.ts` | only in comments, not in code | PASS |
| `validateTaskId` NOT called in assistant route | `grep 'validateTaskId' src/app/api/internal/assistant/route.ts` | no matches | PASS |
| `requireLocalhost` called in all three route handlers | `grep -c 'requireLocalhost' src/app/api/internal/assistant/route.ts` | 3 | PASS |
| Assistant test stubs discovered by Vitest | `npx vitest run --reporter verbose 2>&1 \| grep 'assistant-actions.test'` | 8 todo items listed | PASS |
| WS assistant guard appears BEFORE keepalive setTimeout | line 106 guard with `return` before line 112 keepalive | PASS | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| BE-01 | 36-01 | System creates a new Claude CLI PTY session when user opens the assistant | SATISFIED | `createSession(ASSISTANT_SESSION_KEY, ...)` in `startAssistantSession` |
| BE-02 | 36-01 | System injects a system prompt via `--append-system-prompt` | SATISFIED | Lines 64-65 of `assistant-actions.ts`; prompt read from config via `readConfigValue` |
| BE-03 | 36-01 | System restricts tools to Tower MCP only via `--allowedTools "mcp__tower__*"` | SATISFIED | Lines 61-62 of `assistant-actions.ts` push the flag and value as separate elements |
| BE-04 | 36-02 | System connects the assistant to the PTY session via WebSocket for real-time streaming | SATISFIED | Existing `ws-server.ts` already routes any `taskId` from query param to its session; assistant connects with `taskId=__assistant__` and is handled identically to task sessions |
| BE-05 | 36-01, 36-02 | System destroys the PTY session when the assistant is closed (stateless) | SATISFIED | `stopAssistantSession` calls `destroySession`; WS close handler in `ws-server.ts` immediately destroys `__assistant__` sessions without keepalive |
| BE-06 | 36-01 | System supports a config key to switch between terminal mode and chat mode | SATISFIED | `"assistant.displayMode"` registered in `CONFIG_DEFAULTS` with default `"terminal"` |
| UX-01 | 36-01 | Each assistant open starts a fresh session with no prior history | SATISFIED | `startAssistantSession` calls `destroySession(ASSISTANT_SESSION_KEY)` before `createSession`; WS server also destroys on disconnect ensuring no buffered state persists |

**Orphaned requirements check:** REQUIREMENTS.md maps BE-01 through BE-06 and UX-01 to Phase 36. All 7 are claimed by plan 36-01 or 36-02 and verified above. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None detected | — | — | — | — |

Scan results:
- No TODO/FIXME/placeholder comments in phase 36 files
- No empty return values (`return null`, `return []`, `return {}`) — all functions perform real operations
- No hardcoded empty env overrides — `profileEnvVars` is populated from DB profile
- No `console.log` in production code (only `console.error` in `ws-server.ts`, matching existing convention)
- Test stubs use `it.todo()` which is the correct vitest pattern for planned-but-unimplemented tests

---

### Pre-Existing Test Failures (Not Phase 36 Regressions)

The full test suite reports 8 failed test files (27 failed tests). None are related to phase 36:

- `tests/unit/actions/preview-actions.test.ts` — pre-existing (`unref()` assertion mismatch, last touched in phase 29)
- `tests/unit/components/board-stats.test.tsx` — pre-existing (component rendering)
- `tests/unit/components/asset-item.test.tsx` — pre-existing (download link rendering)
- `tests/unit/components/create-task-dialog.test.tsx` — pre-existing (branch selector rendering)
- `tests/unit/components/prompts-config.test.tsx` — pre-existing (prompts config component)
- `tests/unit/lib/instrumentation.test.ts` — pre-existing (SQLite/Prisma DB mock issues)
- `tests/unit/lib/pty-session.test.ts` — TypeScript type mismatch (`addExitListener` vs `setExitListener`, pre-existing)

Phase 36 commits do not touch any of these test files.

---

### Human Verification Required

#### 1. End-to-end PTY spawn with real CliProfile

**Test:** Ensure a default CliProfile exists in the dev database, then call `startAssistantSession()` via the POST `/api/internal/assistant` endpoint (e.g. `curl -X POST http://localhost:3000/api/internal/assistant`). Check that a Claude CLI process is actually spawned.
**Expected:** Response `{ ok: true, sessionKey: "__assistant__" }` and a live PTY process visible in process list.
**Why human:** Requires a running dev server and a configured CliProfile in the SQLite database.

#### 2. WebSocket streaming end-to-end

**Test:** After starting the assistant via POST, open a WebSocket connection to `ws://127.0.0.1:3001?taskId=__assistant__`. Type a query into the PTY and observe streaming output.
**Expected:** Claude CLI output streams through the WebSocket in real time.
**Why human:** Requires a running WS server, active PTY session, and browser/wscat client.

#### 3. Session destruction on WS close

**Test:** Open assistant, close the WebSocket (disconnect), then call GET `/api/internal/assistant` to check status.
**Expected:** Status returns `"idle"` immediately after disconnect (no keepalive delay).
**Why human:** Requires observing timing behavior in a running system.

---

### Gaps Summary

No gaps. All 7 observable truths are verified, all artifacts exist and are substantive and wired, all 7 requirements are satisfied.

The one implementation deviation from the plan (`ASSISTANT_SESSION_KEY` moved to `assistant-constants.ts` instead of exported from `assistant-actions.ts`) is a correct adaptation — Next.js "use server" files cannot export non-async non-function values, so the refactor was necessary and does not break the contract.

---

_Verified: 2026-04-17T10:30:00Z_
_Verifier: Claude (gsd-verifier)_
