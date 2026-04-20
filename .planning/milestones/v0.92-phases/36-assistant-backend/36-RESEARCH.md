# Phase 36: Assistant Backend - Research

**Researched:** 2026-04-17
**Domain:** Node-pty / WebSocket session management / Claude CLI arg composition
**Confidence:** HIGH

## Summary

Phase 36 adds a stateless, globally-accessible Claude CLI PTY session — the "assistant" — that is entirely independent of any task. The assistant session is not backed by a `TaskExecution` DB row, is keyed by a fixed string (`__assistant__`), runs with restricted tools (`--allowedTools "mcp__tower__*"`), and is destroyed on close with no resume support.

The existing infrastructure (`session-store.ts`, `pty-session.ts`, `ws-server.ts`) already supports any string key — the only extension needed in `ws-server.ts` is relaxing the keepalive logic for the assistant so that WS disconnect immediately destroys the session (BE-05: stateless, no keepalive). All other patterns (`createSession`, `getSession`, `destroySession`, batched sender, resize protocol) are 100% reused without modification.

The main new artifact is `src/actions/assistant-actions.ts` — a server action file that builds the CLI args (`--append-system-prompt`, `--allowedTools`), reads the Tower project `cwd` from the process environment, and calls `createSession("__assistant__", ...)`. A companion API route `src/app/api/internal/assistant/route.ts` handles HTTP `POST /start` and `DELETE /stop` requests for the assistant lifecycle (needed by Phase 37 client components that cannot call server actions directly from event handlers in all cases). BE-06 requires a config key `assistant.displayMode` (`"terminal" | "chat"`, default `"terminal"`) stored in `SystemConfig` and read by the frontend.

**Primary recommendation:** Reuse `session-store` + `ws-server` unchanged; add `assistant-actions.ts` for session spawn logic; add `assistant.systemPrompt` and `assistant.displayMode` to `config-defaults.ts`; modify `ws-server.ts` minimally (immediate destroy on WS close for `__assistant__` key, skipping keepalive).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices are at Claude's discretion — pure infrastructure phase. Key decisions locked by the CONTEXT.md analysis:

- Reuse existing `session-store.ts` and `PtySession` class — the assistant session is just another PTY session with a special key
- Reuse existing WebSocket server (`ws-server.ts`) — the assistant connects via the same WS server with a special identifier
- Create a new `assistant-actions.ts` server action file for assistant-specific logic (startAssistantSession, stopAssistantSession)
- The system prompt and --allowedTools args are built in the server action, not stored in CliProfile
- Add `assistant.systemPrompt` config key to SystemConfig for the predefined identity text
- No TaskExecution record needed — the assistant is stateless

### Claude's Discretion
All implementation details — this is a pure infrastructure phase with no user decisions locked.

### Deferred Ideas (OUT OF SCOPE)
None — infrastructure phase.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BE-01 | System creates a new Claude CLI PTY session when user opens the assistant | `createSession("__assistant__", ...)` in `assistant-actions.ts`; identical to `startPtyExecution` pattern minus DB writes |
| BE-02 | System injects a system prompt defining assistant identity via --append-system-prompt | `claudeArgs.push("--append-system-prompt", systemPrompt)` — pattern already used in `agent-actions.ts:559` |
| BE-03 | System restricts tools to Tower MCP only via --allowedTools "mcp__tower__*" | `claudeArgs.push("--allowedTools", "mcp__tower__*")` as additional CLI arg before the prompt |
| BE-04 | System connects the assistant to the PTY session via WebSocket for real-time streaming | WS URL `ws://localhost:${wsPort}/terminal?taskId=__assistant__`; existing `ws-server.ts` handles it without modification |
| BE-05 | System destroys the PTY session when the assistant is closed (stateless) | `stopAssistantSession()` calls `destroySession("__assistant__")`; WS server needs `__assistant__` keepalive = 0 |
| BE-06 | System supports a config key to switch between terminal mode and chat mode | New `assistant.displayMode` entry in `config-defaults.ts`; `setConfigValue`/`getConfigValue` from existing config actions |
| UX-01 | Each assistant open starts a fresh session with no prior history | `startAssistantSession()` calls `destroySession("__assistant__")` first (same guard pattern as `createSession`) |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-pty | already installed | PTY spawn + resize + kill | All task sessions use it; no alternative exists |
| ws (WebSocketServer) | already installed | Browser WS streaming | Existing ws-server.ts runs on port 3001 |
| @xterm/xterm | already installed | Browser terminal rendering | Used by TaskTerminal component |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | already installed | Body schema validation in API routes | POST /api/internal/assistant/start body |
| Prisma / db | already installed | Read CliProfile (command + envVars), read SystemConfig | startAssistantSession needs default CLI profile |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Fixed key `__assistant__` | Separate Map in session-store | Fixed key is zero-infrastructure, integrates with existing WS routing |
| Server action for start/stop | API route only | Server actions are simpler for Next.js App Router; API route also added for Phase 37 flexibility |

