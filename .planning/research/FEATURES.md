# Feature Landscape — v0.9 架构清理 + 外部调度闭环

**Domain:** AI task execution platform — CLI adapter management, terminal monitoring, MCP terminal tools, webhook notifications
**Researched:** 2026-04-10
**Confidence:** HIGH (analysis from direct codebase inspection; all claims grounded in current code, not training data)

> Note: This file replaces the v0.7 terminal research. The prior v0.7 research is embedded in git history.

---

## Existing System (Do Not Re-implement)

These are fully functional in v0.8. v0.9 builds on top of them — treat them as stable foundations.

| Capability | Implementation | Location |
|---|---|---|
| PTY terminal spawning | `node-pty` via `PtySession` | `src/lib/pty/pty-session.ts` |
| 50 KB ring buffer | `PtySession._buffer` + `getBuffer()` | `src/lib/pty/pty-session.ts` |
| Session keyed by `taskId` | `session-store.ts` globalThis Map | `src/lib/pty/session-store.ts` |
| WebSocket streaming | `ws-server.ts` port 3001 | `src/lib/pty/ws-server.ts` |
| Execution record in DB | `TaskExecution` model, `startPtyExecution` | `src/actions/agent-actions.ts` |
| onExit callback | In `startPtyExecution` — updates DB, captures summary | `src/actions/agent-actions.ts` |
| Feishu notification | `notify-agi.sh` using `openclaw message send` | `~/.claude/hooks/notify-agi.sh` |
| CLI adapter interface | `AdapterModule` type + `claudeLocalAdapter` | `src/lib/adapters/` |
| CLI test/verification | `testEnvironment()` — 4-check suite | `src/lib/adapters/claude-local/test.ts` |
| Session resume | `--resume` flag, `resumePtyExecution` | `src/actions/agent-actions.ts` |
| Preview process manager | Spawn/stop preview server per project | `src/lib/adapters/preview-process-manager.ts` |

---

## Table Stakes

Features v0.9 must deliver. Missing any of these means the milestone is incomplete.

### 1. Adapter Dead Code Removal

**What it is:** The `AdapterModule.execute()` path — SSE streaming, `--output-format stream-json`, stdin-fed prompts — was the original execution mechanism. The PTY path replaced it in v0.7. This code is now dead: no call site in Next.js reaches `execute()` anymore.

**Scope of what to remove:**
- `src/lib/adapters/claude-local/execute.ts` — the old SSE execution logic
- `src/lib/adapters/claude-local/parse.ts` — stream-json parser, only called by execute.ts
- `src/lib/adapters/process-utils.ts` — verify no callers outside execute.ts first
- `src/lib/adapters/registry.ts` — only exports `getAdapter`/`listAdapters`; verify no callers
- The SSE stream route (if it still exists) — replaced by PTY + WebSocket

**Scope of what to keep:**
- `src/lib/adapters/claude-local/test.ts` — `testEnvironment()` is used by Settings > AI Tools CLI verification
- `src/lib/adapters/preview-process-manager.ts` — used by the preview panel (separate concern)
- `src/lib/adapters/types.ts` — `AdapterModule` interface may still be referenced; verify

**Why it matters:** Dead code creates false confidence that there is a non-PTY execution path. It also creates confusion for the CLI Profile work (what is `AgentConfig` vs the adapter vs the profile?). Removing it clarifies the architecture before adding the profile table.

**Complexity:** Low. Audit callers with grep, delete files, fix imports.

**Dependency:** None — prerequisite for the next item.

---

### 2. CLI Profile Config Table

**What it is:** A DB-backed table that stores the CLI invocation parameters: which command to run and what static flags to pass before the prompt. Today `startPtyExecution` hardcodes `command = "claude"` and `claudeArgs = ["--dangerously-skip-permissions"]` inline. A profile table lifts this to configuration.

**Why the existing `AgentConfig` model is not reused:** `AgentConfig` has `agent`, `configName`, `appendPrompt`, `settings` — designed for a different abstraction (named config sets per agent). `startPtyExecution` has zero connection to `AgentConfig`. Adding a `CliProfile` table is cleaner than retrofitting `AgentConfig`.

