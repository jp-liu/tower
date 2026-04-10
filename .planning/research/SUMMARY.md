# Project Research Summary

**Project:** ai-manager v0.9 — 架构清理 + 外部调度闭环
**Domain:** AI task execution platform — adapter cleanup, CLI Profile config, MCP terminal tools, PTY idle detection, external dispatch via Feishu
**Researched:** 2026-04-10
**Confidence:** HIGH

## Executive Summary

ai-manager v0.9 is a focused architectural cleanup and external-dispatch milestone. The codebase already has a fully functional PTY execution engine (v0.7–v0.8): node-pty spawns CLI processes, a 50 KB ring buffer stores output, WebSocket streams it to xterm.js, and an onExit callback persists the result to SQLite. v0.9's job is to (1) remove the dead SSE/adapter execution path that predates PTY, (2) lift hardcoded CLI invocation parameters into a DB-backed `CliProfile` table, (3) expose the PTY session to the external MCP orchestrator (Paperclip/OpenClaw) via two new MCP tools backed by a localhost HTTP bridge, and (4) wire idle detection plus Feishu notifications to close the human-in-the-loop feedback loop. No new npm packages are required — every capability is achievable with existing installed libraries.

The recommended approach is strict phase sequencing driven by dependency order: adapter dead code removal first (zero risk, clears confusion), then schema additions, then PTY primitives, then the agent-actions wiring, and finally the MCP surface. This order ensures each phase is independently testable and no phase has untested predecessors. The single most important architectural decision is the internal HTTP bridge (`/api/internal/pty/[taskId]/...`) as the IPC channel between the MCP process and the Next.js process — this is the only safe solution given the separate-process constraint validated in v0.2 that must not be reversed.

The main risks are: (a) severing live references during adapter cleanup — specifically `registry.ts` is still imported by the Settings verification route, and removing it without migrating `testEnvironment` breaks the UI silently; (b) PTY idle detection false-positives during Claude's silent reasoning phases (30–120 s of zero output is normal), which requires a 180 s minimum threshold and two-phase verification; and (c) Feishu notifications firing for manual Claude sessions because `notify-agi.sh` uses a shared `task-meta.json` that must be cleaned up after each send.

## Key Findings

### Recommended Stack

All v0.9 features are implementable with the existing stack — no `pnpm add` commands are needed. The base stack (Next.js 16.2.1, React 19, Prisma 6 + SQLite, node-pty 1.1.0, ws 8.x, @modelcontextprotocol/sdk 1.28.0, zod 4.x) provides everything required. New capabilities map directly to existing packages: the `CliProfile` table uses Prisma + `prisma db push`, the internal HTTP bridge uses native Node.js 18 `fetch()`, idle detection uses `setTimeout` in TypeScript, env injection uses object spread in the existing `pty.spawn` env parameter, and Feishu notification uses `child_process.execFile` to call the existing `notify-agi.sh` shell script.

**Core technologies:**
- `@prisma/client` (v6): new `CliProfile` model — stores CLI command and base args as JSON string, consistent with existing `AgentConfig.settings` pattern; no migration tool change needed
- `node-pty` (v1.1.0): extended with `envOverrides` constructor param and idle detection via `setTimeout` polling — purely additive, no behavior change for existing call sites
- Native Node.js `fetch()` (Node 18+): MCP-to-Next.js HTTP bridge — eliminates need for `node-fetch` or `axios`
- `ws` (v8.x): unchanged — WebSocket server at port 3001 is fully decoupled from the new idle/MCP features
- `child_process.execFile` (Node built-in): programmatic Feishu notification from `onExit` and idle callbacks via `notify-agi.sh`

### Expected Features