**Installation:** No new packages required.

---

## Architecture Patterns

### New Files to Create

```
src/
├── actions/
│   └── assistant-actions.ts        # startAssistantSession, stopAssistantSession, getAssistantStatus
└── app/
    └── api/
        └── internal/
            └── assistant/
                └── route.ts        # POST = start, DELETE = stop (for client-side fetch)
```

### Modified Files

```
src/lib/
└── config-defaults.ts              # Add assistant.systemPrompt, assistant.displayMode entries

src/lib/pty/
└── ws-server.ts                    # Skip keepalive for __assistant__ session key (immediate destroy on WS close)
```

### Pattern 1: startAssistantSession

```typescript
// src/actions/assistant-actions.ts
"use server";

import { createSession, destroySession, getSession } from "@/lib/pty/session-store";
import { readConfigValue } from "@/lib/config-reader";
import { db } from "@/lib/db";

const ASSISTANT_SESSION_KEY = "__assistant__";

function parseProfileJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`CLI Profile ${label} is malformed — fix in Settings`);
  }
}

export async function startAssistantSession(): Promise<void> {
  // Destroy any existing assistant session (UX-01: fresh every open)
  destroySession(ASSISTANT_SESSION_KEY);

  // Read CliProfile for command + envVars
  const profile = await db.cliProfile.findFirst({ where: { isDefault: true } });
  if (!profile) throw new Error("No default CLI profile found — run seed first");

  const profileCommand = profile.command;
  const profileEnvVars = parseProfileJson<Record<string, string>>(profile.envVars, "envVars");
  const profileBaseArgs = parseProfileJson<string[]>(profile.baseArgs, "baseArgs");

  // Read assistant config
  const systemPrompt = await readConfigValue<string>(
    "assistant.systemPrompt",
    "You are Tower Assistant, an AI operator for the Tower task management platform. You help users create, organize, and track tasks using Tower MCP tools. You do NOT write or edit code."
  );

  // cwd = Tower project directory (process.cwd() is the Next.js project root)
  const cwd = process.cwd();

  // Build CLI args
  const claudeArgs: string[] = [
    ...profileBaseArgs,
    "--allowedTools", "mcp__tower__*",
    "--append-system-prompt", systemPrompt,
  ];

  const envOverrides: Record<string, string> = {
    ...profileEnvVars,
  };

  createSession(
    ASSISTANT_SESSION_KEY,
    profileCommand,
    claudeArgs,
    cwd,
    () => {},      // no-op onData — ws-server wires real broadcaster
    () => {},      // no-op onExit — no DB update needed
    envOverrides
  );
}

export async function stopAssistantSession(): Promise<void> {
  destroySession(ASSISTANT_SESSION_KEY);
}

export async function getAssistantSessionStatus(): Promise<"running" | "idle"> {
  const session = getSession(ASSISTANT_SESSION_KEY);
  if (!session || session.killed) return "idle";
  return "running";
}
```

### Pattern 2: ws-server.ts modification (BE-05 keepalive skip)

The WS close handler currently applies a 2-hour keepalive for running sessions. For `__assistant__` the session must be destroyed immediately when the browser disconnects (stateless requirement).

```typescript
// In ws-server.ts ws.on("close") handler — add assistant guard
ws.on("close", () => {
  (ws as WebSocket & { _batcher?: BatchedSender })._batcher?.flush();
  if (sessionClients.get(taskId) !== ws) return;
  console.error(`[ws-server] WS disconnected for task ${taskId}`);
  sessionClients.delete(taskId);
  const s = getSession(taskId);
  if (!s) return;
  s.setDataListener(() => {});

  // Assistant sessions: stateless — destroy immediately on disconnect
  if (taskId === "__assistant__") {
    destroySession(taskId);
    return;
  }

  const timeout = s.killed ? KEEPALIVE_EXITED_MS : KEEPALIVE_RUNNING_MS;
  s.disconnectTimer = setTimeout(() => {
    console.error(`[ws-server] Keepalive expired for task ${taskId}`);
    destroySession(taskId);
  }, timeout);
});
```

