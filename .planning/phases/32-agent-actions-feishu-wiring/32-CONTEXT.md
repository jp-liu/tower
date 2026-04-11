# Phase 32: Agent Actions & Feishu Wiring - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Claude completions trigger a Feishu notification with structured task metadata; the notification only fires for ai-manager-dispatched sessions, not manual Claude runs.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key constraints from STATE.md:
- Read `~/.claude/hooks/notify-agi.sh` before implementing — exact argument interface and SESSION_ID availability must be confirmed before coding
- notify-agi.sh must check AI_MANAGER_TASK_ID at entry — no env var means manual Claude session, exit silently
- AI_MANAGER_TASK_ID is already injected by Phase 31 into every PTY session

</decisions>

<code_context>
## Existing Code Insights

Key files to examine:
- ~/.claude/hooks/notify-agi.sh (if exists — current hook implementation)
- ~/.claude/settings.json (current hooks configuration)
- src/actions/agent-actions.ts (PTY execution with env injection from Phase 31)
- src/lib/pty/ws-server.ts (onExit handler — where completion is detected)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
