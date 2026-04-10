# Pitfalls Research — v0.9: Adapter Cleanup + External Dispatch

**Domain:** Adding adapter cleanup, CLI Profile config, external dispatch via MCP terminal tools, PTY idle detection, and Feishu hook notification to an existing Next.js 16 + node-pty system.
**Researched:** 2026-04-10
**Confidence:** HIGH — findings derived directly from reading the current codebase (`src/lib/adapters/`, `src/lib/pty/`, `src/mcp/`, `notify-agi.sh`) plus verified architectural principles.

> This file supersedes the v0.7 PITFALLS.md (browser terminal integration). v0.7 pitfalls remain valid and are not repeated here. This document covers only the net-new risks introduced by v0.9 changes.

---

## Critical Pitfalls

### Pitfall 1: Dead Code Removal Severs Live References

**What goes wrong:**
`src/lib/adapters/registry.ts` exports `getAdapter` and `listAdapters`. Both are imported by active route handlers:

- `src/app/api/adapters/test/route.ts` — imports both. The `GET` handler calls `listAdapters()`. The `POST` handler calls `getAdapter(adapterType)` to dispatch `testEnvironment`.
- `src/app/api/tasks/[taskId]/execute/route.ts` — imports `listAdapters` (currently unused in the function body, but the import exists at line 5).

If `registry.ts` is deleted or emptied without auditing all import sites, the build will break silently in development (TypeScript module resolution errors are sometimes suppressed by `@ts-nocheck` or missed if the developer only runs `next dev` rather than `tsc`). In production, the route will throw a module-not-found error at request time, not at startup.

The `src/lib/adapters/claude-local/test.ts` file is the real implementation of CLI verification. The Settings page's "AI Tools" tab calls the test route, which calls `adapter.testEnvironment()` from the registry. Delete the registry without migrating the test route and the Settings verification UI goes dark with no runtime error until a user clicks the verify button.

**Why it happens:**
The adapter pattern wraps `testEnvironment` behind a registry indirection. The test route does not call `testEnvironment` directly — it goes through `getAdapter(type)`. When the registry is removed, the Settings UI feature disappears even though the underlying `test.ts` implementation still exists and is valuable.

The `execute/route.ts` import of `listAdapters` is unused in the route body today, but it proves the pattern: imports that are "just for validation" are easy to miss during cleanup.

**Consequences:**
- Settings > AI Tools verification breaks silently (returns 500, no helpful error).
- `listAdapters` call in `GET /api/adapters` returns empty array or 500, breaking any client that reads it.
- Build may pass (TypeScript resolves the deleted module path until `tsc` runs cleanly) but runtime explodes.

**Prevention:**
Before deleting any file in `src/lib/adapters/`:
1. Run `grep -r "from.*adapters" src/ --include="*.ts"` to enumerate all import sites.
2. For each import site, identify which exported symbols are live vs dead.
3. Migrate live functionality (`testEnvironment` logic, `process-manager.ts`, `process-utils.ts`, `preview-process-manager.ts`) to new homes before deleting the source.
4. Delete the registry last, after the test route has been rewritten to call `testEnvironment` directly.
5. Run `tsc --noEmit` after each deletion step, not just at the end.

**Detection:**
- POST `/api/adapters/test` returns 500 with "Unknown adapter type" or module-not-found.
- Settings > AI Tools tab shows permanent spinner or error state.
- `tsc --noEmit` reports "Cannot find module '@/lib/adapters/registry'".

**Phase:** Adapter cleanup phase (first phase of v0.9). Complete migration of live symbols before any deletion.

---

### Pitfall 2: PTY Idle Detection False Positives During AI Thinking

**What goes wrong:**
Claude Code emits no terminal output during long reasoning / "thinking" phases. A naive idle timer that measures "time since last PTY data event" will fire during normal AI operation and incorrectly classify the session as idle. This causes premature timeout callbacks, spurious Feishu notifications ("task complete" when the task is still running), or unwanted session kills.

The current `PtySession` has no idle timer — it only has `disconnectTimer` (for WebSocket keepalive). When v0.9 adds a "PTY idle callback" feature, the timer will be wired to `_pty.onData`. The problem is that Claude Code's thinking phase can last 30–120 seconds of zero output before resuming. A 30-second idle threshold, which sounds reasonable, fires during every non-trivial AI reasoning step.

**Why it happens:**
Claude's `--output-format stream-json` mode emits structured JSON events. During extended thinking the process is CPU/network-bound but emits no partial output — output appears as a burst when the response is ready. A timer measuring data-silence cannot distinguish "Claude is thinking" from "Claude has exited".

