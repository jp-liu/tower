# ai-manager

## What This Is

An AI task management platform with a Kanban board UI for managing workspaces, projects, and tasks. Supports AI agent execution (Claude Code) via an adapter system with real-time SSE streaming, prompt template management, and an MCP server exposing 21 tools for external AI agent integration. Features a per-project knowledge base (notes with FTS5 full-text search, asset management) and bilingual (Chinese/English) interface with dark/light/system theme support.

## Core Value

Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base that AI agents can query and update.

## Current Milestone: v0.3 全局搜索增强

**Goal:** 将搜索从固定类型扩展为全局跨类型搜索，新增笔记和资源搜索支持，并为资源增加描述字段提升可搜索性。

**Target features:**
- "All" 全局搜索模式 — 跨所有类型统一内容匹配，结果按类型分组展示
- 笔记搜索 — 利用 FTS5 全文索引搜索笔记标题和内容
- 资源搜索 — 搜索资源文件名和描述
- 资源描述字段 — ProjectAsset 新增必填 description 字段，上传弹窗同步更新
- 保留精确搜索 — 用户可切换到特定类型 tab 进行精准搜索

## Current State

**Shipped:** v0.2 项目知识库 & 智能 MCP (2026-03-30)
- 智能项目识别 (identify_project with confidence-scored fuzzy matching)
- 项目笔记系统 (Markdown editor, FTS5 全文搜索, 预设分类)
- 项目资源管理 (文件上传弹窗, 图片预览, 安全文件服务)
- 21 个 MCP 工具 (含 identify_project, manage_notes, manage_assets)
- 任务消息内联图片渲染
- 笔记/资源页面支持工作区和项目独立切换

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

### Active

- ~~"All" 全局搜索模式 — 跨任务、项目、仓库、笔记、资源统一搜索~~ → Validated in Phase 9
- ~~笔记搜索 — FTS5 全文索引搜索标题和内容~~ → Validated in Phase 9
- ~~资源搜索 — 搜索文件名和描述~~ → Validated in Phase 9
- ~~ProjectAsset 新增必填 description 字段~~ → Validated in Phase 8
- ~~上传弹窗增加描述输入框~~ → Validated in Phase 8
- ~~搜索 UI 扩展 — 新增 All/Note/Asset tab~~ → Validated in Phase 10

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
- ~159 commits, ~11,400 lines across 100 files (v0.1 + v0.2)
- 126+ unit tests, 16 Playwright E2E tests
- 现有 FTS5 全文搜索基础设施（notes_fts 虚拟表）可复用

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
*Last updated: 2026-03-30 after Phase 10 complete — v0.3 milestone complete*
