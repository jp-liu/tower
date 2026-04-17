---
gsd_state_version: 1.0
milestone: v0.92
milestone_name: Global Chat Assistant — 全局悬浮聊天助手
status: defining-requirements
stopped_at: null
last_updated: "2026-04-17"
last_activity: 2026-04-17
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-17)

**Core value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base.
**Current focus:** Defining requirements for v0.92 Global Chat Assistant

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-17 — Milestone v0.92 started

## Accumulated Context

### Decisions

- Global chat widget positioned at bottom-right corner (fixed floating button)
- Operator, not developer — only MCP tools, no Read/Edit/Bash
- Stateless — no chat history table, each open = new session
- cwd = Tower project directory
- Claude CLI with --allowedTools "mcp__tower__*" and --append-system-prompt

### Pending Todos

None.

### Blockers/Concerns

None.
