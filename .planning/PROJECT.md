# ai-manager

## What This Is

An AI task management platform with a Kanban board UI for managing workspaces, projects, and tasks. Supports AI agent execution (Claude Code) via an adapter system with real-time SSE streaming, prompt template management, and an MCP server exposing 18 CRUD tools for external AI agent integration. Bilingual (Chinese/English) interface with dark/light/system theme support.

## Core Value

Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration.

## Current Milestone: v0.2 项目知识库 & 智能 MCP

**Goal:** 让 AI 助手通过 MCP 智能识别项目、管理项目知识库（笔记/资源/账号），成为个人多项目信息中枢

**Target features:**
- 智能项目识别（名称、别名、描述模糊匹配）
- 项目笔记系统（Markdown 笔记存 SQLite，预设分类 + 自定义分类，全文搜索）
- 项目资源管理（`data/assets/{projectId}/` 持久化 + `data/cache/{taskId}/` 手动清理）
- MCP 知识库工具集（笔记 CRUD、资源上传 mv、搜索增强）
- 任务消息支持图片附件（MCP 传入路径，mv 到 cache）
- Web 界面：笔记管理、资源查看

## Current State

**Shipped:** v0.1 Settings (2026-03-27)
- Theme switching (Dark/Light/System) with no FOUC
- Language toggle (Chinese/English) with full i18n
- CLI adapter verification with per-check pass/fail results
- Agent prompt CRUD with default enforcement
- Unified AI Tools settings card
- Task execution via Claude CLI with real-time SSE streaming
- Markdown rendering for assistant responses

**Phase 4 complete** (2026-03-27) — Data Layer Foundation
- ProjectNote + ProjectAsset Prisma models with cascade delete
- FTS5 full-text search (trigram tokenizer, Chinese/English)
- Note CRUD server actions with Zod validation + FTS sync
- Asset CRUD server actions with directory management
- File-utils for data/assets/ and data/cache/ directories
- busy_timeout pragma on both PrismaClient instances

**Phase 5 complete** (2026-03-27) — MCP Knowledge Tools
- identify_project tool with confidence-scored fuzzy matching (name > alias > desc)
- manage_notes action-dispatch tool (6 actions: create/update/delete/get/list/search + FTS sync)
- manage_assets action-dispatch tool (4 actions: add/delete/list/get + EXDEV fallback)
- All 3 tools registered in server.ts (total: 21 MCP tools, ceiling: 30)
- 39 MCP tests passing

**Phase 6 complete** (2026-03-27) — File Serving & Image Rendering
- Secure file serving route at /api/files/assets/[projectId]/[filename]
- Path traversal prevention (resolve + startsWith guard)
- ReactMarkdown img override for inline image display in task conversations
- localPathToApiUrl transforms data/assets/ paths to API URLs
- 21 tests passing (14 file-serving + 7 path-transform)

**Phase 7 complete** (2026-03-27) — Notes & Assets Web UI
- Notes page at /workspaces/[workspaceId]/notes with category filter and Markdown editor
- Assets page at /workspaces/[workspaceId]/assets with upload, preview, delete
- 46 i18n keys (zh/en) for notes and assets
- Sidebar navigation links for Notes and Assets
- 24 component unit tests passing

## Requirements

### Validated

- ✓ Workspace CRUD with cascade delete — pre-v0.1
- ✓ Project CRUD with GIT/NORMAL type auto-detection — pre-v0.1
- ✓ Task CRUD with Kanban board drag-and-drop — pre-v0.1
- ✓ Label system with builtin and custom workspace labels — pre-v0.1
- ✓ AI agent execution via Claude Code adapter with SSE streaming — pre-v0.1
- ✓ MCP server with 18 CRUD tools — pre-v0.1
- ✓ Bilingual i18n (Chinese/English) — pre-v0.1
- ✓ Dark/Light/System theme switching — v0.1
- ✓ Settings navigation (General/AI Tools/Prompts) — v0.1
- ✓ General settings panel with theme and language toggles — v0.1
- ✓ CLI adapter verification with per-check results — v0.1
- ✓ Agent prompt CRUD with default enforcement — v0.1
- ✓ Task panel prompt selector — v0.1
- ✓ Task execution wired to CLI via SSE stream — v0.1

### Active

(Defined in REQUIREMENTS.md for v0.2)

### Out of Scope

- Authentication/authorization — localhost-only tool, not needed for v1
- Real-time collaboration — single-user tool
- Mobile app — web-first
- Offline mode — real-time agent execution is core value

## Context

- Next.js 16 App Router monolith with Server Components + Server Actions
- SQLite via Prisma ORM (single-file, no external DB server)
- Tailwind CSS v4 with @tailwindcss/typography for markdown
- next-themes for FOUC-free theme switching
- Adapter pattern for pluggable AI agent execution
- 98 commits, ~6800 lines added across 53 files in v0.1

## Constraints

- **Tech stack**: Next.js 16, React 19, Prisma 6, SQLite, TypeScript
- **Runtime**: Node.js 18.18+, pnpm
- **Localhost-only**: No auth required, designed for local development use
- **i18n**: All user-facing strings must support zh/en
- **Security**: CLI skip-permissions gated by env var `CLAUDE_SKIP_PERMISSIONS`

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
| Notes in SQLite over local .md files | MCP can CRUD directly, supports search, ties to project lifecycle | ✓ Good — Phase 4 |
| data/ directory for assets & cache | Centralized file storage managed by ai-manager, not scattered across project paths | ✓ Good — Phase 4 |
| File transfer via mv (not base64/upload) | Local-only tool, file system is natural transfer channel | — Pending |
| FTS5 with trigram tokenizer + LIKE fallback | Trigram handles Chinese/English 3+ char queries, LIKE covers short queries | ✓ Good — Phase 4 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-27 after Phase 7 (Notes & Assets Web UI) completed — v0.2 milestone complete*
