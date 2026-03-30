# Phase 14: Search Quality & Realtime Config - Research

**Researched:** 2026-03-30
**Domain:** TypeScript refactoring, React race-condition patterns, Next.js config reactivity
**Confidence:** HIGH

## Summary

Phase 14 is a pure refactoring and correctness phase with no new user-facing features and no new dependencies. All three requirements are surgical code changes to existing files. The codebase provides exact reference implementations, established patterns, and a full unit test suite that the planner must update alongside the production code changes.

The search logic duplication is straightforward: `search-actions.ts` (222 lines) and `search-tools.ts` (222 lines) share identical SQL queries, type definitions, and branching logic. The only differences are config-loading style (getConfigValues vs hardcoded) and snippet support (actions has it, tools does not). The extraction target is `src/lib/search.ts` following the `fts.ts` pattern — no Next.js imports, db received as an import (singleton), config params as a plain object argument.

The race condition in `search-dialog.tsx` is a classic stale-closure problem in a debounced `setTimeout` + `async/await` combination. The `cancelled` flag pattern is the minimal and correct fix, and it already exists in the codebase in `task-detail-panel.tsx` — making this the second instance, not the first.

The realtime config requirement is satisfied by moving the config fetch from mount-only to open-on-every-activate. No Context, polling, or WebSocket is needed.

**Primary recommendation:** Execute three independent tasks (extract search.ts, fix race condition, move config fetch to open effect) and update existing test files to import from the new module paths.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Create `src/lib/search.ts` with a `search(query, category, config)` function that accepts config params as arguments (dependency injection). The module must NOT import Next.js modules or `config-actions.ts` — it stays framework-agnostic like `fts.ts`.
- **D-02:** Config params passed as an object: `{ resultLimit: number, allModeCap: number, snippetLength: number }`. Both callers resolve config before calling search.
- **D-03:** `search-actions.ts` delegates to `search.ts` — reads config via `getConfigValues()` (server action), then passes params to `search()`.
- **D-04:** `search-tools.ts` delegates to `search.ts` — reads config via `config-reader.ts` (`readConfigValue`), then passes params to `search()`. MCP tools now respect user-configured values instead of hardcoded defaults.
- **D-05:** Move `NoteRawRow`, `toNoteResult`, and the `SearchResult`/`SearchCategory` types into `search.ts` as the single source of truth. Both `search-actions.ts` and `search-tools.ts` re-export types from `search.ts`.
- **D-06:** Add a `cancelled` flag in the debounced search `useEffect` cleanup. Pattern: `let cancelled = false` at effect start, check `if (!cancelled)` before `setResults()`, set `cancelled = true` in cleanup function.
- **D-07:** Also set `setIsSearching(false)` inside the cancelled check — prevents loading spinner from getting stuck when a request completes after cancellation.
- **D-08:** Server-side consumers (search-actions, asset-actions, process-manager, execute) already read from DB per request — no change needed, already realtime.
- **D-09:** Client-side components re-fetch config each time they activate. For `search-dialog.tsx`: move config fetch into the `open` effect so debounceMs reloads each time the dialog opens.
- **D-10:** For `task-detail-panel.tsx`: branch template loads on mount — acceptable since the panel remounts when switching tasks. No additional realtime mechanism needed.
- **D-11:** No React Context, polling, or WebSocket needed for config refresh at this scale.

### Claude's Discretion

- Whether to use `AbortController` in addition to the cancelled flag for the race condition fix
- Internal function decomposition within `search.ts` (e.g., separate functions per category vs one function with switch/if)
- Whether `search-actions.ts` re-exports the `globalSearch` function name (for backwards compatibility) or callers update to new import path

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope (auto mode).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SRCH-06 | `search-actions.ts` and `search-tools.ts` share search logic extracted to `src/lib/search.ts` | D-01 through D-05; `fts.ts` pattern provides the exact module template; both files are 222 lines with identical SQL queries |
| SRCH-07 | Search `useEffect` race condition fixed via `cancelled` flag preventing stale results | D-06, D-07; `task-detail-panel.tsx` lines 34-46 contains the established pattern already in this codebase |
| CFG-02 | Config changes take effect in running app without restart or page reload | D-08 through D-11; re-fetch-on-open pattern for `search-dialog.tsx` is the full scope needed |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

This project imports AGENTS.md which contains one override directive:

- **Next.js breaking changes:** Read `node_modules/next/dist/docs/` before writing Next.js code. Current version is `16.2.1`. APIs and conventions may differ from training data.
- **No console.log** in production code (TypeScript hooks rule)
- **Immutability:** Use spread operator, never mutate existing objects (`[...rules].sort()` established pattern)
- **Max file length:** 800 lines; aim for 200-400 lines (current `search.ts` after extraction will be ~180 lines)
- **Functions < 50 lines**
- **Error handling:** Explicit at every level, no silent swallow

## Standard Stack

### Core (existing — no new installs needed)
| Library | Version | Purpose | Relevant to Phase |
|---------|---------|---------|------------------|
| Prisma | 6.19.2 | ORM for SQLite queries | `db` used in `search.ts` |
| Vitest | 4.1.1 | Unit test framework | Tests must be updated |
| React | 19.2.4 | Component framework | Race condition fix in hooks |
| Next.js | 16.2.1 | App framework | Server actions boundary |

**No new packages required.** All changes are pure refactoring.

## Architecture Patterns

### Recommended File Layout

```
src/
├── lib/
│   ├── search.ts          # NEW — extracted shared search logic
│   ├── fts.ts             # REFERENCE pattern (no Next.js imports)
│   ├── config-reader.ts   # Used by search.ts for MCP callers (already exists)
│   └── config-defaults.ts # CONFIG_DEFAULTS for search.* keys
├── actions/
│   └── search-actions.ts  # THIN WRAPPER — delegates to search.ts
└── mcp/tools/
    └── search-tools.ts    # THIN WRAPPER — delegates to search.ts via config-reader
```

### Pattern 1: Framework-Agnostic Library Module (fts.ts pattern)

**What:** A module in `src/lib/` that imports only `@/lib/db` and standard Node.js — no `"use server"`, no `next/*` imports, no `config-actions.ts`.
**When to use:** Whenever logic must be shared between Next.js server actions and MCP stdio process.
**Example from fts.ts:**
```typescript
// src/lib/fts.ts — NO Next.js imports
import type { PrismaClient } from "@prisma/client";

export async function searchNotes(db: PrismaClient, projectId: string, query: string): Promise<FtsNoteResult[]> {
  // ...
}
```

Note: `search.ts` will import `db` directly (singleton) rather than receiving it as a parameter, because the search function already uses Prisma models (`db.task`, `db.project`, etc.) and both callers share the same singleton. This is consistent with the existing pattern in `search-actions.ts` and `search-tools.ts`.

### Pattern 2: Dependency-Injected Config Params

**What:** The `search()` function accepts config values as a plain object instead of reading them itself.
**Why:** Callers (server action and MCP tool) each have different config-reading mechanisms. This keeps `search.ts` free of either mechanism.

```typescript
// src/lib/search.ts
export interface SearchConfig {
  resultLimit: number;
  allModeCap: number;
  snippetLength: number;
}

export async function search(
  query: string,
  category: SearchCategory,
  config: SearchConfig
): Promise<SearchResult[]> {
  // all existing search logic here
}
```

```typescript
// src/actions/search-actions.ts — thin wrapper
"use server";
import { search, type SearchResult, type SearchCategory } from "@/lib/search";
import { getConfigValues } from "@/actions/config-actions";

export { SearchResult, SearchCategory }; // re-export for existing consumers

export async function globalSearch(query: string, category: SearchCategory = "task"): Promise<SearchResult[]> {
  const cfg = await getConfigValues(["search.resultLimit", "search.allModeCap", "search.snippetLength"]);
  return search(query, category, {
    resultLimit: (cfg["search.resultLimit"] as number) ?? 20,
    allModeCap: (cfg["search.allModeCap"] as number) ?? 5,
    snippetLength: (cfg["search.snippetLength"] as number) ?? 80,
  });
}
```

```typescript
// src/mcp/tools/search-tools.ts — thin wrapper
import { search } from "@/lib/search";
import { readConfigValue } from "@/lib/config-reader";

const handler = async (args) => {
  const [resultLimit, allModeCap, snippetLength] = await Promise.all([
    readConfigValue<number>("search.resultLimit", 20),
    readConfigValue<number>("search.allModeCap", 5),
    readConfigValue<number>("search.snippetLength", 80),
  ]);
  return search(args.query, args.category ?? "task", { resultLimit, allModeCap, snippetLength });
};
```