### Pattern 3: config-defaults.ts additions

```typescript
// Add to CONFIG_DEFAULTS in config-defaults.ts
"assistant.systemPrompt": {
  defaultValue: "You are Tower Assistant, an AI operator for the Tower task management platform...",
  type: "string",
  label: "Assistant System Prompt",
},
"assistant.displayMode": {
  defaultValue: "terminal",
  type: "string",
  label: "Assistant Display Mode (terminal | chat)",
},
```

### Pattern 4: Internal API route

```typescript
// src/app/api/internal/assistant/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { startAssistantSession, stopAssistantSession } from "@/actions/assistant-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;
  try {
    await startAssistantSession();
    return NextResponse.json({ ok: true, sessionKey: "__assistant__" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;
  stopAssistantSession();
  return NextResponse.json({ ok: true });
}
```

### Anti-Patterns to Avoid

- **Storing `__assistant__` sessions in a separate Map:** Breaks the globalThis singleton pattern that survives HMR. Use the same `sessions` Map in `session-store.ts`.
- **Creating a TaskExecution row for the assistant:** Unnecessary DB write, complicates `getActiveExecutionsAcrossWorkspaces` output.
- **Injecting `AI_MANAGER_TASK_ID` into assistant envOverrides:** This env var is for task correlation only; assistant has no taskId.
- **Using `--print` or `--output-format stream-json` flags:** Raw TTY mode (no flags) is required for xterm.js rendering.
- **Calling `destroySession` from client code:** Only server actions and server-side routes should manage session lifecycle.
- **Using `validateTaskId` for the assistant route:** The `__assistant__` key is not a CUID. The internal assistant route does NOT need `validateTaskId`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PTY session pooling | Custom session registry | `session-store.ts` `createSession/getSession/destroySession` | Already has globalThis singleton for HMR survival |
| Output buffering for reconnect | Custom ring buffer | `PtySession.getBuffer()` / `wireSession` in ws-server | 50 KB ring buffer already implemented |
| Resize protocol | Custom resize message format | Existing `{ type: "resize", cols, rows }` JSON protocol | ws-server.ts already parses this |
| WS batching | Custom flush logic | `makeBatchedSender` in ws-server | 8ms batch interval prevents micro-message flooding |
| Config persistence | Raw SQLite writes | `setConfigValue` / `getConfigValue` / `readConfigValue` | SystemConfig table already used by terminal.wsPort, etc. |

**Key insight:** The assistant session is architecturally identical to a task PTY session — only the key, args, and lifecycle differ. Treat it as a first-class citizen of the existing session-store, not a separate system.

---

## Common Pitfalls

### Pitfall 1: CUID validation blocks assistant WS connection
**What goes wrong:** If any code path calls `validateTaskId("__assistant__")`, the WS connection is rejected because `__assistant__` doesn't match `/^c[a-z0-9]{20,30}$/`.
**Why it happens:** `ws-server.ts` uses `url.searchParams.get("taskId")` as a raw string key — it does NOT call `validateTaskId`. The internal API guard only validates CUID on routes that use `validateTaskId` explicitly.
**How to avoid:** Do not add `validateTaskId` to the assistant API route. The WS server already accepts any string key. Confirm ws-server.ts `taskId` extraction has no validation gate.
**Warning signs:** WS close code 1008 "Missing taskId" when connecting with `?taskId=__assistant__`.

### Pitfall 2: HMR creates duplicate session-store Maps
**What goes wrong:** After Hot Module Replacement in development, `assistant-actions.ts` module reloads with a fresh `Map`, losing the reference to the assistant session.
**Why it happens:** Next.js re-bundles server action modules on HMR but `ws-server.ts` (loaded once via instrumentation) retains the old Map.
**How to avoid:** `session-store.ts` already uses the `globalThis.__ptySessions` singleton pattern — as long as `assistant-actions.ts` imports from `session-store.ts`, it always sees the shared Map.
**Warning signs:** `getSession("__assistant__")` returns `undefined` immediately after a code save in dev mode.

