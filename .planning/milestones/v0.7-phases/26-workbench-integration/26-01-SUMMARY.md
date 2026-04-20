---
phase: 26-workbench-integration
plan: 01
subsystem: backend-integration
tags: [pty, websocket, task-execution, server-actions]
dependency_graph:
  requires: [24-pty-backend-websocket-server, 25-xterm-terminal-component]
  provides: [startPtyExecution server action, PTY session pre-creation pattern]
  affects: [26-02 (UI wiring)]
tech_stack:
  added: []
  patterns: [pre-created PTY session with mutable data listener, setDataListener pattern]
key_files:
  created: []
  modified:
    - src/actions/agent-actions.ts
    - src/lib/pty/pty-session.ts
    - src/lib/pty/ws-server.ts
decisions:
  - startPtyExecution uses no-op onData at PTY creation; ws-server wires real broadcaster via setDataListener on WS connect
  - setDataListener replaces onData field on PtySession so ws-server can reassign broadcaster per-connection lifecycle
  - Close and error handlers reset data listener to no-op to discard PTY output during keepalive window
  - No revalidatePath in startPtyExecution — client calls router.refresh() after onSessionEnd fires (D-08)
metrics:
  duration: 300s
  completed: "2026-04-03"
  tasks_completed: 2
  files_modified: 3
---

# Phase 26 Plan 01: Workbench Integration — Server-Side PTY Wiring Summary

**One-liner:** PTY execution server action with mutable data listener pattern so pre-created sessions receive WebSocket broadcaster on client connect.

## What Was Built

### startPtyExecution server action (INT-01, INT-02, INT-03)

Added to `src/actions/agent-actions.ts`. Replaces the SSE stream route for terminal-based execution:

1. Loads task+project from DB, validates localPath exists, checks for running execution (409 guard)
2. Send-back: IN_REVIEW → IN_PROGRESS before new execution starts
3. Builds full prompt string (mirrors `buildExecutionPrompt` from stream/route.ts)
4. Prepares instructions file from `selectedPromptId ?? task.promptId` (temp dir + writeFile)
5. Creates git worktree if `task.baseBranch` is set
6. Creates `TaskExecution` row with `status: RUNNING` and `worktreePath/worktreeBranch`
7. Builds Claude CLI args: `--dangerously-skip-permissions [--system-prompt file] prompt` — **no** `--output-format stream-json`, **no** `--print -` (INT-02: raw TTY mode)
8. Creates PTY session via `createSession()` with no-op onData (ws-server wires real sender)
9. onExit callback: updates execution to COMPLETED/FAILED + updates task to IN_REVIEW on exitCode 0 (INT-03)
10. Returns `{ executionId, worktreePath }` for client to connect WebSocket

### PtySession.setDataListener (support for pre-created sessions)

Added to `src/lib/pty/pty-session.ts`:
- Changed `onData` from constructor closure to mutable `_onData` field
- Added `setDataListener(fn)` public method that replaces `_onData`
- `_pty.onData` handler calls `this._onData(data)` instead of closure

### ws-server.ts data listener lifecycle

Updated `src/lib/pty/ws-server.ts`:
- **Reconnect path** (session exists): cancel disconnect timer → `setDataListener(batchedSender)` → replay buffer
- **New session path** (no pre-existing session): create session → `setDataListener(batchedSender)` immediately
- **Close handler**: `setDataListener(() => {})` before starting keepalive timer
- **Error handler**: `setDataListener(() => {})` to prevent writes to broken socket

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| No-op onData at PTY creation | ws-server wires real broadcaster on WS connect; avoids tight coupling between server action and WS lifecycle |
| setDataListener on both connect paths | Unified pattern — both fresh connections and reconnections get a fresh batchedSender |
| Reset to no-op on close/error | Prevents PTY output during keepalive window from flooding a closed/broken socket |
| No revalidatePath | Client calls router.refresh() after onSessionEnd fires (D-08 per CONTEXT.md) |

## Deviations from Plan

None — plan executed exactly as written. Task 1 and Task 2 both described modifications to pty-session.ts and ws-server.ts; all changes implemented as specified.

## Known Stubs

None — all data paths are fully wired. The `startPtyExecution` function creates real DB rows, spawns real PTY sessions, and triggers real status updates on exit.

## Self-Check: PASSED

- `src/actions/agent-actions.ts` — modified, `startPtyExecution` exported at line 85
- `src/lib/pty/pty-session.ts` — modified, `setDataListener` at line 55
- `src/lib/pty/ws-server.ts` — modified, `setDataListener` called at 4 sites
- Commits: `8954d54` (Task 1), `4f4f24e` (Task 2)
- TypeScript: no errors in modified files (`npx tsc --noEmit` clean for our files)
