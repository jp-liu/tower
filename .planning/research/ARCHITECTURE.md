# Architecture Patterns — v0.9 Integration

**Domain:** AI task management platform — adapter cleanup + external dispatch integration
**Researched:** 2026-04-10
**Confidence:** HIGH (all findings derived from direct source-code inspection of the running v0.8 codebase)

---

## Existing Architecture (v0.8 baseline)

### Execution Flow

```
User (browser)
  └── Server Action: startPtyExecution()           [agent-actions.ts]
        ├── db.taskExecution.create (RUNNING)
        ├── createWorktree (if baseBranch set)
        ├── writeFile: instructions.md (if promptId)
        └── createSession(taskId, "claude", claudeArgs, cwd, noopOnData, onExit)
              └── session-store.ts: Map<taskId, PtySession>   [globalThis.__ptySessions]
                    └── PtySession: node-pty.spawn("claude", args, { hardcoded env })

WebSocket client (xterm.js) → ws://127.0.0.1:3001?taskId=X
  └── ws-server.ts: wireSession(session, ws, taskId)
        ├── session.setDataListener(batchedSender)   [live streaming]
        ├── ws.send(session.getBuffer())              [replay on reconnect]
        └── session.setExitListener(sendSessionEnd)  [close WS on PTY exit]

PTY onExit callback (closure in agent-actions.ts):
  ├── db.taskExecution.update(COMPLETED/FAILED)
  ├── captureExecutionSummary()                      [git log, stats, terminal log]
  └── db.task.update(IN_REVIEW)                      [if exit 0]
```

### MCP Process Boundary

```
MCP process (stdio, separate Node.js)
  └── src/mcp/index.ts
        ├── PrismaClient (own instance, WAL mode)
        └── tool handlers: direct DB reads/writes only

Next.js process
  ├── globalThis.__ptySessions  (Map<taskId, PtySession>)
  ├── globalThis.__wss          (WebSocketServer on :3001)
  └── Server Actions + ws-server share the same globalThis
```

**Critical constraint:** MCP process has NO access to `globalThis.__ptySessions`. The session Map lives exclusively in the Next.js process. Any MCP tool that needs live PTY data must cross this process boundary via HTTP — there is no shared memory or IPC channel.

### Current Env Injection (hardcoded in PtySession constructor)

```typescript
// pty-session.ts line 32-39
env: {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  SHELL: process.env.SHELL ?? "/bin/zsh",
  TERM: "xterm-color",
  LANG: process.env.LANG ?? "en_US.UTF-8",
  USER: process.env.USER ?? "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
}
```

The env is captured at `PtySession` construction time. Any additional env vars must be passed to the constructor before `node-pty.spawn()` is called — they cannot be injected after spawning.

### Current CLI Args (hardcoded in agent-actions.ts)

```typescript
// agent-actions.ts line ~304
const claudeArgs: string[] = ["--dangerously-skip-permissions"];
if (instructionsFile) claudeArgs.push("--system-prompt", instructionsFile);
claudeArgs.push(fullPrompt);
createSession(taskId, "claude", claudeArgs, cwd, () => {}, onExitFn);
```

Both the command (`"claude"`) and base flags (`["--dangerously-skip-permissions"]`) are hardcoded strings. There is no indirection layer.

### Adapter Dead Code

`src/lib/adapters/` contains two distinct concerns — one live, one dead:

| File | Status | Reason |
|------|--------|--------|
| `claude-local/execute.ts` | Dead | SSE streaming path; PTY execution no longer uses it |
| `claude-local/parse.ts` | Dead | stream-json parsing; only used by execute.ts and test.ts |
| `claude-local/test.ts` | **Live** | `testEnvironment()` used by Settings > AI Tools verification |
| `claude-local/index.ts` | **Live** | Re-exports testEnvironment |
| `types.ts` | **Live** | `TestResult`, `TestCheck` interfaces used by test.ts |
| `process-utils.ts` | **Live** | `runChildProcess`, `ensureCommandResolvable` used by test.ts |
| `registry.ts` | Likely dead | Verify callers before deleting |
| `process-manager.ts` | Likely dead | Verify callers before deleting |
| `preview-process-manager.ts` | **Live** | Manages preview child processes (workbench preview panel) |

---

## Integration Points for v0.9 New Features

### 1. CLI Profile — Position in Execution Flow

