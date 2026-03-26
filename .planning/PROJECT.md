# ai-manager

## What This Is

An AI task management platform with a Kanban board UI for managing workspaces, projects, and tasks. Supports AI agent execution (Claude Code) via an adapter system, with an MCP server exposing 18 CRUD tools for external AI agent integration. Bilingual (Chinese/English) interface.

## Core Value

Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration.

## Requirements

### Validated

- Workspace CRUD with cascade delete to projects/tasks
- Project CRUD with GIT/NORMAL type auto-detection
- Task CRUD with Kanban board drag-and-drop status management
- Label system with builtin and custom workspace labels
- Task filtering by project, priority, label, and search
- AI agent execution via Claude Code adapter with SSE streaming
- Task messaging (user/assistant/system messages)
- MCP server with 18 CRUD tools for external AI integration
- Global search across tasks, projects, and repositories
- Bilingual i18n (Chinese/English)
- Task archive — auto-hide completed tasks, archive page
- Agent config management (default model, append prompt)
- Settings page with AI Tools configuration
- Repository management and git operations (branch, clone, status)
- Filesystem browsing for project path selection
- Dark/Light/System theme switching with next-themes — validated in Phase 1
- Settings page restructured navigation (General/AI Tools/Prompts) — validated in Phase 1
- General settings panel with theme and language toggles — validated in Phase 1

### Active

(See Current Milestone below)

## Current Milestone: v0.1 Settings 设置功能

**Goal:** 重构设置页面，提供完整的通用设置、AI 工具接入验证和 Agent 提示词管理

**Target features:**
- 通用设置：主题切换、语言切换、外观偏好持久化
- AI 工具 CLI 接入验证：调用 testEnvironment()，展示 CLI 可用状态
- Agent 提示词管理：提示词的增删改查 UI
- 任务创建时选择 Agent 提示词

### Out of Scope

- Authentication/authorization — localhost-only tool, not needed for v1
- Real-time collaboration — single-user tool
- Mobile app — web-first

## Context

- Next.js 16 App Router monolith with Server Components + Server Actions
- SQLite via Prisma ORM (single-file, no external DB server)
- Zustand for ephemeral client state
- Adapter pattern for pluggable AI agent execution
- Settings page exists with AI Tools config; Skills and Plugins sections are placeholders ("开发中")
- No test coverage beyond minimal smoke tests
- No database migration strategy (uses `prisma db push`)

## Constraints

- **Tech stack**: Next.js 16, React 19, Prisma 6, SQLite, TypeScript
- **Runtime**: Node.js 18.18+, pnpm
- **Localhost-only**: No auth required, designed for local development use
- **i18n**: All user-facing strings must support zh/en

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SQLite over PostgreSQL | Single-user local tool, no external DB needed | ✓ Good |
| Server Actions over REST API | Next.js 16 convention, simpler data mutations | ✓ Good |
| MCP server as separate process | Avoid coupling with Next.js lifecycle | ✓ Good |
| Adapter pattern for agents | Pluggable AI agent support | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check -- still the right priority?
3. Audit Out of Scope -- reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-26 after Phase 1 completion*