### Pattern 3: Cancelled Flag for Async useEffect (established in task-detail-panel.tsx)

**What:** A boolean flag set in the effect cleanup prevents stale async results from updating state.
**Established location:** `task-detail-panel.tsx` lines 34-46 (already uses this pattern for `getTaskMessages`).

```typescript
// Existing pattern in task-detail-panel.tsx (lines 34-46) — REFERENCE
useEffect(() => {
  let cancelled = false;
  getTaskMessages(task.id).then((serverMessages) => {
    if (cancelled) return;
    setMessages(/* ... */);
  });
  return () => { cancelled = true; };
}, [task.id]);
```

**Applied to search-dialog.tsx debounced effect:**
```typescript
useEffect(() => {
  if (timerRef.current) clearTimeout(timerRef.current);
  if (!query.trim()) { setResults([]); return; }
  setIsSearching(true);

  let cancelled = false;  // ADD

  timerRef.current = setTimeout(async () => {
    const r = await globalSearch(query, category);
    if (!cancelled) {           // ADD GUARD
      setResults(r);
      setIsSearching(false);    // MOVED inside guard
    }
  }, debounceMs);

  return () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    cancelled = true;           // ADD
  };
}, [query, category, debounceMs]);
```

### Pattern 4: Re-fetch Config on Dialog Open

**What:** Move config load from mount-only `useEffect(fn, [])` to the open-state `useEffect(fn, [open])`.
**Current code (search-dialog.tsx lines 76-87):**

```typescript
// CURRENT: mount-only, stale after settings change
useEffect(() => {
  getConfigValue<number>("search.debounceMs", 250).then(setDebounceMs);
}, []); // <-- fires once

useEffect(() => {
  if (open) {
    setTimeout(() => inputRef.current?.focus(), 100);
    setQuery(""); setResults([]);
  }
}, [open]);
```

**After fix — merge config fetch into open effect:**

```typescript
// AFTER: reload config each time dialog opens
useEffect(() => {
  if (open) {
    getConfigValue<number>("search.debounceMs", 250).then(setDebounceMs); // MOVED HERE
    setTimeout(() => inputRef.current?.focus(), 100);
    setQuery(""); setResults([]);
  }
}, [open]);
```

The separate mount-only effect for debounceMs is removed entirely.

### Anti-Patterns to Avoid

- **Importing `config-actions.ts` from `search.ts`:** `config-actions.ts` has `"use server"` — importing it from a lib module would break MCP compatibility.
- **Importing `next/cache` or `next/*` from `search.ts`:** Same reason. Boundary violation.
- **Moving the `timerRef.current` clearTimeout out of cleanup:** The cancelled flag only prevents state updates; the setTimeout still needs to be cleared to stop the network call from firing at all.
- **Separate `setIsSearching(false)` outside the cancelled guard:** Per D-07, the spinner must NOT be cleared when a stale request completes. Both `setResults` and `setIsSearching(false)` belong inside the `if (!cancelled)` check.
- **Parallel `readConfigValue` calls without `Promise.all` in search-tools.ts:** Three sequential awaits adds 3× DB roundtrip latency. Use `Promise.all`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Race condition prevention | Custom request ID or timestamp comparison | `cancelled` flag pattern | Simpler, established in codebase, no extra state |
| Config re-fetch reactivity | React Context / polling / WebSocket | Re-fetch on open | Localhost single-user tool; per-activation fetch is sufficient |
| Search deduplication | Custom merge logic | Single `search.ts` function | One function, both callers pass config — no custom merge |

**Key insight:** Every "custom mechanism" for reactivity (Context, polling, WebSocket) adds complexity without benefit at this scale. The re-fetch-on-activate approach is the correct trade-off for a single-user local tool.

## Common Pitfalls

### Pitfall 1: Breaking existing tests without updating imports

**What goes wrong:** `search-actions.test.ts` imports `SearchCategory` and `SearchResult` directly from `@/actions/search-actions`. After extraction, those types live in `search.ts`. If `search-actions.ts` does not re-export them, the test file breaks with a TypeScript error.
**Why it happens:** TypeScript re-exports are easy to forget when moving types to a new module.
**How to avoid:** Per D-05, `search-actions.ts` must `export { SearchResult, SearchCategory }` (re-exported from `search.ts`). Verify both test files compile after refactoring.
**Warning signs:** `vitest run` TypeScript compilation error mentioning `SearchCategory` or `SearchResult`.

