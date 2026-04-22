---
title: MCP
description: Model Context Protocol Server exposing Tower tools to external AI agents
---

# MCP Module

**Slug:** `mcp`

## Overview

Tower exposes an MCP (Model Context Protocol) Server that allows external AI agents to interact with the platform programmatically. The server runs via stdio transport and provides 24 tools across 7 categories. Any MCP-compatible client — such as Claude CLI, OpenClaw, or Paperclip — can connect and manage workspaces, projects, and tasks, query live terminal output, send input to running terminals, and check execution status, all without touching the Tower UI.

## Details

- **Stdio transport**: The MCP server communicates over standard input/output, making it easy to integrate with any process-based MCP client.
- **24 tools in 7 categories**: Workspace CRUD, Project CRUD, Task management, Label management, Terminal I/O, Search, and Reporting.
- **Internal HTTP bridge**: Since MCP runs as a separate stdio process, it cannot access in-memory PTY sessions directly. Localhost-only HTTP routes (`/api/internal/terminal/[taskId]/buffer` and `/api/internal/terminal/[taskId]/input`) bridge this gap.
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
| `project-tools.ts` | 5 | Project CRUD + identify |
| `task-tools.ts` | 5 | Task CRUD + move |
| `label-tools.ts` | 4 | Label CRUD + set_task_labels |
| `terminal-tools.ts` | 3 | Terminal output/input/status |
| `search-tools.ts` | 1 | Global search |
| `report-tools.ts` | 2 | daily_summary / daily_todo |
| `note-asset-tools.ts` | -- | Notes and asset management |

## Internal HTTP Bridge

MCP stdio processes cannot access in-memory PTY sessions, so internal HTTP routes provide a bridge:
- `GET /api/internal/terminal/[taskId]/buffer`
- `POST /api/internal/terminal/[taskId]/input`
- Restricted to localhost