**What it is:** A `CliProfile` DB table that replaces the hardcoded `"claude"` command and `["--dangerously-skip-permissions"]` base flags. Supports future switching to different CLI binaries or flag combinations.

**Where it integrates:** `startPtyExecution()` in `agent-actions.ts`, between step 6 (worktree creation) and step 9 (createSession call). Specifically, step 8 which currently hardcodes the args.

**Current hardcode → new indirection:**

```
Before:
  createSession(taskId, "claude", ["--dangerously-skip-permissions", ...promptArgs], cwd, ...)

After:
  profile = await loadDefaultCliProfile()   // DB read
  buildArgs = [...JSON.parse(profile.baseArgs), ...promptArgs]
  createSession(taskId, profile.command, buildArgs, cwd, ...)
```

**Schema addition:**

```prisma
model CliProfile {
  id        String   @id @default(cuid())
  name      String
  command   String   @default("claude")
  baseArgs  String   @default("[\"--dangerously-skip-permissions\"]")
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

`baseArgs` is stored as a JSON string because SQLite has no array type — consistent with the existing `settings` field on `AgentConfig`. A default row must be seeded in the migration so `loadDefaultCliProfile()` never returns null.

The profile stores only fixed base flags — not the prompt text, not `--system-prompt` (those are always appended at call time). The profile controls what varies across CLI modes (binary path, auth method flags, model selection flags).

**`resumePtyExecution` also contains hardcoded `"claude"` and must be updated in the same pass.**

**No changes to `PtySession`, `session-store`, or `ws-server`.** The profile abstraction is confined to `agent-actions.ts` and the new server actions for profile CRUD.

---

### 2. PTY Idle Detection — Wiring Without Breaking WebSocket

**What it is:** A general-purpose callback that fires after N seconds of PTY silence (no output). Used to trigger Feishu notifications or other automation.

**The constraint:** `PtySession` currently has one mutable `_onData` slot that `ws-server.ts` replaces on connect via `setDataListener()`. Idle detection must NOT replace or conflict with this mechanism.

**Solution: side-channel, not a replacement.**

The `_onData` handler already flows: `ring buffer update → this._onData(data)`. Insert idle timer reset between those two steps:

```typescript
// Inside the pty.onData handler — new code injected at existing callsite
this._buffer += data;
// ... trim buffer ... (existing)
this._resetIdleTimer();   // NEW — fires before dispatching to ws-server
this._onData(data);       // existing — replaced by ws-server on connect
```

New fields and methods on `PtySession`:

```typescript
private _idleTimeoutMs = 0;
private _idleTimer: ReturnType<typeof setTimeout> | null = null;
private _idleCallbacks: Array<() => void> = [];

private _resetIdleTimer(): void {
  if (this._idleTimer) clearTimeout(this._idleTimer);
  if (this._idleCallbacks.length === 0 || this._idleTimeoutMs <= 0) return;
  this._idleTimer = setTimeout(() => {
    this._idleTimer = null;
    for (const cb of this._idleCallbacks) cb();
  }, this._idleTimeoutMs);
}

setIdleTimeout(ms: number): void { this._idleTimeoutMs = ms; }
addIdleCallback(fn: () => void): void { this._idleCallbacks.push(fn); }
clearIdleCallbacks(): void { this._idleCallbacks = []; }
```

Clear the idle timer in `kill()` to prevent spurious callbacks after PTY exit.

**Registration:** After `createSession()` returns in `agent-actions.ts`, the caller sets the timeout and callback:

```typescript
const session = createSession(taskId, command, args, cwd, () => {}, onExitFn);
session.setIdleTimeout(5 * 60 * 1000);  // 5 min
session.addIdleCallback(() => triggerFeishuNotification(taskId));
```

`session-store.createSession()` does not need changes. `ws-server.ts` does not need changes.

**Why this is safe for the WebSocket path:**
- `setDataListener()` still replaces `_onData` as before
- Idle timer resets on every PTY character, regardless of whether a WebSocket is connected
- The idle timer and the WebSocket broadcaster are independent; one does not block the other

---

### 3. MCP Tools Accessing PTY Sessions (Cross-Process Boundary)

**The fundamental problem:** MCP is a separate `stdio` Node.js process. `globalThis.__ptySessions` lives only in the Next.js process. No shared memory exists between them.

**Recommended solution: internal HTTP bridge.**

Add two Next.js route handlers that the MCP process calls via `fetch`:

```
MCP: get_task_terminal_output
  └── fetch("http://127.0.0.1:3000/api/internal/pty/[taskId]/buffer")
        └── Next.js handler: getSession(taskId)?.getBuffer()