**Minimal schema:**
```
CliProfile {
  id          String   @id @default(cuid())
  label       String             // human display name, e.g. "Claude (default)"
  command     String             // e.g. "claude" or "/usr/local/bin/openclaw"
  buildArgs   String             // JSON array of static args, e.g. ["--dangerously-skip-permissions"]
  isDefault   Boolean @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

`buildArgs` holds static flags that precede the prompt. Dynamic flags (`--resume`, prompt content, instructions file path) are still appended at runtime in `startPtyExecution`.

**Integration point:** `startPtyExecution` reads the default `CliProfile` (or a specified profile ID) to get `command` and `buildArgs` instead of hardcoding them.

**What this is not:** Full multi-CLI support. v0.9 ships one row (Claude). The table just means adding a second CLI later requires a DB row, not a code change.

**Complexity:** Low-medium. New Prisma model + migration + one read site in `startPtyExecution`.

**Dependency:** Adapter dead code removal should land first to avoid confusion.

---

### 3. Internal HTTP Bridge for PTY Access

**What it is:** A pair of localhost-only Next.js API routes that expose the in-process PTY session state to the MCP server process.

The MCP server runs as a separate Node.js process (via `npx tsx src/mcp/index.ts`). It cannot directly import `session-store.ts` from the Next.js process — they do not share memory. The bridge solves this.

**Routes:**
```
GET  /api/internal/terminal/[taskId]/output
     → returns { output: string, bufferLength: number, sessionAlive: boolean, executionStatus: string }

POST /api/internal/terminal/[taskId]/input
     body: { input: string }
     → returns { ok: boolean, error?: string }
