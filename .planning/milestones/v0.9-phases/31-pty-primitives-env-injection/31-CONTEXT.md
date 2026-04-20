# Phase 31: PTY Primitives & Env Injection - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

PTY sessions accept per-session environment overrides and detect idle state; `startPtyExecution` and `resumePtyExecution` read from `CliProfile` instead of hardcoded strings.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key constraints from STATE.md:
- envOverrides passed directly to pty.spawn() env param — NEVER mutate process.env for per-session vars (prevents concurrent session contamination)
- Idle detection threshold minimum 180s — Claude silent reasoning (30-120s) must not trigger false positive
- CliProfile uses `baseArgs` field name (not `buildArgs`)

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research.

Key files to examine:
- src/lib/pty/pty-session.ts (PTY session class)
- src/lib/pty/session-store.ts (session registry)
- src/lib/pty/ws-server.ts (WebSocket server)
- src/actions/agent-actions.ts (startPtyExecution, resumePtyExecution)
- prisma/schema.prisma (CliProfile model from Phase 30)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