MCP: send_task_terminal_input
  └── fetch("http://127.0.0.1:3000/api/internal/pty/[taskId]/write", POST body: input)
        └── Next.js handler: getSession(taskId)?.write(input)
```

The internal routes must reject non-loopback requests (check `req.headers.host` or `x-forwarded-for`; reject if not `127.0.0.1` or `localhost`). The ws-server already does origin checks — use the same pattern.

**Why not DB polling for the read tool:** `terminalLog` in `TaskExecution` is only written at session end. It is useless for progress queries on a running session. The ring buffer in `getBuffer()` is the only source of live output.

**MCP tool schemas:**

```typescript
// get_task_terminal_output
schema: z.object({
  taskId: z.string(),
  lastNBytes: z.number().int().min(0).max(50000).optional().default(5000),
})
// Returns: { running: boolean, output: string }

// send_task_terminal_input
schema: z.object({
  taskId: z.string(),
  input: z.string().max(4096),
})
// Returns: { sent: boolean, error?: string }
```

**Security note on `send_task_terminal_input`:** Writing to PTY stdin is effectively running arbitrary shell commands. Document that this tool is for agent-to-agent automation on a localhost trust model. The HTTP handler must verify the session exists and `!session.killed` before calling `session.write()`.

**MCP tool count impact:** +2 new tools = 23 total (ceiling is 30).

---

### 4. Env Injection with node-pty Spawn

**What needs to change:** `PtySession` constructor currently closes over a hardcoded env object. To support:
- CLI Profile-specific env vars (e.g., different `ANTHROPIC_API_KEY` per profile)
- External dispatch context (`DISPATCH_SOURCE=paperclip`, `TASK_ID=xyz`) for `notify-agi.sh`

The constructor must accept an `envOverrides` parameter.

**Change: one optional parameter added to `PtySession` constructor:**

```typescript
constructor(
  taskId: string,
  command: string,
  args: string[],
  cwd: string,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void,
  envOverrides: Record<string, string> = {}   // NEW — merged last, wins over defaults
) {
  // ...
  this._pty = pty.spawn(command, args, {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      SHELL: process.env.SHELL ?? "/bin/zsh",
      TERM: "xterm-color",
      LANG: process.env.LANG ?? "en_US.UTF-8",
      USER: process.env.USER ?? "",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
      ...envOverrides,  // caller overrides win
    },
  });
