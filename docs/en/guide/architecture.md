---
title: Architecture
description: Tower system architecture and design overview
---

## System Overview

Tower is built on Next.js 16 with the App Router pattern, using a full-stack architecture where the frontend and backend coexist in a single codebase.

## Data Architecture

```
Workspace (id, name, description?)
  ├── Project[] (id, name, alias?, description?, type, gitUrl?, localPath?)
  │     └── Task[] (id, title, description?, status, priority, order)
  │           ├── TaskLabel[] → Label
  │           ├── TaskExecution[]
  │           └── TaskMessage[]
  └── Label[] (id, name, color, isBuiltin)
```

- **Cascade deletes**: Deleting a Workspace removes all its Projects; deleting a Project removes all its Tasks
- **SQLite + Prisma**: Lightweight single-file database with WAL mode and busy_timeout=5000

## Runtime Architecture

```
Browser (Next.js App)
  ├── Server Actions (src/actions/)
  ├── API Routes (src/app/api/)
  ├── WebSocket Client (xterm.js)
  │
Next.js Server
  ├── Prisma ORM → SQLite
  ├── PTY Session Store (in-memory, keyed by taskId)
  ├── WebSocket Server (ws-server.ts, port 3001)
  └── MCP Server (stdio transport)
```

## Key Subsystems

### PTY Terminal System

Each task gets an independent PTY session running Claude CLI. Communication flows through WebSocket for real-time terminal I/O:

```
Client (xterm.js) ←→ WebSocket ←→ ws-server.ts ←→ PTY Session (node-pty)
                                                         ↕
                                                    session-store.ts
```

### MCP Server

Exposes 24+ tools via the Model Context Protocol, allowing external AI agents to manage workspaces, projects, tasks, and interact with running terminals. Runs as a stdio transport process.

### Internal HTTP Bridge

MCP stdio processes cannot access in-memory PTY sessions directly. Internal HTTP routes bridge this gap:
- `GET /api/internal/terminal/[taskId]/buffer` -- Read terminal output
- `POST /api/internal/terminal/[taskId]/input` -- Send terminal input
- Restricted to localhost only

## Module Dependency Overview

Tower is composed of 14 modules:

| Layer | Modules |
|-------|---------|
| **UI** | Board, Missions, Assistant, Search, Settings |
| **Core** | Workspace, Project, Task, Terminal |
| **Integration** | MCP, Git, AI, Assets & Notes |
| **Cross-cutting** | I18n |

## Process Lifecycle

- **PTY Sessions**: One active session per task, 2h keepalive while running, 5min after exit, SIGTERM cleanup
- **WebSocket**: Batched sender flushed on close, polling timer cleared on error
- **Database**: Prisma `$disconnect()` on SIGTERM/SIGINT
- **Timers**: All `setTimeout`/`setInterval` cleared in cleanup handlers