### Pitfall 3: Assistant keepalive prevents stateless behavior
**What goes wrong:** When the user closes the assistant panel, the WS disconnects but the PTY session survives for 2 hours (running keepalive). On the next open, `createSession` destroys the stale session — but the user may have expected a fresh start and instead sees the old session's buffer replayed.
**Why it happens:** `ws-server.ts` default keepalive logic is designed for task sessions (user may navigate away and return).
**How to avoid:** Add the `__assistant__` guard in the WS `close` handler to call `destroySession` immediately instead of starting the keepalive timer.
**Warning signs:** Second assistant open shows output from the previous session instead of a blank terminal.

### Pitfall 4: `process.cwd()` returns wrong directory in production
**What goes wrong:** `process.cwd()` in a Next.js server action returns the project root only in standard deployments. If Tower is started from a different directory, cwd will be wrong.
**Why it happens:** `process.cwd()` is inherited from the process that spawned Next.js.
**How to avoid:** In `startAssistantSession`, prefer `process.env.NEXT_PUBLIC_APP_ROOT ?? process.cwd()` or resolve relative to `__dirname` / `import.meta.url`. For a local-only app, `process.cwd()` is reliable when started via `pnpm dev` from the project root. Document the assumption.
**Warning signs:** Claude CLI errors out with "directory not found" or MCP tools fail to locate the Tower database.

### Pitfall 5: --allowedTools flag format
**What goes wrong:** Using `--allowedTools "mcp__tower__*"` as a single string may cause shell parsing issues depending on how node-pty spawns the process.
**Why it happens:** node-pty spawns with `args` array (no shell), so the argument is passed verbatim — no quoting needed.
**How to avoid:** Pass `"--allowedTools"` and `"mcp__tower__*"` as separate array elements: `["--allowedTools", "mcp__tower__*"]`.
**Warning signs:** Claude CLI reports "unknown option" or all tools are allowed (pattern not applied).

---

## Code Examples

### createSession call signature (from session-store.ts)

```typescript
// Source: src/lib/pty/session-store.ts
export function createSession(
  taskId: string,         // <-- use "__assistant__" here
  command: string,        // <-- profile.command ("claude")
  args: string[],         // <-- [...profileBaseArgs, "--allowedTools", "mcp__tower__*", "--append-system-prompt", systemPrompt]
  cwd: string,            // <-- process.cwd() (Tower project root)
  onData: (data: string) => void,   // <-- no-op () => {}
  onExit: (exitCode: number, signal?: number) => void, // <-- no-op () => {}
  envOverrides?: Record<string, string>,  // <-- profileEnvVars (no AI_MANAGER_TASK_ID)
  onIdle?: () => void,    // <-- omit (no idle notification for assistant)
  idleThresholdMs?: number // <-- omit
): PtySession
```

### WS connection URL for assistant (from task-terminal.tsx pattern)

```typescript
// Client code (Phase 37) will connect with:
const socket = new WebSocket(
  `ws://localhost:${wsPort}/terminal?taskId=${encodeURIComponent("__assistant__")}`
);
// encodeURIComponent("__assistant__") = "__assistant__" (no special chars)
```

### Existing --append-system-prompt usage (from agent-actions.ts:559)

```typescript
// Source: src/actions/agent-actions.ts line 559
claudeArgs.push("--append-system-prompt", promptContent);
// Same pattern applies for assistant: claudeArgs.push("--append-system-prompt", systemPrompt)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SSE stream for Claude output | PTY + WebSocket (raw TTY) | Phase 26 | xterm.js renders full ANSI; no output-format flags needed |
| Per-task PTY sessions only | Any string key in session-store | Phase 36 (new) | Enables non-task sessions like the assistant |

**Deprecated/outdated:**
- `--output-format stream-json` + `--print -`: Only used by legacy SSE route, not by PTY sessions.

---

## Open Questions

1. **Should `assistant.systemPrompt` be user-editable in Settings UI?**
   - What we know: BE-06 says "config key to switch between terminal/chat mode" — not system prompt editing.
   - What's unclear: Whether Phase 39 (Settings) will expose prompt editing.
   - Recommendation: Store it in `SystemConfig` as planned; Settings UI is out of scope for this phase.

2. **Should the assistant session survive app restart / page reload?**
   - What we know: UX-01 says "each open starts fresh" — consistent with no-keepalive.
   - What's unclear: Whether Phase 37 should detect a stale session on mount and destroy it.
   - Recommendation: `startAssistantSession` already calls `destroySession("__assistant__")` first — this covers both "reopen" and "page reload" scenarios.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node-pty | PTY session spawn | Already in project | As installed | — |
