# Tower

[中文文档](./README.zh.md)

An AI task orchestration platform — manage, dispatch, and execute AI-assisted development tasks through a visual Kanban board.

Integrates terminal, code editor, file tree, live preview, and MCP toolchain into an all-in-one AI development workflow assistant for individual developers.

## Quick Start

### Requirements

- Node.js >= 22
- pnpm (recommended)

### Installation

```bash
git clone <repo-url>
cd ai-manager
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
- Click "Execute" to launch Claude CLI with live output
- Interactive keyboard input — chat with Claude directly
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
    → Claude CLI runs in terminal → Completes (exit 0) → IN_REVIEW
    → Manual review → Pass → DONE / Fail → re-execute
```

- Automatically creates a Git worktree on execution (if baseBranch is set)
- Sends Feishu notification on completion (when configured)
- On failure, task stays IN_PROGRESS for retry

### Project Management

- Selecting a local folder auto-detects Git remote and fills in gitUrl
- Project types: FRONTEND / BACKEND (controls preview availability)
- Git Path Mapping rules: auto-resolve local paths by host + owner

### Settings

| Category | Options |
|----------|---------|
| General | Theme (dark/light/system), Language (zh/en), Default terminal app |
| Terminal | WebSocket port, Idle timeout |
| System | Upload limits, Concurrency, Git timeout, Search parameters |
| CLI Profile | CLI command, Args, Environment variables |
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

### Available Tools (24)

| Category | Tools |
|----------|-------|
| Workspace | list_workspaces, create_workspace, update_workspace, delete_workspace |
| Project | list_projects, create_project, update_project, delete_project |
| Task | list_tasks, create_task, update_task, delete_task, move_task |
| Label | list_labels, create_label, delete_label, set_task_labels |
| Search | search (global search across tasks/projects/repos) |
| Terminal | get_task_terminal_output, send_task_terminal_input, get_task_execution_status |
| Knowledge | identify_project |
| Notes/Assets | manage_notes, manage_assets |

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

## TODO

- [ ] Non-ASCII path support — Claude CLI encodes non-ASCII characters (Chinese, Japanese, etc.) as dashes in session directory names; current matching uses ASCII-only segments as workaround, need to replicate Claude's exact encoding algorithm for reliable session lookup
- [ ] Terminal rendering stability — investigate garbled text when multiple xterm.js terminals run simultaneously (WebGL context conflicts)
- [x] ~~BUG: create_task references 路径不完整~~ — 已修复：refText 改为完整绝对路径 + autoStart prompt 从 DB 重读
- [x] ~~BUG: 助手聊天气泡区域不滚动~~ — 已修复：ScrollArea 加 overflow-hidden
- [x] ~~FEAT: 助手聊天气泡复制按钮~~ — 已实现：assistant bubble hover 显示复制，tool bubble header 显示复制
- [x] ~~FEAT: 助手空状态功能引导~~ — 已实现：4 个 suggestion chips（创建项目/任务/查进度/日报）