```

**Propagate through `session-store.createSession()`:**

```typescript
export function createSession(
  taskId: string,
  command: string,
  args: string[],
  cwd: string,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void,
  envOverrides?: Record<string, string>   // NEW — optional, defaults to {}
): PtySession
```

**Usage in `startPtyExecution` for Paperclip dispatch context:**

```typescript
const envOverrides: Record<string, string> = {
  DISPATCH_SOURCE: isExternalDispatch ? "paperclip" : "manual",
  TASK_ID: taskId,
};
createSession(taskId, profile.command, buildArgs, cwd, () => {}, onExitFn, envOverrides);
```

**Backward compatibility:** All existing call sites pass no `envOverrides` parameter. The default `{}` means behavior is identical to current. No existing code breaks.

---

### 5. Feishu Notification — notify-agi.sh Integration Pattern

**Existing mechanism:** `notify-agi.sh` is invoked by the Claude CLI Stop hook defined in `~/.claude/settings.json`. This hook fires inside the Claude CLI process after Claude finishes responding. The hook's environment is the PTY process environment — so env vars set at `node-pty.spawn()` time are available to the hook.

**v0.9 pattern:** Set `DISPATCH_SOURCE` in `envOverrides` (from Section 4 above). The Stop hook reads `DISPATCH_SOURCE` and decides whether to send a Feishu notification. No changes needed to `agent-actions.ts` beyond the env injection.

This means:
- No Feishu logic enters the Next.js codebase
- Notification logic stays in `notify-agi.sh` (shell, not TypeScript)
- env injection via `envOverrides` is the only code change needed on the Node side

---

## Component Map: New vs Modified

| Component | Status | Change |
|-----------|--------|--------|
| `prisma/schema.prisma` | **Modified** | Add `CliProfile` model with default row seed |
| `src/lib/pty/pty-session.ts` | **Modified** | Add `envOverrides` param; add idle detection fields + 3 methods |
| `src/lib/pty/session-store.ts` | **Modified** | Forward `envOverrides` optional param to `PtySession` |
| `src/actions/agent-actions.ts` | **Modified** | Load CLI Profile; use profile command+args; pass `envOverrides`; update `resumePtyExecution` |
| `src/lib/adapters/claude-local/execute.ts` | **Deleted** | Dead code — SSE streaming path |
| `src/lib/adapters/claude-local/parse.ts` | **Deleted** | Dead code — stream-json parsing |
| `src/lib/adapters/registry.ts` | **Deleted** (verify) | Verify no callers before deleting |
| `src/lib/adapters/process-manager.ts` | **Deleted** (verify) | Verify no callers before deleting |
| `src/app/api/internal/pty/[taskId]/buffer/route.ts` | **New** | GET: return ring buffer for MCP |
| `src/app/api/internal/pty/[taskId]/write/route.ts` | **New** | POST: write to PTY stdin for MCP |
| `src/mcp/tools/terminal-tools.ts` | **New** | `get_task_terminal_output`, `send_task_terminal_input` |
| `src/mcp/server.ts` | **Modified** | Import and register `terminalTools` |
| Settings UI — CLI Profile CRUD | **New** | Create/edit/delete profiles; mark default |

**Unchanged:** `src/lib/pty/ws-server.ts`, `src/mcp/db.ts`, all existing MCP tools.

---

## Suggested Build Order

Dependencies flow: schema → PTY changes → action changes → internal HTTP → MCP tools. Each phase below is a fully releasable increment.

### Phase 1: Adapter Cleanup (no dependencies)

Delete dead code from `src/lib/adapters/`:
- Remove `execute.ts`, `parse.ts`
- Audit and remove `registry.ts`, `process-manager.ts` if no callers
- Keep: `types.ts`, `process-utils.ts`, `claude-local/test.ts`, `preview-process-manager.ts`

Run `tsc --noEmit` after deletion to confirm no broken imports. This phase has zero functional risk and reduces noise for all subsequent changes.

### Phase 2: Schema — CliProfile table

Add `CliProfile` model to `schema.prisma`. Write a Prisma migration that also inserts the default row:

```sql
INSERT INTO "CliProfile" (id, name, command, "baseArgs", "isDefault", "createdAt", "updatedAt")
VALUES (lower(hex(randomblob(9))), 'Default', 'claude',
        '["--dangerously-skip-permissions"]', 1,
        datetime('now'), datetime('now'));
```

Regenerate Prisma client. No application code changes yet.

### Phase 3: PTY Primitives — envOverrides + idle detection

Modify `pty-session.ts`: add `envOverrides` param, add `_resetIdleTimer` and public idle API. Modify `session-store.ts`: forward `envOverrides` param. All additive — no behavior change for existing call sites.

**Depends on:** nothing (pure addition)

### Phase 4: Agent Actions — CLI Profile loading

Modify `startPtyExecution` and `resumePtyExecution` in `agent-actions.ts`:
1. Call `loadDefaultCliProfile()` from DB
2. Build command and args from profile
3. Pass `envOverrides` to `createSession`

Add `getDefaultCliProfile()`, `createCliProfile()`, `updateCliProfile()`, `deleteCliProfile()` server actions for the Settings UI.

**Depends on:** Phase 2 (schema), Phase 3 (session-store signature)

### Phase 5: Internal HTTP API for PTY access

Add Next.js route handlers at:
- `GET /api/internal/pty/[taskId]/buffer` — returns `{ running, output }` JSON
- `POST /api/internal/pty/[taskId]/write` — body `{ input: string }`, returns `{ sent }`

Both handlers validate loopback origin, resolve session from `globalThis.__ptySessions`.

**Depends on:** Phase 3 (PtySession has getBuffer and write)

### Phase 6: MCP Terminal Tools

Add `src/mcp/tools/terminal-tools.ts` implementing `get_task_terminal_output` and `send_task_terminal_input`. Both call the internal HTTP endpoints via `fetch("http://127.0.0.1:3000/api/internal/pty/...")`.

Register in `src/mcp/server.ts`.

**Depends on:** Phase 5 (HTTP endpoints must exist and be testable independently)

### Phase 7: Settings UI — CLI Profile CRUD

Add a CLI Profile section to Settings. Uses server actions from Phase 4. Allows users to name profiles, edit `command` and `baseArgs`, and set the default.

**Depends on:** Phase 2 (schema), Phase 4 (server actions)

### Phase 8: Feishu Notification Wiring

Refine `notify-agi.sh` templates. Verify `DISPATCH_SOURCE` env var (injected in Phase 4) reaches the Stop hook. Test end-to-end with a Paperclip-dispatched task.

**Depends on:** Phase 4 (env injection must land first)

---

## Full v0.9 Data Flow (Target)

```
External agent (Paperclip/OpenClaw)
  └── MCP: create_task → DB                          [existing]
  └── MCP: move_task (→ IN_PROGRESS) OR
      HTTP trigger → startPtyExecution()
            └── loadDefaultCliProfile()              [DB: CliProfile]
            └── createSession(profile.command,
                              profile.baseArgs + promptArgs,
                              cwd,
                              { DISPATCH_SOURCE: "paperclip", TASK_ID: taskId })
                  └── PtySession: node-pty.spawn
                        ├── idle timer (side-channel)
                        └── _onData → ws-server batchedSender