```

**Security:** These routes are localhost-only. Gate with a check: `if (request.headers.get('host') !== '127.0.0.1:3000') return 403`. No token auth needed — single-user local tool.

**GET implementation:** Calls `getSession(taskId)?.getBuffer()` and queries DB for current `TaskExecution` status.

**POST implementation:** Calls `getSession(taskId)?.write(input)`. Returns error if `session.killed === true`.

**Complexity:** Medium — new route files, session import in App Router context, localhost guard. But both MCP tools share this plumbing — build once, use twice.

**Dependency:** `getSession` and `getBuffer` already exist. Just needs the route wrapper.

---

### 4. MCP Tool: `get_task_terminal_output`

**What it is:** An MCP tool that Paperclip (the external dispatch agent, "龙虾") calls to read the current PTY output for a task. Allows checking execution progress without a browser terminal open.

**Schema:**
```typescript
input:  {
  taskId: string,
  tail?: number   // chars from end of buffer, default: full buffer (up to 50 KB)
}
output: {
  taskId: string,
  executionStatus: string,   // RUNNING | COMPLETED | FAILED | PENDING
  sessionAlive: boolean,
  bufferLength: number,
  output: string
}
```

**Implementation:** MCP tool calls `GET /api/internal/terminal/[taskId]/output` via `fetch`. Returns the response as the tool result.

**Current MCP tool count:** 21. After this tool: 22.

**Complexity:** Low (depends on bridge being built).

**Dependency:** Internal HTTP bridge (item 3 above).

---

### 5. MCP Tool: `send_task_terminal_input`

**What it is:** An MCP tool that writes input to a running PTY session. Paperclip uses this to inject follow-up instructions mid-execution — for example, answering a Claude confirmation prompt ("y\n"), or sending additional context.

**Schema:**
```typescript
input:  {
  taskId: string,
  input: string   // raw string to write to PTY (include \n for Enter)
}
output: {
  ok: boolean,
  error?: string
}
```

**Implementation:** MCP tool POSTs to `/api/internal/terminal/[taskId]/input`. Returns `ok: true` on success, `ok: false` with error if session is dead.

**After this tool:** 23 MCP tools. Ceiling is 30. Headroom: 7.

**Complexity:** Low (depends on bridge being built).

**Dependency:** Internal HTTP bridge (item 3 above).

---

### 6. PTY Idle Detection with Callback

**What it is:** Detection of when a running PTY session has produced no output for N consecutive seconds, with a configurable callback fired on threshold breach.

**Why it matters for v0.9:** Claude Code frequently pauses waiting for user confirmation. Without idle detection, the external agent (Paperclip) has no signal that Claude is waiting for input — it must poll `get_task_terminal_output` manually. With idle detection, ai-manager can proactively notify via Feishu: "Claude is waiting for input on task X".

**Standard pattern (used by terminal multiplexers, CI systems):**
1. Add `lastDataAt: number` field to `PtySession`, initialized to `Date.now()` on spawn.
2. In the `onData` handler, update `lastDataAt = Date.now()` on every chunk received.
3. Start a polling interval (e.g. every 5s) in the `PtySession` constructor.
4. On each interval tick: if `Date.now() - lastDataAt > idleThresholdMs` and process is still running (`!this.killed`), fire `onIdle(taskId, elapsedMs)`.
5. Track `idleFired: boolean` to avoid firing the callback on every tick after the threshold is first reached. Reset on next data event.
6. Clear the interval timer in `kill()`.

**Callback signature:** `onIdle?: (taskId: string, idleMs: number) => void` — optional parameter in `createSession`.

**Default idle threshold:** 60 seconds. Make it configurable via `SystemConfig` key `pty.idleThresholdSec`.

**What the callback does in v0.9:** Triggers a Feishu "waiting for input" notification (see item 7).

**Complexity:** Low. Entirely additive to `PtySession` — no behavioral regression.

**Dependency:** None beyond existing `PtySession`.

---

### 7. Feishu Completion Notification from onExit

**What it is:** When a task execution completes (PTY exit, exit code 0 → task transitions to IN_REVIEW), ai-manager itself triggers a Feishu notification. Currently this only happens via the Claude Code Stop Hook (`notify-agi.sh`) which fires when Claude Code's own session ends — a different event than the PTY session managed by ai-manager.

**Current gap:** The `onExit` callback in `startPtyExecution` already captures `terminalBuffer`, `exitCode`, task metadata. It does not call `notify-agi.sh`. The notification only happens via the Claude hook if Claude Code was the one doing the spawning (not the case when ai-manager's PTY manages the session).

**Implementation:**
1. In the `onExit` handler of `startPtyExecution`, after `captureExecutionSummary`, if `exitCode === 0`:
   - Check if `FEISHU_NOTIFY_GROUP` env var is set.
   - If set: call `notify-agi.sh` (or `openclaw message send` directly) with task name, branch, summary.
2. For idle detection (item 6): the `onIdle` callback also triggers Feishu with a "waiting for input" template.

**Env gate:** `FEISHU_NOTIFY_GROUP` env var. If unset, skip silently — no error.

**Notify-agi.sh refactor:** The existing script reads from flat files (`task-output.txt`, `task-meta.json`). For v0.9, it should also accept arguments/env vars directly so it can be called from the Node.js `onExit` handler without needing to write flat files first. Backward compatibility with the Claude hook path must be preserved.

**Complexity:** Low. The hook point exists, the script exists, the notification target exists.

**Dependency:** `notify-agi.sh` and `openclaw` must be present on the system. Gate on env var.

---

## Differentiators

Features that add measurable value but are not blocking for the milestone completion.

### A. Structured Feishu Message Templates

**What it is:** Named, parameterized templates for each notification event type:
- `task.completed`: task name, branch, git stats summary, terminal tail
- `task.idle`: task name, how long idle, last output line
- `task.failed`: task name, exit code, last error line

**Value:** Paperclip can parse structured messages reliably. Current ad-hoc concatenation in `notify-agi.sh` is fragile.

**Implementation:** Add a `NOTIFY_TEMPLATE` env var or event type arg to `notify-agi.sh`. Shell `case` on event type to select template.

**Complexity:** Low. Shell script editing only.

---

### B. MCP Tool: `get_task_execution_status`

**What it is:** Returns the latest `TaskExecution` record for a task — `status`, `startedAt`, `endedAt`, `branch`, `exitCode`, `worktreePath`.

**Why differentiator not table stakes:** The existing `list_tasks` MCP tool returns `task.status`. Execution-level granularity (RUNNING vs task's IN_PROGRESS) is useful for monitoring but not essential if Paperclip can already use `get_task_terminal_output`.

**Implementation:** Direct DB query in the MCP process. No bridge needed.

**After this tool:** 24 MCP tools. Headroom to ceiling: 6.

**Complexity:** Low.

---

### C. Settings UI for CLI Profile

**What it is:** A UI card in Settings > AI Tools to view and edit the CLI profile (label, command, buildArgs). Allows changing the CLI invocation without touching the DB directly.

**Why differentiator:** The profile table is table stakes. The Settings UI is a convenience — the primary user (a developer) can edit via migration seed or SQLite CLI. Ship the UI if time permits.

**Complexity:** Medium. New settings section, read/write server actions, form component.

---

### D. Idle Threshold via SystemConfig

**What it is:** Expose `pty.idleThresholdSec` as a `SystemConfig` key, readable in Settings.

**Why differentiator:** The default (60s) works for most cases. Configurability is nice but not essential.

**Complexity:** Low. One `SystemConfig` key + one settings field.

---

## Anti-Features

Do not build these in v0.9. Listed explicitly to prevent scope creep.

| Anti-Feature | Why Avoid | What Instead |
|---|---|---|
| Full multi-CLI adapter with UI switcher | Over-engineered — only Claude is used today | One-row `CliProfile` table; UI can come in v1.0 |
| Webhook push to external URL (generic) | Network egress, auth complexity, error handling cost | Direct `openclaw` CLI call from `onExit` |
| Continuous PTY output flush to DB | High write volume at ~8ms batch rate; SQLite locks | Keep ring buffer in memory; flush summary at execution end |
| Idle detection with ML heuristics | Far beyond need | Last-data-at timestamp polling, 5s interval |
| Per-task Feishu channel config in DB | One notify target in practice | `FEISHU_NOTIFY_GROUP` env var is sufficient |
| MCP WebSocket tools (live streaming output) | MCP protocol is synchronous request/response | Poll via `get_task_terminal_output` |
| Inbound Paperclip API endpoint | External auth complexity | Keep all dispatch through MCP tool calls |
| Rewriting notify-agi.sh in TypeScript | Works fine as bash; no benefit from rewrite | Refactor to accept args while keeping bash |
| Multi-target notification (Telegram, Slack) | Only Feishu is used | Single target via `openclaw`; add targets later |

---

## Feature Dependencies

```
Adapter Dead Code Removal
  └── prerequisite for: CLI Profile Table (avoid confusion with AdapterModule.execute)

