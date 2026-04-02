# ai-manager

## What This Is

An AI task management platform with a Kanban board UI for managing workspaces, projects, and tasks. Supports AI agent execution (Claude Code) via an adapter system with real-time SSE streaming, prompt template management, and an MCP server exposing 21 tools for external AI agent integration. Features a per-project knowledge base (notes with FTS5 full-text search, asset management), bilingual (Chinese/English) interface with dark/light/system theme support, git worktree task isolation with review/merge workflow, and a full-featured task development workbench with Monaco code editor, file tree browser, diff view, and live preview panel.

## Core Value

Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base that AI agents can query and update.

## Shipped: v0.6 任务开发工作台 (2026-04-01)

**Delivered:** 每个任务拥有专属的全功能开发工作台页面，集成 AI 聊天、Monaco 代码编辑器、文件树浏览、Diff 查看和实时预览。

**Key features shipped:**
- 任务抽屉"查看详情"跳转到任务专属工作台页面
- 可调整大小的面板布局（左侧 AI 聊天 + 右侧三标签面板）
- Monaco Editor 在线代码编辑（语法高亮、多标签页、Ctrl+S 保存、dirty 标记、主题同步）
- 文件树浏览器（gitignore 过滤、git M/A/D 状态标记、右键 CRUD、执行时自动刷新）
- Diff 变更查看（复用 v0.5 TaskDiffView 组件）
- Preview 预览面板（地址栏 + iframe、启动命令、终端打开、保存后自动刷新）
- 项目类型区分（前端/后端）+ 终端应用配置

## Current State

**Shipped:** v0.6 任务开发工作台 (2026-04-01)
- Phase 19-23: workbench layout, file tree, Monaco editor, diff view, preview panel

**Shipped:** v0.5 Git Worktree 任务隔离 (2026-03-31)
- Phase 15-18: worktree schema, execution engine, review/merge workflow, lifecycle management

**Shipped:** v0.4 系统配置化 (2026-03-30)
- SystemConfig 数据模型 + Git 路径映射 + 系统参数配置 UI + 搜索去重优化

**Shipped:** v0.3 全局搜索增强 (2026-03-30)
- 六 tab 全局搜索 + FTS5 + 资源搜索 + snippet 预览 + MCP 同步

<details>
<summary>v0.2 项目知识库 & 智能 MCP (shipped 2026-03-30)</summary>

- 智能项目识别 (identify_project with confidence-scored fuzzy matching)
- 项目笔记系统 (Markdown editor, FTS5 全文搜索, 预设分类)
- 项目资源管理 (文件上传弹窗, 图片预览, 安全文件服务)
- 21 个 MCP 工具 (含 identify_project, manage_notes, manage_assets)
- 任务消息内联图片渲染
- 笔记/资源页面支持工作区和项目独立切换

</details>

<details>
<summary>v0.1 Settings (shipped 2026-03-27)</summary>

- Theme switching (Dark/Light/System) with no FOUC
- Language toggle (Chinese/English) with full i18n
- CLI adapter verification with per-check pass/fail results
- Agent prompt CRUD with default enforcement
- Task execution via Claude CLI with real-time SSE streaming

</details>

## Requirements

### Validated

