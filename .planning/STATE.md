---
gsd_state_version: 1.0
milestone: v0.92
milestone_name: Global Chat Assistant
status: verifying
stopped_at: Completed 39-polish-settings 39-02-PLAN.md
last_updated: "2026-04-17T12:12:12.318Z"
last_activity: 2026-04-17
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 8
  completed_plans: 8
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-17)

**Core value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base.
**Current focus:** Phase 39 — polish-settings

## Current Position

Phase: 39
Plan: Not started
Status: Phase complete — ready for verification
Last activity: 2026-04-17

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0 (this milestone)
- Average duration: -
- Total execution time: -

## Accumulated Context

### Decisions

- Global chat assistant positioned in top-bar next to search box (icon + keyboard shortcut)
- Operator, not developer — only MCP tools, no Read/Edit/Bash
- Stateless — no chat history table, each open = new session
- cwd = Tower project directory
- Claude CLI with --allowedTools "mcp__tower__*" and --append-system-prompt
- Two display modes: sidebar (left panel) + dialog (centered modal)
- Two communication modes: terminal (xterm) + chat (parsed Markdown bubbles)
- [Phase 36-assistant-backend]: ASSISTANT_SESSION_KEY exported as constant for downstream imports (ws-server, API routes)
- [Phase 36-assistant-backend]: No AI_MANAGER_TASK_ID in assistant envOverrides — assistant is stateless and not bound to any task
- [Phase 36-assistant-backend]: vitest include pattern extended to cover src/**/__tests__/**/*.test.{ts,tsx}
- [Phase 36-assistant-backend]: ASSISTANT_SESSION_KEY imported from @/lib/assistant-constants in ws-server.ts and route.ts to avoid use server module boundary issues
- [Phase 36-assistant-backend]: Internal assistant API does not call validateTaskId — __assistant__ is not CUID format
- [Phase 37-terminal-mode-ui]: toggleAssistant checks both isOpen and isStarting to prevent double-start during loading
- [Phase 37-terminal-mode-ui]: openAssistant sets worktreePath before isOpen=true to ensure terminal mounts after path is available
- [Phase 37-terminal-mode-ui]: LayoutInner inner component pattern used to call useAssistant() inside AssistantProvider boundary
- [Phase 38-chat-mode]: parseLines exported as pure function for testing without WS mock
- [Phase 38-chat-mode]: communicationMode separates layout mode (displayMode) from terminal/chat communication mode
- [Phase 38-chat-mode]: Thinking bubble renders pulsing dots unconditionally — role=thinking in messages array handles visibility
- [Phase 39-polish-settings]: Call useI18n() directly in ThinkingBubble and ToolBubble sub-components rather than prop-drilling t() from parent
- [Phase 39-polish-settings]: Sidebar uses w-[30vw] clamped with min-w-[320px] and max-w-[480px] instead of fixed w-[420px]

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-04-17T12:09:31.886Z
Stopped at: Completed 39-polish-settings 39-02-PLAN.md
Resume file: None
