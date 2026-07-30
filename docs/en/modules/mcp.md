---
title: MCP
description: Model Context Protocol Server exposing Tower tools to external AI agents
---

# MCP Module

**Slug:** `mcp`

## Overview

Tower exposes an MCP (Model Context Protocol) Server that allows external AI agents to interact with the platform programmatically. The server runs via stdio transport and provides 46 tools across 11 categories. Any MCP-compatible client — such as Claude CLI, OpenClaw, or Paperclip — can connect and manage workspaces, projects, and tasks, identify projects, answer project-knowledge questions, manage notes and assets, start and monitor task executions, send input to running terminals, search, pull daily reports, and route durable gateway conversations, all without touching the Tower UI.

## Details

- **Stdio transport**: The MCP server communicates over standard input/output, making it easy to integrate with any process-based MCP client.
- **46 tools in 11 categories**: Workspace CRUD, Project CRUD, Task management, Label management, Search, Project identification, Project knowledge base, Notes & Assets, Terminal I/O, Reporting, and Harness/gateway routing (see the [Harness module](./harness)).
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

## File Reference

### Core (`src/mcp/`)

| File | Description |
|------|-------------|
| `server.ts` | MCP Server initialization and configuration |
| `db.ts` | MCP-dedicated database connection |
| `index.ts` | Entry point and exports |

### Tool Modules (`src/mcp/tools/`)

| File | Tool Count | Description |
|------|------------|-------------|
| `workspace-tools.ts` | 4 | Workspace CRUD |
| `project-tools.ts` | 6 | Project CRUD + product groups |
| `task-tools.ts` | 8 | Task CRUD + move + defaults + versions + set_goal_mode |
| `label-tools.ts` | 4 | Label CRUD + set_task_labels |
| `search-tools.ts` | 1 | Global search |
| `knowledge-tools.ts` | 1 | identify_project |
| `knowledge-base-tools.ts` | 2 | ask_project_knowledge / manage_project_facts |
| `note-asset-tools.ts` | 2 | manage_notes / manage_assets |
| `terminal-tools.ts` | 6 | start execution + terminal output/input/status + close terminal + resume/launch terminal |
| `report-tools.ts` | 2 | daily_summary / daily_todo |
| `harness-tools.ts` | 10 | Unattended messaging plus durable gateway routing and Workbench completion delivery (see the [Harness module](./harness)) |

## Internal HTTP Bridge

MCP stdio processes cannot access in-memory PTY sessions, so internal HTTP routes provide a bridge:
- `GET /api/internal/terminal/[taskId]/buffer`
- `POST /api/internal/terminal/[taskId]/input`
- `POST /api/internal/terminal/[taskId]/start`
- `POST /api/internal/terminal/[taskId]/stop` (reuses the Stop button logic)
- `POST /api/internal/terminal/[taskId]/resume` (defaults to the Continue/Retry button logic; fresh start when no history)
- `POST/PATCH/PUT /api/internal/harness/gateway` (durable inbound routing, completion acknowledgement, and retryable project replies)
- Restricted to localhost
