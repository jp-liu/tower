# Phase 14: Search Quality & Realtime Config - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 14-search-quality-realtime-config
**Areas discussed:** Search module structure, Race condition fix, Realtime config mechanism

---

## Search Module Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Accept config params (DI) | search.ts takes config as function arguments — stays framework-agnostic | ✓ |
| Read config internally | search.ts imports config-reader directly — simpler API but couples to DB | |
| No config in search.ts | Keep config reading in each caller, only extract query logic | |

**User's choice:** [auto] Accept config params (dependency injection) — recommended default
**Notes:** Keeps search.ts free of DB/Next.js imports. Both server actions (config-actions) and MCP tools (config-reader) resolve config before calling search().

| Option | Description | Selected |
|--------|-------------|----------|
| MCP uses configurable values | MCP tools read config via config-reader.ts | ✓ |
| MCP keeps hardcoded defaults | MCP tools ignore user config, use fixed values | |

**User's choice:** [auto] MCP uses configurable values — recommended default
**Notes:** Eliminates all hardcoded search limits. MCP agents respect user preferences.

---

## Race Condition Fix

| Option | Description | Selected |
|--------|-------------|----------|
| Cancelled flag | `let cancelled = false` in useEffect, check before setState | ✓ |
| AbortController | AbortController to cancel fetch — more thorough but more complex | |
| useRef counter | Increment counter, check if still current before setState | |

**User's choice:** [auto] Cancelled flag in useEffect cleanup — recommended default
**Notes:** Standard React pattern. Simple, effective, no new dependencies.

---

## Realtime Config Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Re-fetch on activate | Client components re-fetch config each time dialog opens / component mounts | ✓ |
| React Context + polling | ConfigProvider that periodically refreshes config values | |
| Server Component props | Pass config from Server Component on each navigation | |
| No change needed | Server-side is already per-request; accept client caching | |

**User's choice:** [auto] Re-fetch on activate — recommended default
**Notes:** Server-side already realtime. Client components move config fetch into activation effects (e.g., dialog open). No complex infrastructure needed for localhost single-user tool.

---

## Claude's Discretion

- AbortController as optional enhancement to cancelled flag
- Internal function decomposition in search.ts
- Whether search-actions.ts re-exports globalSearch name for backwards compatibility

## Deferred Ideas

None — discussion stayed within phase scope.