- ✓ Workspace CRUD with cascade delete — pre-v0.1
- ✓ Project CRUD with GIT/NORMAL type auto-detection — pre-v0.1
- ✓ Task CRUD with Kanban board drag-and-drop — pre-v0.1
- ✓ Label system with builtin and custom workspace labels — pre-v0.1
- ✓ AI agent execution via Claude Code adapter with SSE streaming — pre-v0.1
- ✓ MCP server with CRUD tools — pre-v0.1
- ✓ Bilingual i18n (Chinese/English) — pre-v0.1
- ✓ Dark/Light/System theme switching — v0.1
- ✓ Settings navigation (General/AI Tools/Prompts) — v0.1
- ✓ CLI adapter verification with per-check results — v0.1
- ✓ Agent prompt CRUD with default enforcement — v0.1
- ✓ Task panel prompt selector — v0.1
- ✓ 智能项目识别 (名称/别名/描述模糊匹配 + 置信度) — v0.2
- ✓ 项目笔记 CRUD with Markdown + FTS5 全文搜索 — v0.2
- ✓ 笔记预设分类 (账号/环境/需求/备忘) + 自定义分类 — v0.2
- ✓ 项目资源上传/管理 (data/assets/ 持久化) — v0.2
- ✓ 任务级临时文件 (data/cache/) — v0.2
- ✓ MCP manage_notes action-dispatch 工具 — v0.2
- ✓ MCP manage_assets 工具 (含 EXDEV fallback) — v0.2
- ✓ 安全文件服务路由 (防路径穿越) — v0.2
- ✓ 笔记管理 Web UI (列表/编辑器/分类筛选) — v0.2
- ✓ 资源查看 Web UI (文件列表/预览/上传弹窗) — v0.2
- ✓ 任务消息图片内联渲染 — v0.2
- ✓ ProjectAsset description 字段 + 上传弹窗描述输入框 — v0.3 Phase 8
- ✓ 全局搜索 note/asset/all 模式 + MCP 工具同步 + FTS5 容错 — v0.3 Phase 9
- ✓ 搜索 UI 六 tab + 分组 All 渲染 + snippet 显示 + i18n — v0.3 Phase 10
- ✓ SystemConfig 数据模型 + 通用配置读写 — v0.4 Phase 11
- ✓ Git 路径映射规则可配置（设置页 CRUD）— v0.4 Phase 12
- ✓ 系统参数配置 UI（上传限制、并发数、Git 超时、分支模板）— v0.4 Phase 13
- ✓ 搜索参数配置（结果数量、防抖、snippet 长度）— v0.4 Phase 13

- ✓ 搜索逻辑去重（search.ts 共享模块）— v0.4 Phase 14
- ✓ 搜索 useEffect 竞态条件修复（cancelled flag）— v0.4 Phase 14
- ✓ 配置变更实时生效（无需重启）— v0.4 Phase 14
- ✓ Task.baseBranch + TaskExecution.worktreePath/worktreeBranch schema fields — v0.5 Phase 15
- ✓ Branch listing API (getProjectBranches server action) — v0.5 Phase 15
- ✓ 移除 git.branchTemplate 配置项 — v0.5 Phase 15
- ✓ 创建任务时选择 base branch (UI) — v0.5 Phase 16
- ✓ 任务执行前自动创建 worktree + task 分支 — v0.5 Phase 16
- ✓ 执行 cwd 切换到 worktree 目录 — v0.5 Phase 16
- ✓ 任务面板 diff 查看 + squash merge 操作 — v0.5 Phase 17
- ✓ IN_REVIEW → IN_PROGRESS 退回重做流程 — v0.5 Phase 17
- ✓ Worktree 清理（DONE/CANCELLED）— v0.5 Phase 18
- ✓ 应用启动时清理孤立 worktree — v0.5 Phase 18

- ✓ 任务抽屉"查看详情"入口 → 任务专属工作台页面 — v0.6 Phase 19
- ✓ 工作台可调整大小面板布局（AI 聊天 + 三标签面板）— v0.6 Phase 19
- ✓ 文件树浏览器（gitignore 过滤、git 状态、右键 CRUD、自动刷新）— v0.6 Phase 20
- ✓ Monaco 在线代码编辑器（语法高亮、多标签、Ctrl+S、dirty、主题）— v0.6 Phase 21
- ✓ Diff 变更查看标签页 — v0.6 Phase 22
- ✓ Preview 预览面板（地址栏 + iframe + 启动命令 + 终端打开 + 自动刷新）— v0.6 Phase 23
- ✓ 项目类型区分（前端/后端）— v0.6 Phase 23
- ✓ 终端应用配置（Settings > General）— v0.6 Phase 23

## Current Milestone: v0.7 终端交互体验

**Goal:** 将任务执行界面从 SSE 聊天气泡替换为真正的浏览器内终端（node-pty + WebSocket + xterm.js），用户在网页上看到的和本地运行 Claude Code 完全一样。

**Target features:**
- node-pty 创建 PTY 伪终端，Claude CLI 运行在真实 TTY 环境中
- WebSocket API route 双向流式通信（替代当前 SSE 单向推送）
- xterm.js 浏览器终端组件替换聊天气泡（带颜色、光标、交互输入）
- 终端会话管理（创建/销毁/重连）
- v0.6 遗留 bug 修复（编辑器稳定性、Diff 显示条件等）

### Active

- [ ] PTY 终端后端（node-pty + 会话管理）
- [ ] WebSocket API route 双向通信
- [ ] xterm.js 终端组件替换聊天气泡
- [ ] 终端会话生命周期管理（创建/销毁/重连）
- [ ] v0.6 遗留 bug 修复

### Out of Scope

