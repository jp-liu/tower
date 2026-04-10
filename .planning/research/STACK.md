# Technology Stack

**Project:** ai-manager v0.9 — 架构清理 + 外部调度闭环
**Researched:** 2026-04-10
**Confidence:** HIGH — all claims based on direct codebase inspection and existing installed packages. No new libraries are required; all v0.9 features are implementable with what is already installed.

---

## Scope

This is a **delta research document** for the v0.9 milestone. It covers only what is new or changed relative to the validated base stack (Next.js 16, React 19, Prisma 6, SQLite, node-pty 1.1.0, ws 8.x, @modelcontextprotocol/sdk 1.28.0, zod 4.x).

The four v0.9 feature areas are:

1. CLI Profile abstraction (replacing adapter layer)
2. MCP tools for terminal interaction (get_task_terminal_output, send_task_terminal_input)
3. PTY idle/activity detection for callback triggering
4. Environment variable injection into PTY child processes

---

## Recommended Stack

### No New npm Dependencies Required

All four v0.9 features are implementable with the existing installed packages. The table below documents which existing packages serve each new capability.

| Capability | Existing Package | Version | How It Serves v0.9 |
|-----------|-----------------|---------|---------------------|
| CLI Profile DB model | `@prisma/client` | `^6.19.2` | New `CliProfile` model added to schema.prisma, generated via `prisma db push` |
| CLI Profile CRUD API | Next.js `Server Actions` | 16.2.1 | Server actions pattern already used everywhere, no library change |
| CLI argument assembly | Node.js built-ins | — | `buildArgs` logic moves from `execute.ts` into a pure function that reads from `CliProfile` record |
| CLI environment validation | Existing `process-utils.ts` (`ensureCommandResolvable`, `runChildProcess`) | — | `testEnvironment()` from `claude-local/test.ts` is preserved as-is, just called via a direct import instead of through the adapter registry |
| MCP terminal tools — live buffer | `ws` (HTTP call to Next.js internal API) | `^8.20.0` | MCP process is isolated from Next.js in-memory state; live buffer must be fetched via HTTP to `127.0.0.1:3000/api/internal/terminal/[taskId]/buffer` (new route, no new library) |
| MCP terminal tools — send input | Same HTTP approach | — | POST to `127.0.0.1:3000/api/internal/terminal/[taskId]/input` which calls `session.write()` |
| MCP terminal tools — completed log | `@prisma/client` | — | For completed/exited sessions, `TaskExecution.terminalLog` is already persisted to SQLite; MCP reads directly from DB |
| PTY idle detection | `node-pty` + Node.js `setTimeout` | `^1.1.0` | Pure TypeScript addition to `pty-session.ts` — a `lastActivityAt` timestamp updated on every `onData` event, with a polling `setTimeout` that fires the idle callback |
| Env var injection | `node-pty` (`pty.spawn` env option) | `^1.1.0` | `PtySession` constructor already accepts env via the `env` object passed to `pty.spawn`; extend the env object with profile-specific variables |
| Feishu notification | Shell exec of `notify-agi.sh` (existing hook script) | — | The Stop hook already calls `notify-agi.sh` via Claude's hook mechanism; for programmatic dispatch from PTY idle callback, use `child_process.execFile` to call `notify-agi.sh` — no new library |
| Input validation for new routes/tools | `zod` | `^4.3.6` | Already installed and used throughout |

---

## New Prisma Model: CliProfile

Add to `prisma/schema.prisma`. No new library required — generates via the existing `prisma db push` workflow.