### Pitfall 2: `search-tools.ts` test imports types from the wrong place

**What goes wrong:** `search-tools.test.ts` currently does NOT import `SearchResult` directly — it uses `unknown` and cast. This is fine. But if someone adds type assertions to the test after the refactor, the import path must be `@/lib/search`, not `@/actions/search-actions`.
**How to avoid:** Check test file imports after refactoring.

### Pitfall 3: `all` category recursive call breaks after extraction

**What goes wrong:** The current `globalSearch` in `search-actions.ts` calls itself recursively for the "all" category. After extraction, `search.ts` must call itself recursively (or use a loop). If the refactored function calls `globalSearch` from `search-actions.ts` instead of the local `search()` function, it will re-trigger config fetching 5× per "all" query.
**Why it happens:** Copy-paste of the recursive call without updating the function reference.
**How to avoid:** In `search.ts`, the "all" branch calls `search(q, category, config)` on itself — the local function, not the wrapper. `search-tools.ts` also currently calls `searchTools.search.handler` (a reference to itself) — this must be updated to call `search()` from `search.ts` directly.
**Warning signs:** "all" category returns different result counts than individual categories; config is loaded 5 extra times per "all" query.

### Pitfall 4: `search-tools.ts` loses snippet support

**What goes wrong:** The current `search-tools.ts` `toNoteResult` does NOT include `snippet` in the return type. After extraction, `search.ts` adds snippet support (it exists in `search-actions.ts`). The `search-tools.ts` `SearchResult` interface also lacks `snippet`. If `search-tools.ts` re-exports or uses the new `SearchResult` from `search.ts` which includes `snippet?`, the MCP tool's result shape changes — this is actually a feature gain (D-04 says "MCP tools now respect user-configured values"), not a problem.
**How to avoid:** Accept that MCP search results will now include `snippet` field — this is intentional and correct per D-04.

### Pitfall 5: `cancelled` flag declared inside setTimeout callback

**What goes wrong:** `let cancelled = false` is accidentally placed inside the `setTimeout` callback, making it always `false` — defeating the entire purpose.
**How to avoid:** `let cancelled = false` must be declared at the `useEffect` function body level, OUTSIDE the `setTimeout` callback. Cleanup sets `cancelled = true`. The setTimeout callback closes over the outer `cancelled` variable.

## Code Examples

### search.ts — complete module skeleton

```typescript
// src/lib/search.ts — NO Next.js imports, NO config-actions imports
import { db } from "@/lib/db";

export type SearchCategory = "task" | "project" | "repository" | "note" | "asset" | "all";
export type SearchResultType = "task" | "project" | "repository" | "note" | "asset";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  navigateTo: string;
  snippet?: string;
}

export interface SearchConfig {
  resultLimit: number;
  allModeCap: number;
  snippetLength: number;
}

interface NoteRawRow {
  note_id: string;
  title: string;
  content: string;
  projectId: string;
  workspaceId: string;
  project_name: string;
  workspace_name: string;
}

function toNoteResult(row: NoteRawRow, snippetLength: number): SearchResult { /* ... */ }

export async function search(
  query: string,
  category: SearchCategory = "task",
  config: SearchConfig
): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const q = query.trim();
  const { resultLimit, allModeCap, snippetLength } = config;

  if (category === "all") {
    // calls search() on itself (local reference) — NOT globalSearch
    const [taskRes, projectRes, repoRes, noteRes, assetRes] = await Promise.allSettled([
      search(q, "task", config),
      search(q, "project", config),
      search(q, "repository", config),
      search(q, "note", config),
      search(q, "asset", config),
    ]);
    // ...collect with allModeCap
  }
  // ... remaining category branches using resultLimit and snippetLength
}
```

### Test file update for search-actions.test.ts

The test imports `SearchCategory` and `SearchResult` from `@/actions/search-actions`. After the refactor, these types are re-exported from that path — no import path change is needed in the test file. Verify with:
```bash
# From project root
npx vitest run tests/unit/actions/search-actions.test.ts
npx vitest run tests/unit/mcp/search-tools.test.ts
```

### Race condition fix — diff summary

