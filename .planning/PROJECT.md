# ai-manager

## What This Is

An AI task management platform with a Kanban board UI for managing workspaces, projects, and tasks. Supports AI agent execution (Claude Code) via an adapter system with real-time SSE streaming, prompt template management, and an MCP server exposing 18 CRUD tools for external AI agent integration. Bilingual (Chinese/English) interface with dark/light/system theme support.

## Core Value

Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration.

## Current State

**Shipped:** v0.1 Settings (2026-03-27)
- Theme switching (Dark/Light/System) with no FOUC
- Language toggle (Chinese/English) with full i18n
- CLI adapter verification with per-check pass/fail results
- Agent prompt CRUD with default enforcement
- Unified AI Tools settings card
- Task execution via Claude CLI with real-time SSE streaming
- Markdown rendering for assistant responses

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

(Defined in next milestone)

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

---
*Last updated: 2026-03-27 after v0.1 milestone*
