<p align="center">
  <img src="public/banner.jpg" width="100%" alt="Tower" />
</p>

<p align="center">
  AI Task Orchestration Platform
</p>
<p align="center">
  <b>English</b> | <a href="./README.zh.md">中文</a>
</p>

An AI task orchestration platform — manage, dispatch, and execute AI-assisted development tasks through a visual Kanban board.

Integrates terminal, code editor, file tree, live preview, and MCP toolchain into an all-in-one AI development workflow assistant for individual developers.

## Quick Start

### Requirements

- Node.js >= 22
- pnpm (recommended)

### Installation

Install the public CLI and start Tower on its loopback default:

```bash
npm install -g @tower-org/cli
tower
```

For a registry-free GitHub Release install, offline distribution, checksums,
portable use, upgrades, rollback, services, and uninstall, follow the
[official installation guide](https://tower-org.github.io/tower/en/guide/getting-started.html).
The npm and GitHub Release channels are maintained in parallel.

For source development:

```bash
git clone https://github.com/tower-org/tower.git
cd tower
pnpm install

# Configure environment
cp .env.example .env
# Uses SQLite by default — no extra setup needed

# Initialize database
pnpm db:push
pnpm db:seed
pnpm db:init-fts

# Start dev server
pnpm dev
```

Open http://localhost:3000 in your browser.

### Production Build

```bash
pnpm build
pnpm start
```

Production binds to `127.0.0.1` by default. Use `pnpm start -- --host 0.0.0.0` or an explicit LAN address only when remote access is intentional.

### Optional unattended service

After a production build, users who want Tower to start automatically can opt in:

```bash
tower service install
tower service status
tower service remove
```

Tower uses a per-user macOS LaunchAgent on macOS and a per-user Windows Task
Scheduler entry on Windows. Installation is optional; developers can continue
to run `tower start` manually. Do not run the manual server and the unattended
service on the same port at the same time.

## Core Concepts

```
Workspace
  ├── Project
  │     └── Task
  │           ├── Label
  │           ├── Execution
  │           └── Message
  └── Label (shared)
```

- **Workspace** — Top-level container for projects and shared labels
- **Project** — Linked to a Git repo and/or local path; type is NORMAL or GIT
- **Task** — Work item displayed as a Kanban card grouped by status

## Features

### Kanban Board

- Drag-and-drop task cards between columns (TODO → IN_PROGRESS → IN_REVIEW → DONE)
- Right-click context menu: change status, launch execution, view details
- Search box for fuzzy matching task titles and descriptions
- Priority levels: LOW / MEDIUM / HIGH / CRITICAL
- Custom labels with color

### Task Workbench

The task detail page has a terminal panel on the left and a three-tab workspace on the right:

#### Terminal

- Browser terminal powered by xterm.js + node-pty
- Full ANSI rendering (colors, progress bars, cursor movement)
- Launch Claude Code, Codex CLI, Gemini CLI, or an enabled third-party CLI through the Terminal slot
- Explicit ordered fallback before session creation; connection/model stays pinned after the session starts
- Interactive keyboard input directly to the selected CLI
- Auto-synced terminal dimensions
- Reconnect without losing the session

#### File Browser (Files)

- Tree view of the worktree directory structure
- Automatic gitignore filtering
- Git status badges (M/A/D)
- Context menu: create file/folder, rename, delete
- Auto-refresh during execution

#### Code Editor

- Monaco Editor (same engine as VS Code)
- Syntax highlighting: TypeScript, JavaScript, Python, JSON, YAML, CSS, HTML, Markdown, Prisma
- Multi-tab editing with Ctrl+S save
- Dirty dot indicator for unsaved files
- Theme follows dark/light mode

#### Changes

- Diff view of the task branch against the base branch
- Merge confirmation workflow

#### Preview

- Launch a frontend dev server (e.g. `npm run dev`)
- Embedded iframe preview
- Auto-detected preview URL based on command pattern
- Auto-refresh on file save
- Auto-stops dev server when leaving the page

### Task Execution Lifecycle

```
Create task → Click Execute → TODO auto-transitions to IN_PROGRESS
    → selected CLI runs in terminal → Completes (exit 0) → IN_REVIEW
    → Manual review → Pass → DONE / Fail → re-execute
```

- Automatically creates a Git worktree on execution (if baseBranch is set)
- Sends Feishu notification on completion (when configured)
- On failure, task stays IN_PROGRESS for retry

### Project Management

- Selecting a local folder auto-detects Git remote and fills in gitUrl
- Project types: FRONTEND / BACKEND (controls preview availability)
- Git Path Mapping rules: auto-resolve local paths by host + owner

### Mission Control

- `/missions` dashboard monitors every running task execution across all workspaces with embedded live terminals
- Grid layout presets (1×1 … 3×3) persisted locally; workspace filter dropdown
- **Launch task** opens a search dialog — fuzzy-search tasks, browse by workspace → project, or pick from recent; launch new or resume a previous session
- Dual navigation: *input* mode (type into a pane) and *nav* mode (centered pane selector with `1–9 / A–Z` quick-select), toggle with `Ctrl+;`

### AI Tools and Assistant

- Connections above, five capability slots below: Terminal, Summary, Dreaming, Analysis, and Assistant
- Built-in Claude/Codex/Gemini CLI connections plus OpenAI, OpenAI Compatible, Anthropic, and Google API connections
- Tower-owned multi-turn Assistant sessions with SSE, attachments, Tower tools, cancellation, and on-demand legacy Claude import
- Explicit primary/fallback targets switch only before first activity; API connections support healthy multi-key round-robin
- See [AI Tools 0.3](./docs/en/guide/ai-tools.md), [upgrade guide](./docs/en/guide/upgrade-0.3.md), and [CLI Provider SDK](./docs/en/guide/cli-provider-sdk.md)

### Version Timeline

- Group tasks under project versions and review work release-by-release; unversioned tasks stay in the backlog

### Notes & Assets

- Per-project notes (full-text searchable) and asset uploads (files, images, pasted screenshots), manageable from the UI or via MCP tools

### Settings

| Category | Options |
|----------|---------|
| General | Theme (dark/light/system), Language (zh/en), Default terminal app |
| Terminal | WebSocket port, Idle timeout |
| System | Upload limits, Concurrency, Git timeout, Search parameters |
| AI Tools | CLI/API connections, models, five capability slots, CLI plugins |
| CLI Profile | Legacy-compatible CLI command, Args, Environment variables |
| Prompts | Custom agent prompt templates |
| Agent | Agent configuration management |
| Git Rules | Path mapping rules (host/owner → local path) |

### Internationalization

Supports Chinese and English. Switch in Settings.

## MCP Integration

Tower exposes an MCP Server for external AI agents:

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

### Available Tools (35)

| Category | Tools |
|----------|-------|
| Workspace | list_workspaces, create_workspace, update_workspace, delete_workspace |
| Project | list_projects, create_project, update_project, delete_project |
| Task | list_tasks, create_task, update_task, move_task, delete_task, set_task_defaults, list_versions |
| Label | list_labels, create_label, delete_label, set_task_labels |
| Search | search (global search across tasks/projects/repos) |
| Knowledge | identify_project, ask_project_knowledge, manage_project_facts |
| Notes/Assets | manage_notes, manage_assets |
| Terminal | start_task_execution, get_task_terminal_output, send_task_terminal_input, get_task_execution_status, stop_task_execution, resume_task_execution |
| Report | daily_summary, daily_todo |

## Development Commands

```bash
pnpm dev            # Start dev server (Webpack mode — required for node-pty)
pnpm build          # Production build
pnpm test           # Run tests (watch mode)
pnpm test:run       # Run tests (single run)
pnpm db:push        # Sync Prisma schema to database
pnpm db:seed        # Seed initial data
pnpm db:studio      # Open Prisma Studio (database GUI)
pnpm db:init-fts    # Initialize full-text search index
pnpm mcp            # Start MCP Server (standalone process)
```

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Database**: SQLite (Prisma ORM)
- **Terminal**: node-pty + xterm.js + WebSocket
- **Editor**: Monaco Editor
- **Styling**: TailwindCSS 4
- **Drag & Drop**: dnd-kit
- **Testing**: Vitest

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| DATABASE_URL | Database connection string | `file:./prisma/dev.db` (SQLite) |
| PORT | Server port | 3000 |
| TOWER_DATA_DIR | Production data directory | `~/.tower` |

<!-- Internal notes (TODO, pitfalls) moved to .notes/ (gitignored) -->