CLI Profile Table (CliProfile model in Prisma)
  └── consumed by: startPtyExecution (reads command + buildArgs)
  └── optional UI: Settings > AI Tools CLI Profile card

Internal HTTP Bridge (/api/internal/terminal/)
  └── shared by: get_task_terminal_output (GET)
  └── shared by: send_task_terminal_input (POST)
  └── security: localhost-only header check

get_task_terminal_output MCP tool
  └── requires: Internal HTTP Bridge
  └── reads: session ring buffer + TaskExecution status

send_task_terminal_input MCP tool
  └── requires: Internal HTTP Bridge
  └── writes: PtySession.write(input)
  └── guard: return error if session.killed === true

PTY Idle Detection
  └── requires: PtySession.lastDataAt field (new)
  └── requires: polling interval in PtySession constructor
  └── fires: onIdle(taskId, idleMs) callback
  └── consumer: Feishu "waiting" notification

Feishu Completion Notification (from onExit)
  └── requires: FEISHU_NOTIFY_GROUP env var (gate)
  └── hook point: onExit in startPtyExecution (already exists)
  └── calls: notify-agi.sh (refactored to accept env/args)
  └── optional: Structured templates (Differentiator A)

Feishu Idle Notification
  └── requires: PTY Idle Detection (onIdle callback)
  └── calls: notify-agi.sh with event type "idle"
```

---

## Implementation Order Recommendation

Ordered by dependency, risk, and value delivery:

1. **Adapter dead code removal** — clears codebase, zero regression risk if callers audited first.
2. **CLI Profile table** — new schema, migration, wire into `startPtyExecution`.
3. **Internal HTTP bridge** — shared foundation; build once for both MCP tools.
4. **`get_task_terminal_output`** — read-only, low risk, high value for Paperclip.
5. **`send_task_terminal_input`** — write path; needs session alive guard.
6. **PTY idle detection** — additive to `PtySession`, no behavioral regression.
7. **Feishu completion notification from `onExit`** — wire + env gate.
8. **Structured Feishu templates** — polish; edit `notify-agi.sh`.

---

## Complexity + Priority Summary

| Feature | Priority | Complexity | Dependency |
|---|---|---|---|
| Adapter dead code removal | Table Stakes | Low | None |
| CLI Profile table | Table Stakes | Low-Medium | Dead code removal |
| Internal HTTP bridge | Table Stakes | Medium | None |
| `get_task_terminal_output` | Table Stakes | Low | HTTP bridge |
| `send_task_terminal_input` | Table Stakes | Low | HTTP bridge |
| PTY idle detection | Table Stakes | Low | PtySession |
| Feishu completion notification | Table Stakes | Low | onExit hook, notify-agi.sh |
| Structured Feishu templates | Differentiator | Low | notify-agi.sh |
| `get_task_execution_status` MCP tool | Differentiator | Low | DB access |
| Settings UI for CLI Profile | Differentiator | Medium | CLI Profile table |
| Idle threshold via SystemConfig | Differentiator | Low | SystemConfig |

---

## MCP Tool Count Impact

| State | Count |
|---|---|
| Current (v0.8) | 21 |
| After `get_task_terminal_output` | 22 |
| After `send_task_terminal_input` | 23 |
| After `get_task_execution_status` (Differentiator B) | 24 |
| Ceiling | 30 |
| Remaining headroom after v0.9 | 6 |

---

## Sources

- `src/lib/pty/pty-session.ts` — ring buffer, data listener, kill guard (direct inspection)
- `src/lib/pty/session-store.ts` — globalThis Map, createSession, getSession, destroySession (direct inspection)
- `src/lib/pty/ws-server.ts` — WebSocket wiring, keepalive timers (direct inspection)
- `src/actions/agent-actions.ts` — startPtyExecution, onExit callback, resumePtyExecution (direct inspection)
- `src/lib/adapters/` — all adapter files; execute.ts confirmed dead, test.ts confirmed live (direct inspection)
- `prisma/schema.prisma` — AgentConfig model mismatch confirmed, CliProfile does not yet exist (direct inspection)
- `~/.claude/hooks/notify-agi.sh` — flat-file read pattern, openclaw invocation (direct inspection)
- `.planning/PROJECT.md` — v0.9 milestone requirements, constraints, MCP ceiling (direct inspection)
- Confidence: HIGH — all claims grounded in current codebase state as of 2026-04-10
