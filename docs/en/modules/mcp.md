---
title: MCP
description: Model Context Protocol Server exposing Tower tools to external AI agents
---

# MCP Module

**Slug:** `mcp`

## Overview

Tower exposes an MCP (Model Context Protocol) Server that allows external AI agents to interact with the platform programmatically. The server runs via stdio transport. Any MCP-compatible client — such as Claude CLI, OpenClaw, or Paperclip — can connect and manage workspaces, projects, and tasks, identify projects, answer project-knowledge questions, manage notes and assets, start and monitor task executions, send input to running terminals, search, pull daily reports, and route durable gateway conversations, all without touching the Tower UI. Tool groups and profile membership are derived from `src/mcp/tool-capabilities.ts`; this document intentionally does not maintain a separate tool total.

## Details

- **Stdio transport**: The MCP server communicates over standard input/output, making it easy to integrate with any process-based MCP client.
- **Capability-scoped catalogs**: Workspace, project, task, label, search, knowledge, notes/assets, terminal, reporting, messaging, bounded CapabilityRequest, Workbench, and gateway capabilities are composed per runtime (see the [Harness module](./harness)).
- **Internal HTTP bridge**: Since MCP runs as a separate stdio process, it cannot access in-memory PTY sessions directly. Localhost-only HTTP routes (`/api/internal/terminal/[taskId]/buffer`, `/input`, `/start`, `/stop`, and `/resume`) bridge this gap.
- **External orchestration workflow**: Create a task, start execution, monitor via terminal output polling, send interactive input, and check completion status — all through MCP tools.

## Startup Configuration

```json
{
  "mcpServers": {
    "tower": {
      "command": "npx",
      "args": ["tsx", "<project-root>/src/mcp/index.ts"]
    }
  }
}
```

The default `full` profile preserves existing MCP configurations. Set
`TOWER_MCP_PROFILE` to select a narrower runtime surface; unknown values fail
startup instead of falling back to `full`.

| Profile | Runtime | Capability surface |
|---------|---------|--------------------|
| `full` | Backward compatibility | Complete catalog |
| `assistant` | Tower's in-process Assistant | core + terminal |
| `task` | Tower task terminals | core + terminal + messaging + workbench |
| `gateway` | OpenClaw/Hermes gateway process | read-only core/terminal + gateway + operations |
| `gateway-query` | Separate read-only bridge | bounded project query and discussion delivery |

Profiles reduce discovery and availability as defense in depth. They do not
replace OWNER/NON_OWNER sender policies or authorization and binding checks in
tool handlers.

## File Reference

### Core (`src/mcp/`)

| File | Description |
|------|-------------|
| `server.ts` | MCP Server initialization and configuration |
| `db.ts` | MCP-dedicated database connection |
| `index.ts` | Entry point and exports |
| `tool-capabilities.ts` | Single source for capability groups, profiles, and gateway allowlists |
| `tool-catalog.ts` | Maps capability profiles to concrete schemas and handlers |

### Tool Modules (`src/mcp/tools/`)

| File | Description |
|------|-------------|
| `workspace-tools.ts` | Workspace CRUD |
| `project-tools.ts` | Project CRUD + product groups |
| `task-tools.ts` | Task CRUD + move + defaults + versions |
| `unattended-goal-tools.ts` | Optional unattended Goal runtime (outside Core; grants no external authorization) |
| `gateway-capability-tools.ts` | Capability discovery, bounded Direct requests, minimal Tower result reads, and read-only external Job reconciliation |
| `label-tools.ts` | Label CRUD + set_task_labels |
| `search-tools.ts` | Global search |
| `knowledge-tools.ts` | identify_project |
| `knowledge-base-tools.ts` | ask_project_knowledge / manage_project_facts |
| `note-asset-tools.ts` | manage_notes / manage_assets |
| `terminal-tools.ts` | start execution + terminal output/input/status + close terminal + resume/launch terminal |
| `report-tools.ts` | daily_summary / daily_todo |
| `harness/` | messaging, gateway query/owner, Workbench, and operations adapters (see the [Harness module](./harness)) |

## Internal HTTP Bridge

MCP stdio processes cannot access in-memory PTY sessions, so internal HTTP routes provide a bridge:
- `GET /api/internal/terminal/[taskId]/buffer`
- `POST /api/internal/terminal/[taskId]/input`
- `POST /api/internal/terminal/[taskId]/start`
- `POST /api/internal/terminal/[taskId]/stop` (reuses the Stop button logic)
- `POST /api/internal/terminal/[taskId]/resume` (defaults to the Continue/Retry button logic; fresh start when no history)
- `POST/PATCH/PUT /api/internal/harness/gateway` (durable inbound routing, completion acknowledgement, and retryable project replies)
- `GET/POST /api/internal/harness/capabilities` (discovery, minimal request status, and deterministic Direct submission)
- `POST /api/internal/harness/capabilities/completions` (scoped OpenClaw Job callback followed by authoritative read-only reconciliation and a Workbench wakeup)
- Restricted to localhost
