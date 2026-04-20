# Phase 58: Session Dreaming - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous --auto)

<domain>
## Phase Boundary

Automatic insight extraction after task execution ends: background AI analysis produces structured JSON, optionally creates a ProjectNote linked to the execution, visible in the timeline and daily reports.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — --auto mode. Key architectural guidance:

- Extend `captureExecutionSummary` in `src/lib/execution-summary.ts` with a Phase 3 for dreaming
- Use the existing `generateSummaryFromLog` pattern (AI call → update DB)
- Schema: add `insightNoteId` (nullable FK → ProjectNote) to TaskExecution
- ProjectNote needs `category` field (already exists: check schema)
- Trigger: after Phase 2 (AI summary) completes, run the dreaming analysis
- Output: structured JSON with `{ summary, insights: [{type, content}], shouldCreateNote }`
- Daily report: extend `getDailySummary` to include session-insight notes

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/execution-summary.ts` — captureExecutionSummary with Phase 1 (git) and Phase 2 (AI summary)
- `src/lib/claude-session.ts` — generateSummaryFromLog (AI analysis of terminal output)
- `src/actions/agent-actions.ts` — task execution management
- `src/mcp/tools/note-asset-tools.ts` — note CRUD via MCP
- `src/mcp/tools/report-tools.ts` — daily_summary and daily_todo

### Established Patterns
- Background fire-and-forget with `.then().catch()` (see Phase 2 in execution-summary.ts)
- Prisma schema + `pnpm db:push` for schema changes
- JSON fields for structured data in SQLite

### Integration Points
- `src/lib/pty/session-store.ts` — calls captureExecutionSummary on session exit
- Task detail page — execution timeline UI
- MCP report tools — daily_summary

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