- Authentication/authorization — localhost-only tool, not needed
- Real-time collaboration — single-user tool
- Mobile app — web-first
- Offline mode — real-time agent execution is core value
- 笔记内容加密/脱敏 — 本地工具，单用户
- 语义搜索 (embeddings) — FTS5 足够满足当前需求
- 笔记文件夹嵌套 — 分类已足够
- 自动 cache 清理 — 用户要求手动清理

## Context

- Next.js 16 App Router monolith with Server Components + Server Actions
- SQLite via Prisma ORM with FTS5 full-text search (trigram tokenizer)
- Tailwind CSS v4 with @tailwindcss/typography for markdown
- next-themes for FOUC-free theme switching
- Adapter pattern for pluggable AI agent execution
- ~180 commits across v0.1-v0.3
- 190 unit/component tests, 23 Playwright E2E tests
- FTS5 全文搜索基础设施 (notes_fts) + 全局搜索 6 类型支持

## Constraints

- **Tech stack**: Next.js 16, React 19, Prisma 6, SQLite, TypeScript
- **Runtime**: Node.js 18.18+, pnpm
- **Localhost-only**: No auth required, designed for local development use
- **i18n**: All user-facing strings must support zh/en
- **Security**: CLI skip-permissions gated by env var `CLAUDE_SKIP_PERMISSIONS`
- **MCP tool ceiling**: ≤30 tools (currently 21)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SQLite over PostgreSQL | Single-user local tool, no external DB needed | ✓ Good |
| Server Actions over REST API | Next.js 16 convention, simpler data mutations | ✓ Good |
| MCP server as separate process | Avoid coupling with Next.js lifecycle | ✓ Good |
| Adapter pattern for agents | Pluggable AI agent support | ✓ Good |
| next-themes for theme switching | Avoids FOUC, handles system preference | ✓ Good |
| stream-json + SSE for execution | Real-time CLI output with clean parsing | ✓ Good |
| --dangerously-skip-permissions via env var | Enables autonomous execution while keeping security configurable | ✓ Good |
| Notes in SQLite over local .md files | MCP can CRUD directly, supports search, ties to project lifecycle | ✓ Good — v0.2 |
| data/ directory for assets & cache | Centralized file storage managed by ai-manager | ✓ Good — v0.2 |
| FTS5 trigram + LIKE fallback | Chinese/English 3+ char queries + short query coverage | ✓ Good — v0.2 |
| Action-dispatch MCP pattern | Keep tool count low (manage_notes, manage_assets vs 10+ tools) | ✓ Good — v0.2 |
| textarea + react-markdown over @uiw/react-md-editor | React 19 compatibility, simpler hydration | ✓ Good — v0.2 |
| File transfer via mv (not base64) | Local tool, file system is natural transfer channel | ✓ Good — v0.2 |
| Upload dialog with workspace/project selector | User can upload to any project without switching list view | ✓ Good — v0.2 |
| Nullable description `String? @default("")` | Avoids NOT NULL constraint on existing rows during schema migration | ✓ Good — v0.3 |
| Inline raw SQL for global note search | fts.ts must stay Next.js-free; global search needs different JOINs | ✓ Good — v0.3 |
| Promise.allSettled for "all" mode | Single SQLITE_BUSY must not drop all results | ✓ Good — v0.3 |
| FTS5 try/catch with LIKE fallback | Malformed queries degrade gracefully instead of crashing | ✓ Good — v0.3 |
| path.basename + DB validation in uploadAsset | Prevents path traversal via crafted filenames or projectIds | ✓ Good — v0.3 |
| react-resizable-panels@^2.x (not v4) | v4 has breaking export renames incompatible with shadcn | ✓ Good — v0.6 |
| Monaco Editor via @monaco-editor/react with CDN loader | Turbopack incompatible with webpack plugin; CDN avoids bundling issues | ✓ Good — v0.6 |
| safeResolvePath utility for all file ops | Centralized path traversal prevention, reused across file-actions and editor | ✓ Good — v0.6 |
| Custom file tree (no library) | No well-maintained React 19 file tree library; ~80 line recursive component is simpler | ✓ Good — v0.6 |
| child_process.spawn for preview (not WebContainers) | Localhost-only tool, Node.js already running — spawn is simpler and more reliable | ✓ Good — v0.6 |
| ProjectCategory enum (not reusing ProjectType) | Avoids collision with existing NORMAL/GIT enum | ✓ Good — v0.6 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions

**After each milestone:**
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-02 — v0.7 milestone started*