**Consequences:**
- Feishu notification fires mid-task ("task complete") when Claude is just thinking.
- `notify-agi.sh` is triggered with partial output, writing a misleading `latest.json` and `pending-wake.json`.
- If the idle callback kills the PTY, the task is aborted mid-reasoning.
- If the idle callback triggers session cleanup, the WebSocket keepalive is cancelled and the browser terminal disconnects.

**Prevention:**
1. Set idle threshold to no less than 180 seconds (3 minutes). Claude's thinking rarely exceeds 2 minutes of silence.
2. Idle detection must check `session.killed` before acting — if the process is already dead, the exit handler already fired. Firing the idle callback on a dead-but-not-yet-cleaned session causes duplicate notifications.
3. Implement two-phase idle detection: "suspected idle" at T=180s → verify by checking whether the PTY child process PID is still alive (`process.kill(pid, 0)`) before acting.
4. The idle callback signature should carry a `reason: 'suspected_idle' | 'process_exit'` discriminant so callers can decide whether to notify or just log.
5. Expose `resetIdleTimer()` on `PtySession` so `ws-server.ts` can call it on every incoming WebSocket message (user keystrokes reset the timer).

**Detection:**
- Feishu notification arrives while the terminal is still showing Claude's progress.
- `hook.log` shows multiple "Hook fired" entries for the same session within seconds.
- Terminal session disappears from the browser mid-task.

**Phase:** PTY idle detection phase. Design the API contract (callback signature, reset mechanism) before implementation.

---

### Pitfall 3: MCP Process Cannot Access In-Memory PTY Sessions

**What goes wrong:**
The MCP server runs as a separate stdio process (`npx tsx src/mcp/index.ts`). It has its own Node.js runtime with its own memory space. The PTY session store (`src/lib/pty/session-store.ts`) uses `globalThis.__ptySessions` — a singleton that only exists within the Next.js server process (port 3000 / instrumentation). The MCP process has a completely different `globalThis`.

When `get_task_terminal_output` and `send_task_terminal_input` MCP tools try to read/write PTY sessions, they will get `undefined` for every session lookup because the `__ptySessions` Map in the MCP process is always empty.

**Why it happens:**
The comment in `session-store.ts` explicitly documents this pattern:
> "D-04: globalThis singleton — survives HMR/module re-evaluation in Next.js dev mode. Without this, ws-server.ts (loaded once via instrumentation) and agent-actions.ts (re-bundled on HMR) would get different Map instances."

This globalThis trick solves HMR within one process. It does nothing across process boundaries. The MCP server is a different process. When the MCP server imports `session-store.ts`, TypeScript resolves the file path and a new, empty `__ptySessions` Map is initialized for the MCP process's `globalThis`.

**Consequences:**
- `get_task_terminal_output` always returns empty string or "session not found".
- `send_task_terminal_input` silently discards input (no PTY to write to).
- No error is thrown — the Map lookup returns `undefined`, which is a valid "not found" result. The MCP tool returns success with empty content.

**Prevention:**
The only correct solution is inter-process communication. Two viable approaches:

**Option A — HTTP API (recommended):** Add new Next.js API routes:
- `GET /api/tasks/[taskId]/terminal/output` — reads the ring buffer from the in-process session store.
- `POST /api/tasks/[taskId]/terminal/input` — writes to the PTY via the in-process session store.

The MCP tools call these routes via `fetch('http://localhost:3000/api/...')`. The Next.js server owns the PTY sessions and exposes them through HTTP. This keeps the PTY session store as the single source of truth.

**Option B — Shared file buffer:** Write PTY output to a temp file (append-only) in addition to the in-memory ring buffer. The MCP process reads the file. This is one-way only (output, not input) and adds I/O overhead.

Option A is strongly preferred. The existing WebSocket server already validates via `localhost:3000` origin checks, establishing the localhost-API pattern.

**Configuration note for the MCP tools:** The tools must know the base URL (`http://localhost:3000`). Hard-code as a constant for now; make configurable via env var `AI_MANAGER_BASE_URL` as a future improvement.

**Detection:**
- `get_task_terminal_output` MCP tool always returns `""` or `null` even for a running task.
- Adding a `console.error` to `getSession()` in the MCP process shows the Map is always empty.
- The MCP tool test in Claude Code shows "session not found" for a task that has an active terminal in the browser.

**Phase:** MCP terminal tools phase. Design the HTTP API bridge first, before writing any MCP tool code. Mock the HTTP API endpoints before wiring the MCP tools to them.

---

## Moderate Pitfalls

### Pitfall 4: Environment Variable Leakage Between Concurrent PTY Sessions

