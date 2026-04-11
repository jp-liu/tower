# Phase 34: MCP Terminal Tools - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

External orchestrators (Paperclip/OpenClaw) can poll PTY terminal output and inject input into running task sessions via MCP tools.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key constraints:
- MCP tool count must not exceed 30 (currently 21 → target 24 after adding 3 new tools)
- MCP tools use action-dispatch pattern to keep tool count ≤30
- Tools call the Phase 33 HTTP bridge routes (localhost:3000/api/internal/terminal/...)
- MCP stdio process has separate globalThis — must use HTTP bridge, not direct session-store import

</decisions>

<code_context>
## Existing Code Insights

Key files to examine:
- src/mcp/index.ts (MCP server entry point)
- src/mcp/tools/ (Existing tool patterns — workspace, project, task, label, search tools)
- src/app/api/internal/terminal/[taskId]/buffer/route.ts (Phase 33 buffer route)
- src/app/api/internal/terminal/[taskId]/input/route.ts (Phase 33 input route)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
