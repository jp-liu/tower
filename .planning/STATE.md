---
gsd_state_version: 1.0
milestone: v0.3
milestone_name: 全局搜索增强
status: defining_requirements
stopped_at: Milestone started
last_updated: "2026-03-30"
last_activity: 2026-03-30
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-30)

**Core value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base.
**Current focus:** Defining requirements for v0.3 全局搜索增强

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-30 — Milestone v0.3 started

## Accumulated Context

### Decisions

- [Pre-v0.2]: FTS5 virtual tables must be created via raw SQL AFTER prisma db push — never before, or Prisma detects schema drift
- [Pre-v0.2]: Both PrismaClient instances (Next.js + MCP) need PRAGMA busy_timeout=5000 to prevent "database is locked" errors
- [Pre-v0.2]: MCP tools use action-dispatch pattern (manage_notes, manage_assets) to keep total tool count at or below 30
- [Pre-v0.2]: file-utils.ts and fts.ts must never import Next.js modules — they are shared between Next.js and MCP stdio processes
- [Phase 07]: Used textarea+ReactMarkdown fallback instead of @uiw/react-md-editor — React 19 compat concern validated
- [Phase 07]: Upload dialog with workspace/project selector — user can upload to any project without switching list view

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-03-30
Stopped at: Milestone v0.3 started
Resume file: None
