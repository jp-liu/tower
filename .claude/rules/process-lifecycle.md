# Process & Resource Lifecycle

## PTY Sessions

- Sessions keyed by `taskId` — one active session per task.
- Concurrency limited by `system.maxConcurrentExecutions` config (default 20).
- Disconnect keepalive: 2h (running) / 5min (exited), then auto-destroy.
- SIGTERM handler in `session-store.ts` kills all sessions on exit.

## Preview Processes

- Auto-stop on component unmount (page navigation).
- Auto-remove from registry on process exit.
- SIGTERM/SIGINT handlers kill all preview processes on app exit.
- No `child.unref()` — parent must track child lifecycle.

## WebSocket Server

- Flush batched sender on WebSocket close.
- Clear polling timer on WebSocket error.
- Port read from `terminal.wsPort` config (default 3001).

## Timers

- All `setTimeout`/`setInterval` must be cleared in cleanup (useEffect return, onClose, onExit).
- Resize debounce timers must be cleared on component unmount.

## Database

- Prisma `$disconnect()` called on SIGTERM/SIGINT.
- SQLite WAL mode + busy_timeout=5000 set in `initDb()`.