```prisma
model CliProfile {
  id          String   @id @default(cuid())
  name        String   @unique      // e.g. "claude-code-default"
  command     String                // e.g. "claude"
  buildArgs   String                // JSON array stored as string — e.g. ["--print","-","--output-format","stream-json"]
  envVars     String?               // JSON object stored as string — e.g. {"CLAUDE_SKIP_PERMISSIONS":"true"}
  isDefault   Boolean  @default(false)
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**Why `buildArgs` as JSON string, not a relational table:** SQLite is already used for all config. A JSON-encoded string in a TEXT column (`String`) is consistent with how `AgentConfig.settings` is stored today. Avoids a new relational table for what is essentially a config blob. Parsed via `JSON.parse()` at read time.

---

## MCP Terminal Tools: IPC Architecture

### The Problem

The MCP server runs as a separate `tsx` process (`npx tsx src/mcp/index.ts`). It has its own Node.js runtime. The in-memory `globalThis.__ptySessions` Map lives exclusively in the Next.js server process. There is no shared memory between them.

### The Solution: Internal HTTP Bridge (no new library)

Add two internal API routes to the Next.js app:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/internal/terminal/[taskId]/buffer` | GET | Returns `session.getBuffer()` for live sessions; falls back to `TaskExecution.terminalLog` from DB for completed sessions |
| `/api/internal/terminal/[taskId]/input` | POST | Calls `session.write(data)` for live sessions; returns 409 if session is not running |

These routes are bound to `127.0.0.1:3000` (localhost only — same security boundary as the rest of the app). The MCP tool handlers call these routes using Node.js `fetch()` (built-in since Node 18).

**Why HTTP over alternative IPC methods:**

| Alternative | Why Rejected |
|-------------|-------------|
| Unix socket / named pipe | More complex setup; would require coordinating a socket path between two processes; HTTP already exists at `127.0.0.1:3000` |
| Shared SQLite table for live buffer | SQLite writes from Next.js to a "buffer" table on every PTY data event would be extremely high frequency and degrade performance; the ring buffer is designed for in-memory use |
| Redis / external cache | Out of scope — no external infrastructure dependency; the app is localhost-only |
| Making MCP a Next.js route (not separate process) | Project decision from v0.2: "MCP server as separate process — Avoid coupling with Next.js lifecycle" — this decision is validated and should not be reversed |

**Implementation in MCP tool handlers:**

```typescript
// src/mcp/tools/terminal-tools.ts
import { z } from "zod";

const BASE = "http://127.0.0.1:3000";

export const terminalTools = {
  get_task_terminal_output: {
    description: "Get the current terminal output buffer for a running task, or the stored terminal log for a completed task.",
    schema: z.object({ taskId: z.string() }),
    handler: async ({ taskId }: { taskId: string }) => {
      const res = await fetch(`${BASE}/api/internal/terminal/${taskId}/buffer`);
      if (!res.ok) throw new Error(`Failed to get terminal output: ${res.status}`);
      return res.json();
    },
  },
  send_task_terminal_input: {
    description: "Send keyboard input to a running task's terminal. Use for answering prompts or sending commands.",
    schema: z.object({ taskId: z.string(), input: z.string() }),
    handler: async ({ taskId, input }: { taskId: string; input: string }) => {
      const res = await fetch(`${BASE}/api/internal/terminal/${taskId}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      if (!res.ok) throw new Error(`Failed to send input: ${res.status}`);
      return res.json();
    },
  },
};
```

Node.js `fetch()` is available natively since Node 18 (project constraint: Node.js 18.18+). No `node-fetch` or `axios` needed.

---

## PTY Idle Detection: Implementation Pattern

Pure TypeScript addition to `pty-session.ts`. No new library.

**Mechanism:** Track `lastActivityAt: number` (epoch ms) updated on every `onData` event. A periodic `setTimeout` chain checks whether `Date.now() - lastActivityAt >= idleThresholdMs`. When the threshold is crossed, fire the registered idle callback once and reset (or stop, depending on use case).

```typescript
// Addition to PtySession class
private _lastActivityAt = Date.now();
private _idleCallback: (() => void) | null = null;
private _idleThresholdMs = 0;
private _idleTimer: ReturnType<typeof setTimeout> | null = null;