**Must have (table stakes):**
- Adapter dead code removal (`execute.ts`, `parse.ts`, `registry.ts`, `process-manager.ts`) — clears architectural confusion before new features land
- CLI Profile DB table (`CliProfile` model) with seeded default row — replaces hardcoded `"claude"` command and `["--dangerously-skip-permissions"]` args in `startPtyExecution` and `resumePtyExecution`
- Internal HTTP bridge (`GET /api/internal/pty/[taskId]/buffer`, `POST /api/internal/pty/[taskId]/write`) — shared IPC foundation for both MCP terminal tools, loopback-only
- MCP tool: `get_task_terminal_output` — enables Paperclip to poll PTY ring buffer without a browser terminal open
- MCP tool: `send_task_terminal_input` — enables Paperclip to inject input mid-execution (e.g., answer Claude confirmation prompts)
- PTY idle detection with configurable callback — detects Claude's "waiting for input" state after configurable silence threshold
- Feishu completion notification from `onExit` — gated on `FEISHU_NOTIFY_GROUP` env var; calls `notify-agi.sh` with task metadata

**Should have (differentiators):**
- Structured Feishu message templates (task.completed, task.idle, task.failed) — parameterized shell `case` blocks in `notify-agi.sh`
- MCP tool: `get_task_execution_status` — execution-level granularity (RUNNING vs task's IN_PROGRESS); direct DB query, no bridge needed
- Settings UI for CLI Profile CRUD — view/edit profile without touching DB directly; medium complexity
- Idle threshold configurable via `SystemConfig` key `pty.idleThresholdSec`

**Defer (v2+):**
- Full multi-CLI adapter with UI switcher — only Claude is in use; one-row CliProfile table is sufficient for now
- Generic webhook push to external URLs — network egress and auth complexity; `openclaw` CLI call covers all current needs
- Continuous PTY output flush to DB — SQLite write volume at 8 ms batch rate is prohibitive; flush summary at execution end only
- Multi-target notification (Telegram, Slack) — single Feishu target via `openclaw` covers all current needs
- Inbound Paperclip API endpoint — external auth complexity; MCP tool calls from Paperclip side suffice

### Architecture Approach

v0.9 makes targeted, additive modifications to four existing files (`pty-session.ts`, `session-store.ts`, `agent-actions.ts`, `mcp/server.ts`) and adds three new files (two Next.js route handlers, one MCP tool module), while deleting four dead adapter files and migrating four live ones. The process boundary between the MCP stdio process and the Next.js HTTP server is bridged via localhost HTTP — a clean, zero-new-dependency solution consistent with the existing WebSocket origin-check pattern. All PTY-session mutations are confined to `agent-actions.ts`; the WebSocket layer (`ws-server.ts`) requires no changes.

**Major components:**
1. `prisma/schema.prisma` + migration — adds `CliProfile` model with seeded default row (`command: "claude"`, `baseArgs: ["--dangerously-skip-permissions"]`)
2. `src/lib/pty/pty-session.ts` — extended with optional `envOverrides` constructor param + idle detection API (`setIdleTimeout`, `addIdleCallback`, `clearIdleCallbacks`, `_resetIdleTimer`)
3. `src/lib/pty/session-store.ts` — forwards `envOverrides` optional param to `PtySession` constructor
4. `src/actions/agent-actions.ts` — reads `CliProfile` from DB; uses profile command+args; passes `envOverrides`; registers idle callback; wires Feishu completion notification in `onExit`
5. `src/app/api/internal/pty/[taskId]/buffer/route.ts` (new) — GET: returns ring buffer for MCP process; loopback-only guard
6. `src/app/api/internal/pty/[taskId]/write/route.ts` (new) — POST: writes to PTY stdin for MCP process; guards against dead sessions
7. `src/mcp/tools/terminal-tools.ts` (new) — `get_task_terminal_output` + `send_task_terminal_input` calling bridge via `fetch()`
8. `src/lib/adapters/` — 4 files deleted, 4 files migrated to `src/lib/cli-verify.ts`, `src/lib/process-utils.ts`, `src/lib/preview-process-manager.ts`, `src/lib/claude-stream-parse.ts`

### Critical Pitfalls

1. **Dead code removal severs live Settings verification** — `registry.ts` is actively imported by `src/app/api/adapters/test/route.ts` (the Settings > AI Tools verify button) and has an unused import in `execute/route.ts`. Run `grep -r "from.*adapters" src/ --include="*.ts"` to enumerate all import sites; migrate `testEnvironment` to `src/lib/cli-verify.ts` before deleting the registry; run `tsc --noEmit` after each deletion step, not just at the end.

2. **PTY idle detection false positives during Claude reasoning** — Claude emits zero output for 30–120 s during extended thinking; a naive timer misclassifies this as idle. Use 180 s minimum threshold, implement two-phase verification (check PTY PID is still alive via `process.kill(pid, 0)` before acting), and expose `resetIdleTimer()` so WebSocket user keystrokes reset the timer independently.

3. **MCP process cannot access in-memory PTY sessions** — `globalThis.__ptySessions` is a Next.js-process singleton; the MCP stdio process has a separate `globalThis` that is always empty. This is the only correct solution: build and test the HTTP bridge routes with `curl` before writing any MCP tool code. Option B (shared file buffer) is one-way only and insufficient.

4. **Environment variable leakage between concurrent PTY sessions** — if CLI Profile env vars are written into `process.env` (global to the Node.js process) instead of passed directly to `pty.spawn()`'s `env` argument, concurrent sessions share state. Always pass per-session vars as the `envOverrides` constructor parameter; never mutate `process.env`.

5. **Feishu hook fires for manual Claude sessions** — `notify-agi.sh` reads a shared `task-meta.json` that persists across sessions. Add an `ai_manager_dispatched: true` field; verify `session_id` in the file matches the hook's `SESSION_ID`; delete or mark the file as processed after each send to prevent stale-meta cross-contamination between dispatched and manual sessions.

## Implications for Roadmap

Based on research, dependency order unambiguously determines phase sequence. Phases 1–3 are foundational (no user-visible features), Phases 4–6 deliver the external dispatch capabilities, and Phase 7 adds the optional Settings UI polish.

### Phase 1: Adapter Dead Code Removal
**Rationale:** Zero functional risk; clears architectural confusion that would otherwise make CLI Profile work harder to reason about. Must land before any new adapter-adjacent code is written. Has the highest leverage-per-line-of-code of any phase.
**Delivers:** Smaller, clearer codebase — only live adapter code remains, migrated to non-adapter paths; dead SSE/registry code gone
**Addresses:** Table stake: "Adapter dead code removal"
**Avoids:** Pitfall 1 (severing live Settings verification) — audit imports first, migrate `testEnvironment` to `src/lib/cli-verify.ts`, remove unused `listAdapters` import from `execute/route.ts` as the very first step, run `tsc --noEmit` after each file deletion

### Phase 2: Schema — CliProfile Table
**Rationale:** Schema must exist before any application code reads from it. Seeding the default row in the migration ensures `loadDefaultCliProfile()` never returns null, eliminating null-guard branches in the hot execution path.
**Delivers:** New `CliProfile` Prisma model, migration with seeded default row, regenerated Prisma client
**Uses:** `@prisma/client` v6, `prisma db push` / `prisma migrate`
**Avoids:** Pitfall 4 (env leakage) — schema design establishes that `envVars` is a per-profile JSON field, not a mutation of `process.env`

### Phase 3: PTY Primitives — envOverrides + Idle Detection
**Rationale:** Purely additive changes to `pty-session.ts` and `session-store.ts`; no existing call sites break (default `envOverrides = {}` is identity). Must land before agent-actions reads the profile and passes env vars. Design the idle API contract before coding.
**Delivers:** `PtySession` with `envOverrides` param; idle detection API (`setIdleTimeout`, `addIdleCallback`, `clearIdleCallbacks`, `_resetIdleTimer`); timer cleanup in `kill()`
**Uses:** `node-pty` v1.1.0 (existing), native `setTimeout`
**Avoids:** Pitfall 2 (idle false positives) — 180 s minimum threshold, two-phase verify, `resetIdleTimer` exposed for user keystroke resets
**Avoids:** Pitfall 4 (env leakage) — `envOverrides` is merged inside the constructor at `pty.spawn()` call time

### Phase 4: Agent Actions — CLI Profile Loading + Feishu Wiring
**Rationale:** With schema (Phase 2) and PTY primitives (Phase 3) in place, `agent-actions.ts` can be updated in one coherent pass: load profile, build args, pass `envOverrides`, register idle callback, wire Feishu completion notification from `onExit`.
**Delivers:** `startPtyExecution` and `resumePtyExecution` read from `CliProfile`; `DISPATCH_SOURCE` env var injected; idle callback registered; `onExit` triggers Feishu if `FEISHU_NOTIFY_GROUP` is set; server actions for profile CRUD
**Uses:** `@prisma/client`, `child_process.execFile` (Node built-in), `notify-agi.sh`
**Avoids:** Pitfall 5 (notify-agi.sh fires for manual sessions) — `DISPATCH_SOURCE` env var distinguishes automated vs manual; `notify-agi.sh` updated with `ai_manager_dispatched` check and meta-file cleanup after send

### Phase 5: Internal HTTP Bridge
**Rationale:** Shared foundation for both MCP terminal tools. Build once, test independently with `curl` before any MCP code is written. Both routes are stateless wrappers over existing `getSession()` and `write()` APIs.
**Delivers:** `GET /api/internal/pty/[taskId]/buffer` and `POST /api/internal/pty/[taskId]/write` — loopback-only, consistent with existing ws-server origin-check pattern
**Uses:** Next.js App Router route handlers, `globalThis.__ptySessions`, `getSession()` from `session-store.ts`
**Avoids:** Pitfall 3 (MCP cannot access PTY sessions) — HTTP is the only correct cross-process solution; validate routes with `curl` before MCP integration begins

### Phase 6: MCP Terminal Tools
**Rationale:** Can only land after the HTTP bridge (Phase 5) exists and is independently tested. Both tools are thin wrappers over `fetch()` calls — low implementation risk, high leverage for Paperclip integration.
**Delivers:** `get_task_terminal_output` and `send_task_terminal_input` registered in `mcp/server.ts`; MCP tool count: 21 → 23 (ceiling 30, headroom 7)
**Uses:** Native Node.js `fetch()`, `zod` v4 for input validation
**Avoids:** Pitfall 8 (MCP tool ceiling) — 23 tools is well within the 30-tool ceiling; no need for action-dispatch pattern consolidation

### Phase 7: Settings UI — CLI Profile CRUD (Optional)
**Rationale:** Developer convenience; the primary user can edit the profile via DB directly. Ship if time permits after Phases 1–6 are complete and validated.
**Delivers:** Settings card for viewing/editing `CliProfile` (label, command, baseArgs, default toggle)
**Uses:** Server actions from Phase 4, existing settings UI pattern
**Addresses:** Differentiator: "Settings UI for CLI Profile"

### Phase Ordering Rationale

- **Adapter cleanup first** because it has zero risk and maximum clarity benefit — every subsequent phase is easier to reason about in a clean codebase with no dead code misleading the reader.
- **Schema before application code** because Prisma generates the typed client that `agent-actions.ts` imports; skipping this order causes TypeScript errors at the first build.
- **PTY primitives before agent-actions** because `startPtyExecution` will call `createSession()` with the new `envOverrides` parameter — the callee signature must exist before the caller is updated.
- **HTTP bridge before MCP tools** because the bridge is the only dependency of the MCP tools; building the tools against a not-yet-existing endpoint guarantees integration failures.
- **All table-stakes phases (1–6) before optional UI (7)** because the UI is a convenience layer, not a blocker for the external dispatch close-loop functionality that defines the milestone.

### Research Flags

Phases with well-documented patterns (skip research-phase):
- **Phase 1 (Adapter cleanup):** Standard import audit and file deletion — no research needed; direct codebase inspection is sufficient
- **Phase 2 (Schema):** Standard Prisma migration with seed SQL — well-documented pattern; existing `AgentConfig` migration is the template
- **Phase 3 (PTY primitives):** Additive TypeScript with no external dependencies — all patterns are documented in ARCHITECTURE.md
- **Phase 6 (MCP tools):** Standard MCP tool registration — established pattern in existing `src/mcp/tools/` modules

Phases that may need targeted micro-research during planning:
- **Phase 4 (Agent actions / Feishu wiring):** `notify-agi.sh` integration requires understanding the exact `openclaw message send` argument interface and Claude Stop hook `SESSION_ID` availability — read the script and hook docs before finalizing the implementation plan
- **Phase 5 (HTTP bridge):** Confirm Next.js App Router route handlers can import `globalThis.__ptySessions` from `session-store.ts` without triggering a new module evaluation. The `globalThis` singleton pattern should handle this, but worth a quick stub-route smoke test before Phase 5 proper begins.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All findings from direct `package.json` and source inspection — the "no new packages required" conclusion is strongly verifiable; no inference involved |
| Features | HIGH | Features derived from `.planning/PROJECT.md` milestone definition plus direct codebase inspection; scope is tightly bounded with explicit anti-features listed |
| Architecture | HIGH | All architectural decisions derived from reading the running v0.8 code — execution flow, process boundaries, and globalThis singletons are directly observed facts, not inference |
| Pitfalls | HIGH | Critical pitfalls 1–3 are grounded in specific file/line references from live import graph analysis; pitfalls 4–5 are grounded in directly observable code patterns |

**Overall confidence:** HIGH

### Gaps to Address

- **notify-agi.sh argument interface:** The script currently reads from flat files. Phase 4 requires it to also accept arguments directly from Node.js `execFile`. The exact refactoring (argument order, env var names, backward compatibility with the Claude Stop hook path) should be validated by reading the script before implementing Phase 4 — do not assume.

- **App Router + globalThis import boundary:** Next.js App Router route handlers run in a different module evaluation context than `instrumentation.ts`. Confirm that importing `getSession` from `session-store.ts` inside a route handler correctly references the `globalThis.__ptySessions` Map populated by the instrumentation hook — not a fresh empty Map. A one-line smoke test before Phase 5 proper will resolve this.

- **CliProfile field naming inconsistency:** STACK.md uses `buildArgs`/`envVars` while ARCHITECTURE.md uses `baseArgs`. Align on a single field name before writing the migration to avoid a follow-up rename migration. Recommendation: use `baseArgs` (ARCHITECTURE.md is closer to the actual call site semantics in `agent-actions.ts`).

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `src/lib/pty/pty-session.ts`, `src/lib/pty/session-store.ts`, `src/lib/pty/ws-server.ts`, `src/actions/agent-actions.ts`, `src/lib/adapters/` (full tree), `src/mcp/index.ts`, `src/mcp/server.ts`, `prisma/schema.prisma`, `package.json`
- `.planning/PROJECT.md` — v0.9 milestone definition, MCP tool ceiling (30), architectural decisions from v0.2
- `/Users/liujunping/.claude/hooks/notify-agi.sh` — hook dedup logic, meta file handling, Feishu send path via `openclaw`

### Secondary (MEDIUM confidence)
- Node.js 18 documentation: native `fetch()` available globally since Node 18.0.0 (project constraint: Node 18.18+)
- `.planning/research/` v0.7 STACK.md — validated baseline stack decisions for node-pty, ws, MCP SDK versions; referenced but not repeated

---
*Research completed: 2026-04-10*
*Ready for roadmap: yes*
