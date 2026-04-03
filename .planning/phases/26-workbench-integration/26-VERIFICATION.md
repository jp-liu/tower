---
phase: 26-workbench-integration
verified: 2026-03-31T00:00:00Z
status: gaps_found
score: 8/10 must-haves verified
gaps:
  - truth: "When PTY exits with code 0 the task status badge in the header updates to IN_REVIEW without a manual refresh"
    status: failed
    reason: "TaskTerminal receives onSessionEnd prop but the callback is destructured as _onSessionEnd and never called anywhere in the component. ws-server.ts also has no protocol for sending exit code events to the browser. The client has no way to know PTY exited."
    artifacts:
      - path: "src/components/task/task-terminal.tsx"
        issue: "_onSessionEnd is aliased at line 43 but never invoked — not in the WebSocket close handler, not in any effect. The PTY exit has no client-visible signal."
      - path: "src/lib/pty/ws-server.ts"
        issue: "onExit callback (line 112-115) only logs to console. No WS message is sent to the browser with the exit code."
    missing:
      - "ws-server.ts must send an exit-code message to the WS client when PTY exits (e.g., JSON {type:'session_end', exitCode: N})"
      - "TaskTerminal must listen for that WS message and call _onSessionEnd(exitCode)"
human_verification:
  - test: "Full end-to-end terminal execution flow"
    expected: "Claude CLI output appears raw with ANSI colors in xterm.js terminal after clicking Execute"
    why_human: "Cannot test WebSocket PTY rendering and live output without running the dev server"
  - test: "Execute button state management"
    expected: "isExecuting resets after session ends (button returns to Execute state)"
    why_human: "Depends on onSessionEnd being called — currently broken — but the isExecuting reset logic itself (once wired) needs visual verification"
---

# Phase 26: Workbench Integration Verification Report

**Phase Goal:** Users can start task execution and see Claude CLI running live in the workbench terminal, with task status updating when done
**Verified:** 2026-03-31T00:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

#### Plan 01 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Calling startPtyExecution creates a TaskExecution row with status RUNNING and worktreePath set | VERIFIED | Lines 172-181 in agent-actions.ts: `db.taskExecution.create({ data: { status: "RUNNING", worktreePath: resolvedWorktreePath ?? null } })` |
| 2 | PTY spawns claude CLI without --output-format stream-json or --print - | VERIFIED | Lines 184-188: args array starts with `--dangerously-skip-permissions`, no stream-json or --print flags. Comment explicitly states INT-02. |
| 3 | When PTY exits with code 0, task status updates to IN_REVIEW in the database | VERIFIED | Lines 212-217: `if (exitCode === 0) { db.task.update({ data: { status: "IN_REVIEW" } }) }` |
| 4 | When PTY exits with non-zero code, task status does not change | VERIFIED | The IN_REVIEW update is guarded by `if (exitCode === 0)` — non-zero exits only update the execution row to FAILED |
| 5 | ws-server.ts onExit callback receives taskId and exitCode to trigger the DB update | VERIFIED | The DB update lives in the `createSession` onExit closure in agent-actions.ts (not ws-server). ws-server's fallback onExit (line 112-115) only logs. The primary path (startPtyExecution pre-created sessions) uses the closure correctly. |

#### Plan 02 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | Left panel shows terminal (xterm.js) instead of chat bubbles | VERIFIED | task-page-client.tsx lines 170-176: `<TaskTerminal>` in `flex-1 min-h-0` div. grep confirms zero occurrences of TaskConversation or TaskMessageInput. |
| 7 | User can click Execute button to start Claude CLI; button calls startPtyExecution and shows live terminal output | VERIFIED (partial) | handleExecute (lines 99-113) calls startPtyExecution correctly and updates activeWorktreePath. Terminal connects via WebSocket. Live output rendering requires human verification. |
| 8 | When PTY exits code 0 the task status badge updates to IN_REVIEW without manual refresh | FAILED | `_onSessionEnd` is destructured at line 43 of task-terminal.tsx but is never called anywhere in the component. No WS exit-code protocol in ws-server.ts either. handleSessionEnd in task-page-client.tsx will never fire. |
| 9 | TaskConversation and TaskMessageInput are no longer rendered | VERIFIED | grep on task-page-client.tsx returns zero matches for both. Confirmed removed. |
| 10 | Terminal fills full height of left panel below header | VERIFIED | `<div className="flex-1 min-h-0 overflow-hidden">` wraps TaskTerminal (line 170). Parent Panel uses `flex flex-col`. |