setIdleCallback(thresholdMs: number, fn: () => void): void {
  this._idleThresholdMs = thresholdMs;
  this._idleCallback = fn;
  this._scheduleIdleCheck();
}

clearIdleCallback(): void {
  this._idleCallback = null;
  if (this._idleTimer) {
    clearTimeout(this._idleTimer);
    this._idleTimer = null;
  }
}

private _scheduleIdleCheck(): void {
  if (!this._idleCallback || this.killed) return;
  const checkInterval = Math.min(this._idleThresholdMs, 5_000); // check at most every 5s
  this._idleTimer = setTimeout(() => {
    this._idleTimer = null;
    if (!this._idleCallback || this.killed) return;
    if (Date.now() - this._lastActivityAt >= this._idleThresholdMs) {
      this._idleCallback(); // fire once
    } else {
      this._scheduleIdleCheck(); // reschedule
    }
  }, checkInterval);
}
```

`_lastActivityAt` is updated inside the existing `this._pty.onData(...)` handler — a one-line addition.

**Cleanup:** `clearIdleCallback()` must be called in `kill()` to prevent timer leak after session destruction.

---

## Environment Variable Injection

The `PtySession` constructor already passes an `env` object to `pty.spawn`. The only change needed is to make the caller (`startPtyExecution` in `agent-actions.ts`) pass additional env vars sourced from the `CliProfile.envVars` JSON field.

```typescript
// In startPtyExecution — parse CliProfile.envVars and merge
const profileEnv: Record<string, string> = profile.envVars
  ? JSON.parse(profile.envVars)
  : {};

createSession(taskId, command, args, cwd, onData, onExit, {
  ...baseEnv,
  ...profileEnv,  // Profile env vars override base env
});
```

The `PtySession` constructor's existing `env` block already includes `ANTHROPIC_API_KEY`, `PATH`, `HOME`, `SHELL`, `TERM`, `LANG`, `USER`. Profile env vars are merged on top, so a profile can override any of these or add new ones (e.g., `CLAUDE_SKIP_PERMISSIONS`, custom model env vars).

**No new library required.** The merge is plain object spread.

---

## Adapter Cleanup: What to Delete vs Preserve

### Delete (dead code after v0.9)

| File/Module | Reason |
|-------------|--------|
| `src/lib/adapters/registry.ts` | Adapter pattern replaced by CliProfile DB model |
| `src/lib/adapters/types.ts` | `AdapterModule`, `ExecutionContext`, `ExecutionResult` interfaces replaced by CliProfile-driven execution |
| `src/lib/adapters/claude-local/index.ts` | Adapter wrapper, no longer needed |
| `src/lib/adapters/claude-local/execute.ts` | PTY-based execution makes `runChildProcess`-based execute obsolete |
| `src/lib/adapters/process-manager.ts` | `executionToRunId` map and `killProcess` function are for the old SSE/child_process execution; PTY sessions have their own lifecycle in `session-store.ts` |

### Preserve and Relocate

| File/Module | What to Keep | Where |
|-------------|-------------|-------|
| `src/lib/adapters/claude-local/test.ts` | `testEnvironment()` — CLI verification with 4 checks | Move to `src/lib/cli-verify.ts` (standalone, no adapter dependency) |
| `src/lib/adapters/process-utils.ts` | `runChildProcess`, `ensureCommandResolvable`, `runningProcesses` | Move to `src/lib/process-utils.ts` (used by `cli-verify.ts` and `preview-actions.ts`) |
| `src/lib/adapters/preview-process-manager.ts` | Preview process lifecycle management | Move to `src/lib/preview-process-manager.ts` |
| `src/lib/adapters/claude-local/parse.ts` | Stream JSON parsing, login detection, failure description | Move to `src/lib/claude-stream-parse.ts` (still needed by `cli-verify.ts`) |

### Update Call Sites

| Current Import | Updated Import |
|---------------|----------------|
| `import { getAdapter } from "@/lib/adapters/registry"` | Remove (replaced by CliProfile lookup from DB) |
| `import { canStartExecution } from "@/lib/adapters/process-manager"` | Replace with PTY session count check from `session-store.ts` |
| `import { testEnvironment } from "..."` via adapter | Import directly from `@/lib/cli-verify` |

---

## Feishu Notification: No New Library

The existing `notify-agi.sh` hook script (called via Claude Code's Stop hook mechanism) handles Feishu notifications via `openclaw` CLI. For the new PTY idle callback triggering a notification (e.g., "task is waiting for your input"), call the script programmatically from the idle callback:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function notifyFeishu(taskTitle: string, message: string) {
  // notify-agi.sh path: locate via env var or well-known path
  const scriptPath = process.env.NOTIFY_AGI_SCRIPT ?? `${process.env.HOME}/.claude/notify-agi.sh`;
  await execFileAsync("bash", [scriptPath, taskTitle, message], {
    timeout: 10_000,
  });
}
```