**What goes wrong:**
`PtySession` constructor (line 31–39 of `pty-session.ts`) explicitly whitelists the env vars passed to the PTY child:

```typescript
env: {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  SHELL: process.env.SHELL ?? "/bin/zsh",
  TERM: "xterm-color",
  LANG: process.env.LANG ?? "en_US.UTF-8",
  USER: process.env.USER ?? "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
},
```

This is safer than `{ ...process.env }` but creates a specific risk for v0.9: if CLI Profile configuration adds task-specific env vars (e.g., `CLAUDE_PROFILE`, `CLAUDE_SKIP_PERMISSIONS`, per-task API keys), and those vars are passed by merging into the PTY env object, concurrent sessions will see each other's vars if the merge is done at the `process.env` level rather than per-session.

The risk materializes if the implementation reads profile env vars into `process.env` (e.g., `process.env.CLAUDE_PROFILE = profile.name`) before spawning the PTY, rather than passing them directly in the `env` object to `pty.spawn()`. Since `process.env` is global to the Node.js process, all concurrent PTY spawns share it.

**Why it happens:**
Node.js `process.env` is a global mutable object. Any code that writes `process.env.X = value` affects all subsequent reads of `process.env.X` in the same process, including other concurrent request handlers. With multiple tasks running simultaneously, a profile-A env set for task-1 can leak into task-2's PTY spawn if the spawn is slightly delayed.

**Prevention:**
- Never write to `process.env` to pass per-session configuration.
- Pass CLI Profile env vars directly in the `env` argument to `pty.spawn()` (inside the `PtySession` constructor).
- The `PtySession` constructor should accept an optional `extraEnv: Record<string, string>` parameter that is merged into the whitelist object at spawn time.
- If CLI Profile config is read from the database, fetch it before constructing `PtySession`, then pass the result as `extraEnv`.

**Detection:**
- Task-1 (using profile A with `CLAUDE_PROFILE=fast`) causes task-2 (no profile) to also use `fast` mode.
- Race condition: only reproducible when two tasks start within milliseconds of each other.
- Unit test: spawn two PTY sessions with different `extraEnv`, verify env isolation via a shell command that prints env vars.

**Phase:** CLI Profile + PTY session phases. Add `extraEnv` to `PtySession` constructor signature when introducing CLI Profile support.

---

### Pitfall 5: notify-agi.sh Fires for Both Manual and Automated Sessions

**What goes wrong:**
`notify-agi.sh` is a Claude Code Stop hook that fires whenever any Claude session ends — including interactive sessions the user starts manually from the terminal, not just sessions dispatched by ai-manager. If v0.9 adds Feishu notifications to the hook for "龙虾 (Paperclip) dispatched sessions", but the hook lacks a reliable way to distinguish "ai-manager dispatched" from "user's own manual session", every manual Claude Code invocation generates a Feishu notification. This is notification spam.

Currently, the hook reads `task-meta.json` to get `task_name` and `telegram_group`. If the file doesn't exist, `TASK_NAME` defaults to `"unknown"` and `TELEGRAM_GROUP` is empty — so the Feishu send is skipped. This implicit "no meta file = no notification" guard works today.

The risk emerges in v0.9 if:
1. The dispatch script writes `task-meta.json` but a previous manual session's stale file is not cleaned up.
2. The meta file path is shared globally (it is: `${RESULT_DIR}/task-meta.json` is a single file, not per-session).
3. A new dispatch writes `task-meta.json`, the AI session runs, the hook fires and notifies — but then the file persists. The next manual session triggers the hook with the stale meta, sending a spurious notification for the previous task.

**Why it happens:**
The lock file mechanism (`hook-lock`) uses a 30-second window to deduplicate events within the same session. But it does not prevent different sessions from reusing stale `task-meta.json`. The meta file is written once by the dispatch script and never deleted. `hook.log` shows this risk: the file is only written, never cleaned up on success.

**Prevention:**
1. The dispatch script must write `task-meta.json` with a `session_id` field matching the Claude session that was started.
2. The hook must verify `session_id` in `task-meta.json` matches the `SESSION_ID` from stdin before sending.
3. After sending the notification, the hook must either delete `task-meta.json` or write a `processed: true` marker.
4. Add an `ai_manager_dispatched: true` boolean field to `task-meta.json`. The hook checks this field; if absent or false, skip Feishu send. Manual sessions never write `task-meta.json`, so the file won't exist for them.
5. Per-session meta files (e.g., `task-meta-${SESSION_ID}.json`) are safer than a single shared file, but require the dispatch script to know the Claude session ID before it starts — which is only available after Claude exits. Use a temp path with `session_id` verification instead.