**Score:** 8/10 truths verified (1 failed: IN_REVIEW client-side update; 1 partially verified: live output needs human check)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/actions/agent-actions.ts` | startPtyExecution server action | VERIFIED | Exported at line 85. Substantive 144-line implementation. All 9 steps per plan implemented. |
| `src/lib/pty/ws-server.ts` | onExit DB update hook | VERIFIED | setDataListener called at 4 sites (lines 94, 119, 157, 174). Note: DB update is in agent-actions.ts onExit closure, not ws-server directly — this is correct per plan. |
| `src/lib/pty/pty-session.ts` | setDataListener method | VERIFIED | Lines 55-57: `setDataListener(fn): void { this._onData = fn }`. `_onData` field declared at line 12. |
| `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` | TaskTerminal wired into left panel | VERIFIED | Dynamic import at lines 19-22 with `{ ssr: false }`. JSX usage at lines 171-175 with taskId, worktreePath, onSessionEnd props. |
| `src/lib/i18n.tsx` | i18n keys for execute button and terminal states | VERIFIED | All 5 keys present in both zh (lines 423-427) and en (lines 826-830) sections. |
| `src/components/task/task-terminal.tsx` | TaskTerminal calls onSessionEnd on PTY exit | FAILED | `onSessionEnd` prop is accepted and aliased as `_onSessionEnd` (line 43) but is never called in the component body. No exit code is received from WebSocket either. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/actions/agent-actions.ts` | `src/lib/pty/session-store.ts` | createSession call | VERIFIED | Line 192: `createSession(taskId, "claude", claudeArgs, cwd, () => {}, async (exitCode) => { ... })` |
| `src/lib/pty/ws-server.ts` | DB (task status) | onExit callback updates task status | VERIFIED (via agent-actions) | The DB update happens in agent-actions.ts's onExit closure, not ws-server directly. ws-server's fallback onExit only logs. This is correct design. |
| `task-page-client.tsx` | `startPtyExecution` | import from @/actions/agent-actions | VERIFIED | Line 15: `import { startPtyExecution } from "@/actions/agent-actions"` |
| `task-page-client.tsx` | `TaskTerminal` | next/dynamic({ ssr: false }) | VERIFIED | Lines 19-22: `const TaskTerminal = dynamic(() => import(...).then(m => ({ default: m.TaskTerminal })), { ssr: false })` |
| `TaskTerminal` | `onSessionEnd` callback | WS close event | FAILED | `_onSessionEnd` is never called in task-terminal.tsx. ws-server.ts sends no exit-code JSON frame to the browser. The signal chain is broken. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `task-page-client.tsx` | `activeWorktreePath` | `latestExecution?.worktreePath` (prop from DB) + `startPtyExecution` return | Yes — real DB data | FLOWING |
| `task-page-client.tsx` | `taskStatus` | Prop from DB, updated via `setTaskStatus("IN_REVIEW")` in handleSessionEnd | Partial — handleSessionEnd never fires due to onSessionEnd gap | HOLLOW (handleSessionEnd never called) |
| `task-page-client.tsx` | `diffData` | fetch `/api/tasks/${task.id}/diff` in useEffect | Real API call, conditional on taskStatus === IN_REVIEW | FLOWING (but only reachable if taskStatus reaches IN_REVIEW, which is broken client-side) |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| startPtyExecution exported | `grep -n "startPtyExecution" src/actions/agent-actions.ts` | Line 85: export async function startPtyExecution | PASS |
| No stream-json in CLI args | `grep -n "stream-json" src/actions/agent-actions.ts` | Only in comment (line 81, 183) — not in args array | PASS |
| IN_REVIEW update on exit 0 | `grep -n "IN_REVIEW" src/actions/agent-actions.ts` | Line 214: `data: { status: "IN_REVIEW" }` inside `if (exitCode === 0)` | PASS |
| setDataListener 4 call sites | `grep -n "setDataListener" src/lib/pty/ws-server.ts` | Lines 94, 119, 157, 174 | PASS |
| TaskConversation removed | `grep "TaskConversation" task-page-client.tsx` | No matches | PASS |
| onSessionEnd called in terminal | `grep "_onSessionEnd" src/components/task/task-terminal.tsx` | Only at line 43 (destructure) — never invoked | FAIL |
| TypeScript compiles clean | `npx tsc --noEmit` | No output (no errors) | PASS |
| i18n keys present in both locales | `grep -c "terminal.execute" src/lib/i18n.tsx` | 2 (zh + en) | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| INT-01 | 26-01, 26-02 | Click Execute creates PTY session and shows in terminal | SATISFIED | startPtyExecution creates TaskExecution + PTY session; task-page-client.tsx calls it; TaskTerminal connects via WebSocket |
| INT-02 | 26-01, 26-02 | Claude CLI runs in PTY (no stream-json, raw TTY output) | SATISFIED | Claude args array: `["--dangerously-skip-permissions", fullPrompt]` — no stream-json, no --print - |
| INT-03 | 26-01, 26-02 | PTY exit updates task status (success→IN_REVIEW, failure→keep) | PARTIALLY SATISFIED | Server-side DB update is wired correctly in agent-actions.ts onExit. Client-side status badge update is broken (onSessionEnd never called by TaskTerminal). router.refresh() also never fires. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/task/task-terminal.tsx` | 43 | `onSessionEnd: _onSessionEnd` — prop aliased but never used | Blocker | Client-side status transition to IN_REVIEW never fires; isExecuting never resets on success; router.refresh() never called |

---

### Human Verification Required

#### 1. Live PTY Output in xterm.js

**Test:** Start dev server (`pnpm dev`), navigate to a task with a project that has `localPath` configured, enter a prompt, click Execute.
**Expected:** Claude CLI output appears in the terminal with ANSI colors (not JSON, not chat bubbles). Connection status dot shows green.
**Why human:** Cannot test WebSocket PTY rendering and live output without running the dev server.

#### 2. Execute Button State Reset After Gap Fix

**Test:** After the onSessionEnd gap is fixed, verify that the Execute button returns from "Executing..." to "Execute" state after Claude finishes.
**Expected:** isExecuting resets to false; button re-enables.
**Why human:** Depends on the fix being applied first; requires visual inspection.

---

### Gaps Summary

**One critical gap** blocks INT-03's client-side behavior:

The `TaskTerminal` component in `src/components/task/task-terminal.tsx` accepts an `onSessionEnd` prop (aliased as `_onSessionEnd`) but never calls it. This breaks the entire client-side status update chain:

- `handleSessionEnd` in task-page-client.tsx is never triggered
- `setTaskStatus("IN_REVIEW")` never fires → status badge stays stale
- `router.refresh()` never fires → latestExecution data is not refreshed
- `setIsExecuting(false)` (in handleSessionEnd) never fires → button stays "Executing..."

The server-side DB update (INT-03 server half) IS correct: when PTY exits with code 0, `db.task.update({ status: "IN_REVIEW" })` runs in the `onExit` closure inside `startPtyExecution`. But the client never learns about this.

**Root cause:** The WS protocol between ws-server and the browser has no exit-code message. When PTY exits, ws-server closes the session but sends nothing. The browser detects `ws.close` but there's no payload distinguishing "PTY exited normally" from "WS disconnected." And even if there were, TaskTerminal doesn't call `_onSessionEnd`.

**Fix requires two changes:**
1. `ws-server.ts`: In the PtySession onExit handler (within the existing session path), send a JSON frame to the active WS client: `ws.send(JSON.stringify({ type: "session_end", exitCode }))`
2. `src/components/task/task-terminal.tsx`: In the `ws.addEventListener("message", ...)` or a dedicated message handler, detect `{type:"session_end"}` and call `_onSessionEnd?.(exitCode)`

The `router.refresh()` call will then work correctly once `handleSessionEnd` is triggered.

---

_Verified: 2026-03-31T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
