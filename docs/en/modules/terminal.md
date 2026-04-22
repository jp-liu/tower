---
title: Terminal
description: PTY terminal system providing independent Claude CLI sessions per task
---

# Terminal Module

**Slug:** `terminal`

## Overview

Each task gets its own terminal session rendered via xterm.js directly in the browser. Terminal I/O flows in real time over WebSocket with full ANSI rendering — colors, progress bars, cursor movement, and all standard terminal escape sequences are supported. You can type directly into the terminal for interactive keyboard input, enabling live conversation with Claude CLI.

When a client disconnects, the session stays alive with auto-keepalive (2 hours while running, 5 minutes after the process exits). Multiple clients can view the same terminal session simultaneously — for example, the task detail page and the Missions monitoring panel can both display the same live terminal output.

## Details

- **Architecture**: The browser-side xterm.js terminal connects via WebSocket to a Node.js server (`ws-server.ts`), which bridges to a real PTY session managed by node-pty. The `session-store.ts` module keeps an in-memory registry of all active sessions indexed by task ID.
- **One session per task**: Each task can only have one active PTY session at a time. Starting a new session for a task that already has one will fail.
- **Concurrency limit**: The maximum number of simultaneous PTY sessions is controlled by the `system.maxConcurrentExecutions` config setting (default 20).
- **Environment injection**: Every PTY session automatically receives `AI_MANAGER_TASK_ID` and `CALLBACK_URL` environment variables. Additional env vars come from the active CLI Profile.
- **Internal HTTP bridge**: Since MCP runs as a separate stdio process, it cannot access in-memory PTY sessions directly. Instead, it uses localhost-only HTTP endpoints to read terminal output and send input.

## Architecture

```
Client (xterm.js) <-> WebSocket <-> ws-server.ts <-> PTY Session (node-pty)
                                                         |
                                                    session-store.ts
```

## File Reference

### Core Library (`src/lib/pty/`)

| File | Description |
|------|-------------|
| `pty-session.ts` | PTY session management (node-pty wrapper) |
| `session-store.ts` | In-memory PTY session store, indexed by taskId |
| `ws-server.ts` | WebSocket server, port configured via `terminal.wsPort` |

### API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/internal/terminal/[taskId]/start` | POST | Start a PTY session |
| `/api/internal/terminal/[taskId]/buffer` | GET | Get terminal output buffer |
| `/api/internal/terminal/[taskId]/input` | POST | Send input to terminal |

### Server Actions (`src/actions/agent-actions.ts`)

| Function | Description |
|----------|-------------|
| `startPtyExecution(taskId, prompt)` | Start Claude CLI PTY |
| `resumePtyExecution(taskId, sessionId)` | Resume session |
| `stopPtyExecution(taskId)` | Stop session |

### Components

- `src/components/task/task-terminal.tsx` -- xterm.js terminal UI

### MCP Tools (`src/mcp/tools/terminal-tools.ts`)

- `get_task_terminal_output` / `send_task_terminal_input` / `get_task_execution_status`

## Constraints

- Only one active session per taskId
- Concurrency limit configured via `system.maxConcurrentExecutions` (default 20)
- Disconnect keepalive: 2h while running / 5min after exit
- All sessions automatically cleaned up on SIGTERM
- `AI_MANAGER_TASK_ID` and `CALLBACK_URL` are injected into PTY environment variables
- Do not modify `process.env`; use `envOverrides` instead
