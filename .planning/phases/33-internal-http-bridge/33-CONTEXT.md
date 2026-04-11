# Phase 33: Internal HTTP Bridge - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

The Next.js server exposes two localhost-only HTTP routes that allow any process (including the MCP stdio process) to read PTY buffer contents and send input to a running PTY session.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

Key constraints from STATE.md:
- HTTP bridge routes return 404 (not 500) when no active session for taskId — clean signal for MCP tools to report "not running"
- Internal HTTP bridge is the only correct MCP↔PTY IPC channel — MCP stdio process has separate globalThis, cannot share in-memory sessions
- Smoke-test that App Router route handlers can import getSession from session-store.ts and see the globalThis.__ptySessions Map populated by instrumentation.ts — not a fresh empty Map

</decisions>

<code_context>
## Existing Code Insights

Key files to examine:
- src/lib/pty/session-store.ts (getSession, globalThis.__ptySessions)
- src/lib/pty/pty-session.ts (PtySession class — buffer access, write method)
- src/instrumentation.ts (where globalThis.__ptySessions is initialized)
- src/app/api/ (existing route handler patterns)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
