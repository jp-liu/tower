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
- [ ] **CLI 集成抽象层 — 多 CLI 适配接口规范**
  - **背景：** 当前 hook（SessionStart / PostToolUse）、环境变量注入（TOWER_TASK_ID）、session resume 等机制全部硬编码为 Claude Code。后续需要支持其他 AI CLI（Codex、Gemini CLI、OpenCode 等）
  - **目标：** 定义 CLI Adapter 需要实现的接口，使 Tower 的任务执行、会话恢复、文件捕获、知识沉淀等功能与具体 CLI 解耦
  - **CLI Adapter 接口清单（需实现）：**
    - `spawn(cwd, args, env)` — 启动 CLI 进程（PTY 模式）
    - `resume(sessionId)` — 恢复指定会话（对应 `--resume`）
    - `continue()` — 继续最近会话（对应 `--continue`）
    - `getSessionId()` — 获取当前会话 ID（通过 hook 上报或 stdout 解析）
    - `getHooks()` — 返回需要注册的 hook 配置（不同 CLI 的 hook 格式/位置不同）
    - `installHooks()` — 自动注入 hook 到 CLI 的配置文件
    - `uninstallHooks()` — 卸载 hook
    - `getSettingsPath()` — CLI 配置文件路径（Claude: `~/.claude/settings.json`）
    - `getSessionsDir()` — 会话存储目录
    - `buildEnvOverrides(taskId, apiUrl)` — 构建注入的环境变量
  - **Tower 侧依赖的 CLI 能力：**
    - 环境变量传递（PTY spawn 时注入）
    - Hook 机制（至少支持 session start + tool use 两个时机）
    - 会话持久化 + resume/continue
    - MCP server 支持（Tower MCP 工具链）
  - **参考：** 当前 CliProfile 模型已有 `command`、`baseArgs`、`envVars` 字段，可作为 Adapter 配置基础
- [ ] **总结功能改用 Anthropic API 替代 `claude -p`**
  - **现状：** 小总结（generateSummaryFromLog）和大总结（generateDreamingInsight）都用 `execFile("claude", ["-p", ...])` spawn CLI 子进程，启动开销 3-5s
  - **目标：** 改用 Anthropic SDK 直接调 API（HTTP 请求，~0.5s），小总结用 Haiku（快+便宜），大总结用 Sonnet
  - **前提：** 需要 API Key 管理（目前 Claude 通过 CLI OAuth 认证，没有独立 API Key）。可在 Settings 增加 API Key 配置，或复用 CliProfile 扩展
  - **附带收益：** 消除 `findClaudeBinary()` 依赖，不再需要 CLI 安装就能总结；也为后续多 CLI 场景下的总结解耦
  - **时机：** 等第二个 CLI 需要接入时再做（如 Codex CLI），用 GSD milestone 驱动
  - **原因：** 目前只有 Claude 一个实现，过早抽象容易设计出不匹配实际需求的接口。两个 CLI 对比才能提炼正确的抽象边界。现阶段保持 Claude-specific 代码，TODO 记录接口清单供后续参考

## 踩坑记录

> 后续迁移到项目知识库

### react-reverse-portal 导致 Resume 终端不重连

**现象：** Stop 后点 Resume，终端显示旧内容 + Disconnected，WebSocket 没有重连到新 PTY session。页面刷新后 Resume 正常。

**根因：** 项目使用 `react-reverse-portal` 实现终端跨页面保活（抽屉 ↔ 详情页零重连）。`InPortal` 内的组件**永远不会被 React 卸载**——即使 `OutPortal` 从 DOM 移除，`InPortal` 里的 `TaskTerminal` 仍然活着，保持着旧的 WebSocket 连接。`getPortal(taskId)` 对相同 taskId 返回缓存的旧 instance，不会创建新的 `TaskTerminal`。

**修复：** Resume/Continue 前必须先调 `removePortal(taskId)` 销毁旧 portal instance，再让 `getPortal` 创建全新的 `TaskTerminal`（连接新 PTY 的 WebSocket）。

**教训：** reverse-portal 的保活特性在正常导航场景是优势（零闪烁），但在需要销毁重建的场景（Resume）是陷阱。`setActiveWorktreePath(null)` 只卸载 `OutPortal`，不销毁 `InPortal` 里的组件。必须显式 `removePortal` 才能真正销毁。

### AI 能力使用清单

> 后续 AI Adapter 抽象时，以下所有调用点需统一收敛

| 能力 | 文件 | 调用方式 | 建议模型 | 说明 |
|------|------|----------|----------|------|
| 助手聊天 | `src/app/api/internal/assistant/chat/route.ts` | Agent SDK `query()` | 当前默认 | 多轮对话，带 MCP 工具 |
| 小总结 | `src/lib/claude-session.ts` → `generateSummaryFromLog` | Agent SDK `query()` | Haiku 4.5 | stop 时生成，50 字内中文摘要 |
| 大总结(Dreaming) | `src/lib/claude-session.ts` → `generateDreamingInsight` | Agent SDK `query()` | Sonnet 4.6 | 任务 DONE 时生成，结构化 JSON |
| 项目分析 | `src/actions/project-actions.ts` → `analyzeProjectDirectory` | `execFile("claude", ["-p"])` | 当前默认 | 导入项目时分析目录结构 |
| 任务执行 | `src/actions/agent-actions.ts` → `startPtyExecution` | PTY spawn CLI | 当前默认 | 终端模式，用户交互 |

**后续扩展方向：**
- 支持通过 Settings 配置不同能力使用的模型（`ai.summaryModel`、`ai.dreamingModel`）
- 支持 API Key 直调模式（绕过 CLI spawn，更快更稳定）
- AI Adapter 接口统一收敛 `aiQuery()` 作为唯一入口

### encodePathForClaude 遗漏点号替换

**现象：** `findLatestSessionId` 找错 `~/.claude/projects/` 目录，返回错误的 sessionId，导致 `--resume` 报 "No conversation found"。

**根因：** Claude CLI 编码路径时把 `.` 替换为 `-`（如 `.worktrees` → `-worktrees`），但我们的 `encodePathForClaude` 保留了 `.`。编码结果 `-.worktrees` ≠ CLI 的 `--worktrees`，导致目录名不匹配。

**修复：** 已通过 SessionStart hook 上报 sessionId 彻底绕过目录扫描，不再依赖路径编码。

**教训：** 依赖逆向工程第三方工具的内部编码规则（目录命名、session 存储格式）是脆弱的。优先使用工具提供的官方接口（hook stdin 的 `session_id` 字段）获取信息。