`execFile` / `promisify` are Node.js built-ins. No new library.

---

## Summary: No New npm Installs Required

| Feature | Implementation Approach | New Library? |
|---------|------------------------|--------------|
| CLI Profile abstraction | New Prisma model + server actions | No — Prisma already installed |
| MCP terminal tools | Internal HTTP API routes + `fetch()` | No — native Node.js fetch |
| PTY idle detection | `setTimeout` polling in `pty-session.ts` | No — pure TypeScript |
| Env var injection | Object spread in `startPtyExecution` | No |
| Feishu notification from idle | `child_process.execFile` to `notify-agi.sh` | No — Node.js built-in |

All v0.9 work is pure TypeScript logic, schema changes, and code reorganization. No `pnpm add` commands are needed.

---

## MCP Tool Count Check

Current: 21 tools. v0.9 adds 2 terminal tools (`get_task_terminal_output`, `send_task_terminal_input`). New total: 23. Ceiling is 30. No concern.

---

## What NOT to Add

| Avoid | Why |
|-------|-----|
| `node-fetch` or `axios` for MCP→Next.js HTTP | Node.js 18+ has native `fetch()` — no library needed |
| Redis or any external cache for live PTY buffer | App is localhost-only, single-user; HTTP bridge to Next.js is sufficient |
| A new `IPC` library (e.g., `electron-ipc`, `worker_threads`) | HTTP is the existing boundary between MCP process and Next.js; introducing a new IPC mechanism adds complexity for zero benefit |
| Reverting MCP to in-process (Next.js route) | Validated architectural decision from v0.2 — separation avoids Next.js lifecycle coupling |
| `stream-json` or `readline` for new terminal parsing | The existing `parse.ts` (to be preserved as `claude-stream-parse.ts`) handles all CLI output parsing needed |
| A new adapter for a different CLI | CliProfile table is designed to support future CLIs; do not create a new adapter module — the profile-driven approach is the replacement |
| `socket.io` | Already avoided in v0.7 for the same reasons; still irrelevant |

---

## Sources

- Direct codebase inspection: `src/lib/pty/pty-session.ts`, `src/lib/pty/session-store.ts`, `src/lib/pty/ws-server.ts`, `src/lib/adapters/`, `src/mcp/index.ts`, `src/mcp/server.ts`, `prisma/schema.prisma`, `package.json` — HIGH confidence
- `.planning/PROJECT.md` v0.9 milestone definition — HIGH confidence (project source of truth)
- Node.js 18 documentation: `fetch()` available globally since Node 18.0.0 (project constraint: 18.18+) — HIGH confidence
- Existing `.planning/research/STACK.md` v0.7 research (validated node-pty, ws, MCP SDK versions) — HIGH confidence

---

*Stack research for: ai-manager v0.9 — adapter cleanup, CLI Profile, MCP terminal tools, PTY idle detection*
*Researched: 2026-04-10*
