# Phase 14: Search Quality & Realtime Config - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Mode:** auto (all gray areas auto-resolved with recommended defaults)

<domain>
## Phase Boundary

Three technical improvements: (1) extract shared search logic from server actions and MCP tools into a single `src/lib/search.ts` module, (2) fix race condition in search dialog's debounced useEffect, (3) make config changes take effect immediately in the running app without restart or page reload.

</domain>

<decisions>
## Implementation Decisions

### Search Module Extraction
- **D-01:** Create `src/lib/search.ts` with a `search(query, category, config)` function that accepts config params as arguments (dependency injection). The module must NOT import Next.js modules or `config-actions.ts` — it stays framework-agnostic like `fts.ts`.
- **D-02:** Config params passed as an object: `{ resultLimit: number, allModeCap: number, snippetLength: number }`. Both callers resolve config before calling search.
- **D-03:** `search-actions.ts` delegates to `search.ts` — reads config via `getConfigValues()` (server action), then passes params to `search()`.
- **D-04:** `search-tools.ts` delegates to `search.ts` — reads config via `config-reader.ts` (`getConfigValueDirect`), then passes params to `search()`. MCP tools now respect user-configured values instead of hardcoded defaults.
- **D-05:** Move `NoteRawRow`, `toNoteResult`, and the `SearchResult`/`SearchCategory` types into `search.ts` as the single source of truth. Both `search-actions.ts` and `search-tools.ts` re-export types from `search.ts`.

### Race Condition Fix
- **D-06:** Add a `cancelled` flag in the debounced search `useEffect` cleanup. Pattern: `let cancelled = false` at effect start, check `if (!cancelled)` before `setResults()`, set `cancelled = true` in cleanup function.
- **D-07:** Also set `setIsSearching(false)` inside the cancelled check — prevents loading spinner from getting stuck when a request completes after cancellation.

### Realtime Config Mechanism
- **D-08:** Server-side consumers (search-actions, asset-actions, process-manager, execute) already read from DB per request — no change needed, already realtime.
- **D-09:** Client-side components re-fetch config each time they activate (dialog opens, component mounts), not just on initial mount. For `search-dialog.tsx`: move config fetch into the `open` effect so debounceMs reloads each time the dialog opens.
- **D-10:** For `task-detail-panel.tsx`: branch template loads on mount — acceptable since the panel remounts when switching tasks. No additional realtime mechanism needed.
- **D-11:** No React Context, polling, or WebSocket needed for config refresh at this scale. The re-fetch-on-activate pattern is sufficient for a localhost single-user tool.

### Claude's Discretion
- Whether to use `AbortController` in addition to the cancelled flag for the race condition fix
- Internal function decomposition within `search.ts` (e.g., separate functions per category vs one function with switch/if)
- Whether `search-actions.ts` re-exports the `globalSearch` function name (for backwards compatibility) or callers update to new import path

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Search Logic (Duplication Sources)
- `src/actions/search-actions.ts` — Server action search with config values (222 lines, the "reference" implementation)
- `src/mcp/tools/search-tools.ts` — MCP search with hardcoded limits (duplicate logic to extract)
- `src/lib/fts.ts` — Existing Next.js-free module pattern (search.ts should follow this pattern)

### Race Condition
- `src/components/layout/search-dialog.tsx` lines 90-100 — Debounced search useEffect with race condition

### Config Infrastructure
- `src/actions/config-actions.ts` — getConfigValue/getConfigValues server actions (used by search-actions)
- `src/lib/config-reader.ts` — Non-Next.js config reader (for MCP tools to read config)
- `src/lib/config-defaults.ts` — CONFIG_DEFAULTS registry (search.* keys already registered in Phase 13)

### Config Consumers (Realtime Verification)
- `src/components/layout/search-dialog.tsx` lines 76-78 — Client-side debounceMs config load on mount
- `src/components/task/task-detail-panel.tsx` lines 70-72 — Client-side branch template config load
- `src/actions/asset-actions.ts` — Server-side maxUploadBytes (already per-request)
- `src/lib/adapters/process-manager.ts` — Server-side maxConcurrent via config-reader (already per-call)

### Requirements
- `.planning/REQUIREMENTS.md` — SRCH-06, SRCH-07, CFG-02

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `config-reader.ts`: Non-Next.js config reader — MCP tools can use this to read search config params
- `fts.ts`: Established pattern for Next.js-free library modules that do raw SQL queries
- `db.ts`: Singleton PrismaClient — shared by both search-actions and search-tools via different import paths

### Established Patterns
- Framework-agnostic lib modules: `fts.ts`, `branch-template.ts` — no "use server", no Next.js imports
- Config read: `getConfigValues` batch read for multiple keys (Phase 13 pattern)
- Race condition prevention: Standard React `cancelled` flag pattern (not currently used in this codebase — this will be the first instance)

### Integration Points
- `src/lib/search.ts`: New shared module (extracted from search-actions + search-tools)
- `src/actions/search-actions.ts`: Refactor to thin wrapper calling search.ts
- `src/mcp/tools/search-tools.ts`: Refactor to thin wrapper calling search.ts via config-reader
- `src/components/layout/search-dialog.tsx`: Race condition fix + config re-fetch on open

</code_context>

<specifics>
## Specific Ideas

- The `search.ts` module should import `db` directly (same pattern as `fts.ts`) — it's a library module, not a server action
- MCP search tools gaining configurable limits is a bonus — agents will respect user's search preferences
- The `cancelled` flag is the minimal fix for the race condition; if Claude finds `AbortController` simpler for the server action call, that's acceptable too

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope (auto mode).

</deferred>

---

*Phase: 14-search-quality-realtime-config*
*Context gathered: 2026-03-30*