External agent (polling progress)
  └── MCP: get_task_terminal_output
        └── fetch http://127.0.0.1:3000/api/internal/pty/[taskId]/buffer
              └── getSession(taskId)?.getBuffer()

External agent (sending instructions)
  └── MCP: send_task_terminal_input
        └── fetch http://127.0.0.1:3000/api/internal/pty/[taskId]/write
              └── getSession(taskId)?.write(input)

PTY exits
  └── onExit closure in agent-actions.ts:
        ├── db.taskExecution.update (COMPLETED/FAILED)
        ├── captureExecutionSummary()
        ├── db.task.update (IN_REVIEW if exit 0)
        └── Stop hook fires in Claude CLI env:
              └── notify-agi.sh checks DISPATCH_SOURCE → Feishu if "paperclip"

Idle detection (if PTY silent > N minutes)
  └── idleCallback in agent-actions.ts → triggerFeishuNotification()
```

---

## Key Architecture Decisions for v0.9

| Decision | Rationale |
|----------|-----------|
| HTTP bridge for MCP→PTY access | No IPC plumbing needed; localhost HTTP is zero-config; same origin model as ws-server |
| `envOverrides` as optional last param | Additive — zero existing call sites break; default `{}` is identity |
| Idle detection as side-channel in PtySession | Preserves `setDataListener` contract; ws-server requires no changes |
| `CliProfile.baseArgs` as JSON string | SQLite has no array type; consistent with `AgentConfig.settings` field |
| Seed default CliProfile row in migration | `loadDefaultCliProfile()` never returns null; no null-guard branches in hot path |
| Internal routes under `/api/internal/` | Clear namespace; loopback-only guard prevents external access |
| Feishu notification via Stop hook env, not Next.js code | Keeps notification logic in shell; Node.js side only injects env vars |
| Adapter cleanup before new feature work | Smaller diff surface; dead code removal has zero functional risk |

---

## Sources

All findings from direct source-code inspection (no web search required — confidence HIGH):

- `/Users/liujunping/project/i/ai-manager/src/lib/pty/pty-session.ts`
- `/Users/liujunping/project/i/ai-manager/src/lib/pty/session-store.ts`
- `/Users/liujunping/project/i/ai-manager/src/lib/pty/ws-server.ts`
- `/Users/liujunping/project/i/ai-manager/src/actions/agent-actions.ts`
- `/Users/liujunping/project/i/ai-manager/src/mcp/server.ts`
- `/Users/liujunping/project/i/ai-manager/src/mcp/index.ts`
- `/Users/liujunping/project/i/ai-manager/src/mcp/db.ts`
- `/Users/liujunping/project/i/ai-manager/src/mcp/tools/task-tools.ts`
- `/Users/liujunping/project/i/ai-manager/prisma/schema.prisma`
- `/Users/liujunping/project/i/ai-manager/src/lib/adapters/` (full tree)
- `/Users/liujunping/project/i/ai-manager/src/lib/execution-summary.ts`
- `/Users/liujunping/project/i/ai-manager/.planning/PROJECT.md`