| ws WebSocketServer | WS streaming | Already in project | As installed | — |
| Claude CLI (`claude` binary) | Spawning the assistant | Depends on CliProfile.command | User-configured | Error message: "No default CLI profile" |

**Missing dependencies with no fallback:**
- Claude CLI binary must be on PATH and configured in CliProfile. This is a precondition already enforced in `startPtyExecution`.

---

## Validation Architecture

The `.planning/config.json` does not set `workflow.nyquist_validation: false`, so this section is included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (check for vitest.config.ts) |
| Config file | vitest.config.ts (if present) |
| Quick run command | `pnpm test:run` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BE-01 | `startAssistantSession` calls `createSession("__assistant__", ...)` | unit | `pnpm test:run -- assistant-actions` | Wave 0 |
| BE-02 | CLI args include `--append-system-prompt <text>` | unit | `pnpm test:run -- assistant-actions` | Wave 0 |
| BE-03 | CLI args include `--allowedTools` `mcp__tower__*` | unit | `pnpm test:run -- assistant-actions` | Wave 0 |
| BE-04 | WS server accepts `?taskId=__assistant__` and wires session | manual smoke | Manual: open browser, connect WS | — |
| BE-05 | WS disconnect immediately destroys `__assistant__` session | unit | `pnpm test:run -- ws-server` | Wave 0 |
| BE-06 | `assistant.displayMode` config key readable via `getConfigValue` | unit | `pnpm test:run -- config-defaults` | Wave 0 |
| UX-01 | `startAssistantSession` destroys existing session before creating new | unit | `pnpm test:run -- assistant-actions` | Wave 0 |

### Wave 0 Gaps
- [ ] `src/actions/__tests__/assistant-actions.test.ts` — covers BE-01, BE-02, BE-03, UX-01
- [ ] `src/lib/pty/__tests__/ws-server-assistant.test.ts` — covers BE-05 keepalive skip

---

## Project Constraints (from CLAUDE.md)

- **Package manager:** Use `pnpm` (verify `pnpm -v` first; never yarn)
- **i18n:** All user-facing strings via `t("key")` from `useI18n()` — zh/en
- **App Router:** New routes need `export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"`
- **Async params:** `const { id } = await params` in route handlers
- **No `console.log`:** Use `logger.create(...)` from `src/lib/logger.ts`
- **No mutation:** Immutable patterns; spread for object updates
- **Security — internal routes:** All `/api/internal/` routes must call `requireLocalhost(request)`. Task ID routes also call `validateTaskId` — but the assistant route does NOT use `validateTaskId` (key is `__assistant__`, not a CUID).
- **Security — env injection:** Never mutate `process.env`; use `envOverrides` in `createSession`
- **Security — CLI profile command:** `command` field must be from allowlist (`claude`, `claude-code`)
- **Security — envVars:** Block `PATH`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, `NODE_OPTIONS`, `HOME`, `SHELL` from envVars override

---

## Sources

### Primary (HIGH confidence)
- `src/lib/pty/session-store.ts` — createSession/destroySession/getSession API, globalThis singleton pattern
- `src/lib/pty/pty-session.ts` — PtySession constructor signature, kill/write/resize, buffer
- `src/lib/pty/ws-server.ts` — WebSocket routing via `?taskId=`, keepalive logic, wireSession, batched sender
- `src/actions/agent-actions.ts` — startPtyExecution pattern, CliProfile reading, `--append-system-prompt` usage (line 559)
- `src/lib/config-defaults.ts` — CONFIG_DEFAULTS structure, how to add new config keys
- `src/app/api/internal/terminal/[taskId]/start/route.ts` — internal API route pattern
- `src/lib/internal-api-guard.ts` — requireLocalhost, validateTaskId (CUID format)
- `.claude/rules/security.md` — env injection rules, internal API requirements

### Secondary (MEDIUM confidence)
- `src/components/task/task-terminal.tsx` — WS connection URL format `?taskId=...`, xterm.js lifecycle pattern

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and in use
- Architecture patterns: HIGH — directly derived from reading existing code
- Pitfalls: HIGH — identified from actual code behavior (keepalive, globalThis, CUID validation)

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable codebase, 30-day window)