In `search-dialog.tsx`, the debounced `useEffect` (lines 90-100):
- ADD `let cancelled = false;` after `setIsSearching(true)`
- WRAP `setResults(r); setIsSearching(false);` in `if (!cancelled) { ... }`
- ADD `cancelled = true;` to the cleanup return function (alongside existing `clearTimeout`)

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Race condition — no guard | `cancelled` flag pattern (React docs recommended) | Prevents stale results showing |
| Config on mount only | Config on activate (dialog open) | Picks up config changes without restart |
| Duplicated search SQL | Single `search.ts` module | Single source of truth, config-aware MCP search |

## Open Questions

1. **AbortController in addition to cancelled flag**
   - What we know: `cancelled` flag prevents state update; it does not cancel the in-flight `globalSearch` server action call
   - What's unclear: Whether AbortController is worth the added complexity for a local tool
   - Recommendation: Claude's discretion per D-11 note. The `task-detail-panel.tsx` already uses `abortRef` for a different purpose — but for the search debounce, the timeout clearing means few in-flight calls exist simultaneously. Keep it simple: cancelled flag only.

2. **`search-actions.ts` function name after extraction**
   - What we know: `globalSearch` is imported in `search-dialog.tsx` and `search-actions.test.ts`
   - What's unclear: Whether to keep `globalSearch` as the exported name (thin wrapper) or rename to `search`
   - Recommendation: Keep `globalSearch` as the exported wrapper name in `search-actions.ts` for zero-diff downstream. The internal `search.ts` function is named `search`.

## Environment Availability

Step 2.6: SKIPPED — this phase is purely code/config changes. No external tools, services, or CLIs are required beyond the project's own stack (Vitest, Prisma, TypeScript), all of which are confirmed installed in `package.json`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:run tests/unit/lib/` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SRCH-06 | `search.ts` module exists and both wrappers delegate to it | unit | `pnpm test:run tests/unit/lib/search.test.ts` | ❌ Wave 0 |
| SRCH-06 | `globalSearch` in search-actions still returns correct results | unit | `pnpm test:run tests/unit/actions/search-actions.test.ts` | ✅ (update imports if needed) |
| SRCH-06 | MCP search handler still returns correct results | unit | `pnpm test:run tests/unit/mcp/search-tools.test.ts` | ✅ (update imports if needed) |
| SRCH-07 | Race condition: stale result does not overwrite newer result | unit | `pnpm test:run tests/unit/components/search-dialog.test.tsx` | ✅ (add new test case) |
| CFG-02 | debounceMs re-fetched each time dialog opens | unit | `pnpm test:run tests/unit/components/search-dialog.test.tsx` | ✅ (add new test case) |

### Sampling Rate
- **Per task commit:** `pnpm test:run tests/unit/lib/ tests/unit/actions/search-actions.test.ts tests/unit/mcp/search-tools.test.ts tests/unit/components/search-dialog.test.tsx`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/lib/search.test.ts` — covers SRCH-06 (verify extracted module returns same results as original actions; verify config params are respected: resultLimit, allModeCap, snippetLength)

*(Existing test infrastructure covers SRCH-07 and CFG-02 once new test cases are added to `search-dialog.test.tsx`. The existing `search-actions.test.ts` and `search-tools.test.ts` need no structural changes — they test via the wrapper function which remains `globalSearch`.)*

## Sources

### Primary (HIGH confidence)
- Direct file reads: `src/actions/search-actions.ts`, `src/mcp/tools/search-tools.ts`, `src/lib/fts.ts`, `src/lib/config-reader.ts`, `src/lib/config-defaults.ts`
- Direct file reads: `src/components/layout/search-dialog.tsx`, `src/components/task/task-detail-panel.tsx`
- Direct file reads: `tests/unit/actions/search-actions.test.ts`, `tests/unit/mcp/search-tools.test.ts`, `tests/unit/components/search-dialog.test.tsx`
- `vitest.config.ts`, `package.json` — framework versions and test commands confirmed

### Secondary (MEDIUM confidence)
- `.planning/phases/14-search-quality-realtime-config/14-CONTEXT.md` — decisions D-01 through D-11 treated as locked

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all versions confirmed from package.json
- Architecture: HIGH — patterns traced directly from existing codebase files
- Pitfalls: HIGH — derived from reading actual code and test files, not speculation

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable codebase, no fast-moving dependencies)