**Detection:**
- Feishu notification arrives for a manual `claude` session that was not dispatched by ai-manager.
- `hook.log` shows `TASK_NAME=some-previous-task` for a session that should have no task.
- Two back-to-back dispatched tasks send notifications for each other (second uses first's meta).

**Phase:** Feishu notification integration phase. Update `notify-agi.sh` template and dispatch script atomically — they must agree on the session identification protocol.

---

## Minor Pitfalls

### Pitfall 6: listAdapters in execute/route.ts Is an Unused Import

**What goes wrong:**
`src/app/api/tasks/[taskId]/execute/route.ts` imports `listAdapters` from the registry but never calls it in the route body. This import exists from an earlier version of the route. When the registry is deleted, this breaks the build even though the import serves no runtime purpose.

**Prevention:**
Remove the `listAdapters` import from `execute/route.ts` as part of the adapter cleanup phase before deleting `registry.ts`. Run `tsc --noEmit` to confirm.

**Phase:** Adapter cleanup phase (day 1).

---

### Pitfall 7: preview-process-manager.ts Uses Module-Level Singleton, Not globalThis

**What goes wrong:**
`preview-process-manager.ts` uses a plain `const previewProcesses = new Map<string, ChildProcess>()` at module scope. Unlike `session-store.ts`, it does not use the `globalThis` singleton pattern. In Next.js dev mode with HMR, this Map is re-initialized on every hot reload, causing `isPreviewRunning()` to return false for processes that are actually still running.

This is a pre-existing bug, but v0.9's adapter cleanup phase will touch this file (it lives in `src/lib/adapters/`). If the file is moved without fixing the singleton, the bug travels to the new location.

**Prevention:**
When migrating `preview-process-manager.ts` out of the adapters directory, apply the same `globalThis` singleton pattern used by `session-store.ts`. This is a one-line fix that prevents preview processes from becoming orphaned on HMR.

**Phase:** Adapter cleanup migration phase.

---

### Pitfall 8: MCP Tool Count Ceiling

**What goes wrong:**
The project has a documented constraint of at most 30 MCP tools (currently 21). v0.9 adds `get_task_terminal_output` and `send_task_terminal_input` — bringing the total to 23. If the external dispatch features add additional tools (e.g., `dispatch_task`, `get_dispatch_status`), the ceiling will be approached.

**Prevention:**
Use the action-dispatch pattern already established for `manage_notes` and `manage_assets`: one tool with an `action` parameter rather than separate tools for each operation. For terminal interaction, `terminal_tool` with `action: 'read' | 'write'` keeps the count at 22 instead of 23.

**Phase:** MCP terminal tools phase. Decide on tool shape before implementation.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Adapter dead code removal | Breaks Settings AI verification silently | Audit all imports first; migrate `testEnvironment` before deleting registry |
| Adapter dead code removal | `listAdapters` dead import in execute/route.ts | Remove import as first step, run `tsc --noEmit` |
| Adapter migration | `preview-process-manager.ts` HMR bug travels | Apply `globalThis` singleton pattern on migration |
| CLI Profile + PTY | Per-session env vars leak via `process.env` | Add `extraEnv` to `PtySession` constructor; never mutate `process.env` |
| PTY idle detection | False positives during Claude thinking (30–120s silence) | 180s minimum threshold; two-phase verify; `resetIdleTimer()` on user input |
| MCP terminal tools | Sessions not accessible from MCP process | Build HTTP API bridge first; test with `curl` before writing MCP tool code |
| Feishu notification | Hook fires for manual and automated sessions alike | `session_id` verification + `ai_manager_dispatched` field in meta; clean up meta after send |
| External dispatch | Stale `task-meta.json` cross-contaminates notifications | Per-send cleanup or `processed` flag; never reuse meta across sessions |

---

## Sources

- Codebase: `src/lib/adapters/registry.ts`, `src/app/api/adapters/test/route.ts`, `src/app/api/tasks/[taskId]/execute/route.ts` — live import graph analysis
- Codebase: `src/lib/pty/pty-session.ts`, `src/lib/pty/session-store.ts`, `src/lib/pty/ws-server.ts` — PTY session lifecycle and globalThis singleton pattern
- Codebase: `src/lib/adapters/preview-process-manager.ts` — missing globalThis pattern
- Codebase: `src/mcp/index.ts` — stdio transport confirms separate process boundary
- Shell script: `/Users/liujunping/.claude/hooks/notify-agi.sh` — hook dedup logic, meta file handling, Feishu send path
- Project context: `.planning/PROJECT.md` — MCP tool ceiling (≤30), v0.9 goals, architectural decisions
