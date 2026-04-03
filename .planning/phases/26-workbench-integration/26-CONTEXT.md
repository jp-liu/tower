# Phase 26: Workbench Integration - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the TaskTerminal component (Phase 25) into the task workbench page, replacing the current TaskConversation chat bubble UI. Three capabilities: (1) clicking "Execute" creates a PTY session and shows terminal output live, (2) Claude CLI runs in PTY mode (no stream-json), (3) PTY exit updates task status (success → IN_REVIEW, failure → unchanged).

</domain>

<decisions>
## Implementation Decisions

### Wiring TaskTerminal
- **D-01:** In `task-page-client.tsx`, replace `TaskConversation` import with `TaskTerminal` loaded via `dynamic({ ssr: false })`. The terminal fills the left panel where chat was.
- **D-02:** Remove `TaskMessageInput` component from the left panel — terminal handles input directly via keyboard. No separate text input needed.
- **D-03:** Keep the existing `messages` state for backward compatibility with history display — but new executions use terminal. For tasks without an active PTY session, show historical messages in a simple readonly view.

### Execution Flow
- **D-04:** When user clicks "Execute" (sends a message), instead of calling the SSE stream route, create a PTY session via a new server action `createTerminalSession(taskId, prompt, cwd)`. This returns the taskId to connect the WebSocket.
- **D-05:** The server action spawns Claude CLI in the PTY with the user's prompt. No `--output-format stream-json` or `--print -` flags — raw TTY mode.
- **D-06:** The terminal component auto-connects to `ws://localhost:3001/terminal?taskId={taskId}` when a session is active.

### Status Updates
- **D-07:** PTY onExit callback triggers a server action to update task status: exitCode 0 → IN_REVIEW, non-zero → keep current status.
- **D-08:** The `onSessionEnd` prop on TaskTerminal fires when PTY exits — triggers `router.refresh()` to reload task data.

### Claude's Discretion
- Whether to show a "Start" button or auto-connect when entering the page
- How to handle the transition from old messages view to terminal view
- Whether to persist terminal transcript to DB on session end
- i18n keys for terminal-related UI changes

</decisions>

<code_context>
## Existing Code Insights

### Files to Modify
- `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` — replace TaskConversation with TaskTerminal
- `src/app/api/tasks/[taskId]/stream/route.ts` — may need a PTY execution path alongside SSE
- `src/actions/agent-actions.ts` — add `createTerminalSession` server action

### Reusable Assets
- `src/lib/pty/session-store.ts` — createSession/getSession from Phase 24
- `src/lib/pty/ws-server.ts` — WS server already running on port 3001
- `src/components/task/task-terminal.tsx` — TaskTerminal component from Phase 25
- Existing execution flow in stream/route.ts — reference for prompt building, worktree creation, status updates

### Integration Points
- TaskTerminal needs `taskId` + `worktreePath` props from page
- Session creation needs to build the same prompt as current stream route (append prompt, instructions file, etc.)
- Status update on PTY exit needs to mirror current stream route's `persistResult` behavior

</code_context>

<specifics>
## Specific Ideas

No specific requirements — follow existing execution flow patterns.

</specifics>

<deferred>
## Deferred Ideas

- DB persistence of terminal transcript (raw ANSI or stripped) — defer to v0.8
- Session resume after page navigation — defer to v0.8

</deferred>

---

*Phase: 26-workbench-integration*
*Context gathered: 2026-04-03*
