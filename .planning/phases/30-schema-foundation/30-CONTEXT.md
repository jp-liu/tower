# Phase 30: Schema Foundation - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

The database has a `CliProfile` table with a seeded default row and `TaskExecution` has a `callbackUrl` field; the Prisma client is regenerated and ready for application code.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key constraints from STATE.md:
- CliProfile uses `baseArgs` field name (not `buildArgs`) — aligns with agent-actions.ts call site semantics
- Confirm CliProfile field name is `baseArgs` before writing migration — avoid follow-up rename migration

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
