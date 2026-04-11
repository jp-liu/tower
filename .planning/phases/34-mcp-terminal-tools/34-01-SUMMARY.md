---
phase: 34-mcp-terminal-tools
plan: "01"
subsystem: mcp
tags: [mcp, terminal, pty, http-bridge, external-dispatch]
dependency_graph:
  requires: [33-internal-http-bridge]
  provides: [TERM-03, TERM-04, TERM-05]
  affects: [src/mcp/server.ts, src/mcp/tools/terminal-tools.ts]
tech_stack:
  added: []
  patterns: [http-bridge-fetch, mcp-tool-object-export]
key_files:
  created:
    - src/mcp/tools/terminal-tools.ts
  modified:
    - src/mcp/server.ts
decisions:
  - "Terminal MCP tools use fetch() to localhost:3000 HTTP bridge — MCP stdio process has separate globalThis from Next.js, cannot share in-memory PTY sessions"
  - "BRIDGE_BASE module constant + bridgeFetch helper keep all three tools DRY"
  - "get_task_execution_status combines DB query (execution record) with live bridge call (terminal status) to give full picture in one tool call"
metrics:
  duration: 83s
  completed: "2026-04-11"
  tasks_completed: 2
  files_modified: 2
---

# Phase 34 Plan 01: MCP Terminal Tools Summary

Three MCP tools added for external orchestrator (Paperclip/OpenClaw) terminal interaction: read PTY output, inject text input, and query combined execution + terminal status — all via HTTP bridge fetch to localhost:3000.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create terminal-tools.ts with three MCP tools | 7f70498 | src/mcp/tools/terminal-tools.ts (created) |
| 2 | Register terminal tools in MCP server | 56f11b0 | src/mcp/server.ts (modified) |

## What Was Built

### `src/mcp/tools/terminal-tools.ts`

Three MCP tool definitions following the exact same export pattern as `task-tools.ts`:

**`get_task_terminal_output`** (TERM-03)
- Schema: `{ taskId: string, lines?: number (1-500, default 50) }`
- Calls `GET /api/internal/terminal/{taskId}/buffer?lines=N`
- Returns `{ taskId, lines, total, killed }` or error on 404/failure

**`send_task_terminal_input`** (TERM-04)
- Schema: `{ taskId: string, text: string (1-10000 chars) }`
- Calls `POST /api/internal/terminal/{taskId}/input`
- Returns `{ ok: true, taskId }` or specific error for 404/410/failure

**`get_task_execution_status`** (TERM-05)
- Schema: `{ taskId: string }`
- Queries DB for latest `TaskExecution`, then calls buffer bridge for live status
- Returns combined `{ taskId, executionId, executionStatus, terminalStatus, startedAt, endedAt, outputSnippet }`
- `terminalStatus`: `running` | `exited` | `not_running` (derived from bridge response + DB status)

### `src/mcp/server.ts`

Added import and spread of `terminalTools` after `noteAssetTools`. Total MCP tool count is now 24 (was 21), within the ≤30 ceiling.

## Decisions Made

1. **HTTP bridge is the only IPC channel**: MCP stdio process runs in a separate OS process from Next.js, so `globalThis.__ptySessions` from `session-store.ts` is an empty Map in the MCP context. All PTY access must go through HTTP fetch to localhost:3000.

2. **`bridgeFetch` helper function**: Module-level `BRIDGE_BASE` constant and `bridgeFetch(path, init?)` wrapper keep all three tools DRY and make the URL pattern explicit.

3. **`get_task_execution_status` dual-source design**: Combines DB `TaskExecution` record (persistent state: PENDING/RUNNING/PAUSED/COMPLETED/FAILED) with live bridge call (transient terminal state: running/exited/not_running). This gives external orchestrators the full picture without needing two separate tool calls.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all three tools are fully wired to their HTTP bridge routes.

## Self-Check: PASSED

- [x] `src/mcp/tools/terminal-tools.ts` exists
- [x] `src/mcp/server.ts` updated with import and spread
- [x] Commit `7f70498` exists (terminal-tools.ts)
- [x] Commit `56f11b0` exists (server.ts)
- [x] `npx tsc --noEmit` — no new errors introduced (pre-existing errors in agent-config-actions.ts and pty-session.test.ts remain unchanged)
