# ai-manager

## What This Is

An AI task management platform with a Kanban board UI for managing workspaces, projects, and tasks. Supports AI agent execution (Claude Code) via an adapter system with real-time SSE streaming, prompt template management, and an MCP server exposing 21 tools for external AI agent integration. Features a per-project knowledge base (notes with FTS5 full-text search, asset management) and bilingual (Chinese/English) interface with dark/light/system theme support.

## Core Value

Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base that AI agents can query and update.

## Current Milestone: v0.5 Git Worktree 任务隔离

**Goal:** 每个任务在独立的 git worktree 中执行，实现并行开发、逐个合并验证、不满意可退回重做。

**Target features:**
- 创建任务时选择 base branch（从项目 git branches 列表）
- 任务执行前自动创建 worktree + 独立分支 task/{taskId}
- Claude CLI 在 worktree 目录中执行（同项目并行无冲突）
- 任务完成后 IN_REVIEW，用户可查看 diff、squash merge 验证
- 验证不通过退回 IN_PROGRESS，Claude 在同一 worktree 继续修改
- Worktree 生命周期管理（DONE/CANCELLED 后清理）
- 移除无用的 git.branchTemplate 配置项

## Current State

**Phase 18 complete** (2026-03-31): Worktree lifecycle — auto-cleanup on DONE/CANCELLED (removeWorktree with --force, branch deletion, existence guards), startup prune via instrumentation.ts register() hook for orphaned worktrees

**Phase 17 complete** (2026-03-31): Review & merge workflow — IN_REVIEW auto-transition on execution success, diff API with per-file structured output, squash merge with conflict detection via git merge-tree, send-back flow reusing existing worktree, dedicated task page with diff view + merge dialog, drawer enhancements

**Phase 16 complete** (2026-03-31): Worktree execution engine — auto-create worktree + branch at execution start, cwd switch to worktree, base branch selector UI in create-task dialog

**Phase 15 complete** (2026-03-31): Schema fields added (baseBranch, worktreePath, worktreeBranch), branch listing API, branchTemplate config removed

**Shipped:** v0.4 系统配置化 (2026-03-30)
- SystemConfig key-value 数据模型 + 通用配置读写 API
- Git 路径映射规则可配置（设置页 CRUD）
- 系统参数配置 UI（上传限制、并发数、Git 超时、分支模板、搜索参数）
- 搜索逻辑去重（search.ts 共享模块）+ 竞态条件修复 + 配置实时生效

**Shipped:** v0.3 全局搜索增强 (2026-03-30)
- 六 tab 全局搜索 (All/Task/Project/Repository/Note/Asset)
- 笔记 FTS5 全文搜索 + 恶意查询自动降级 LIKE
- 资源搜索 (文件名 + 描述)
- "All" 模式 Promise.allSettled 跨类型聚合，按类型分组展示
- 搜索结果 snippet 预览 (笔记内容 80 字 / 资源描述)
- 资源描述字段 + 上传弹窗必填描述
- MCP search 工具同步支持 note/asset/all
- 搜索结果智能跳转 (笔记→笔记页, 资源→资源页)

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

### Active

No active requirements — v0.5 milestone complete.

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
*Last updated: 2026-03-31 — Phase 18 complete, v0.5 milestone complete*
