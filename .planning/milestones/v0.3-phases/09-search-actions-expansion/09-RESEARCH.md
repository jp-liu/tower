# Phase 9: Search Actions Expansion - Research

**Researched:** 2026-03-30
**Domain:** Server-side search (FTS5 notes, LIKE assets), globalSearch fan-out, MCP search tool extension, malformed query resilience
**Confidence:** HIGH

## Summary

Phase 9 extends `globalSearch` in `src/actions/search-actions.ts` and the `search` tool in `src/mcp/tools/search-tools.ts` to cover two new categories (`note`, `asset`) plus an `all` mode that fans out to all five types simultaneously. The note search reuses the existing `searchNotes` helper in `src/lib/fts.ts` (FTS5 trigram + LIKE fallback), but must be adapted for global cross-project search rather than per-project. The asset search is a plain Prisma `LIKE` query against `filename` and `description`. The `all` mode requires `Promise.allSettled` to prevent one SQLITE_BUSY error from dropping all results. Both `search-actions.ts` and `search-tools.ts` contain duplicated logic and MUST be updated in the same commit — a locked project decision.

The most important implementation detail is FTS5 error handling. SQLite FTS5 throws a native error when a MATCH expression is syntactically malformed (e.g., `"unmatched`). The success criterion explicitly requires fallback to LIKE search in that case. This means the note search path in `globalSearch` needs a try/catch around the FTS5 call that retries with a LIKE query on the `ProjectNote` table when the FTS error is caught. The existing `searchNotes` helper in `fts.ts` does NOT have this fallback — it only falls back for short queries, not for malformed ones.

The global note search differs from the per-project `searchNotes` in one key way: it must search across ALL projects (no `projectId` filter), then join to get workspace navigation paths. The existing FTS5 SQL in `fts.ts` filters by `n."projectId" = ?`. For the global case this filter must be removed, and the JOIN must also retrieve `project.workspaceId` to construct `navigateTo` URLs.

**Primary recommendation:** Add `note`, `asset`, and `all` to `SearchCategory`, implement each branch in `globalSearch` following the existing pattern, wire parallel fan-out for `all` with `Promise.allSettled`, add FTS5 malformed-query catch-and-retry in the note branch, then mirror all changes in `search-tools.ts`.

---

<user_constraints>
## User Constraints (from STATE.md Decisions)

### Locked Decisions
- FTS5 virtual tables must be created via raw SQL AFTER `prisma db push` — never before, or Prisma detects schema drift. (`notes_fts` currently exists and must survive any future db push.)
- Both PrismaClient instances (Next.js + MCP) need `PRAGMA busy_timeout=5000` — already in place in `src/lib/db.ts` and `src/mcp/db.ts`. Verify before implementing `Promise.allSettled` fan-out.
- MCP tools use action-dispatch pattern — `manage_notes` and `manage_assets` are action-dispatch. The `search` tool is a regular single-call tool. Do NOT change it to action-dispatch; extend category enum instead.
- `file-utils.ts` and `fts.ts` must never import Next.js modules — this constraint applies here: do NOT add `import { db } from "@/lib/db"` or Next.js imports to `fts.ts`. Keep shared helpers Next.js-free.
- `search-actions.ts` and `search-tools.ts` (MCP) must be updated in the same commit when adding new `SearchCategory` values — they share no code and divergence is silent. (v0.3 research decision)
- Use `Promise.allSettled` (not `Promise.all`) for parallel SQLite queries in "All" mode — single SQLITE_BUSY must not drop all results. (v0.3 research decision)
- Back up `prisma/dev.db` before any `prisma db push` — not needed in this phase (no schema changes), but the habit applies to any future schema work.

### Pending Todos from STATE.md (must be resolved in this phase)
- Phase 9: Verify `PRAGMA busy_timeout=5000` is set in `src/lib/db.ts` before implementing `Promise.allSettled` fan-out.
- Phase 9: Validate FTS5 JOIN SQL column name quoting against live schema (`n."projectId"` vs `n.projectId`).

### Claude's Discretion
- Whether to add a `searchNotesGlobal` helper to `fts.ts` or inline the raw SQL inside `search-actions.ts`.
- The per-type cap for `all` mode (suggested: 5 results per type, 25 total max).
- Whether `navigateTo` for note results points to the project page or a direct note anchor (e.g., `/workspaces/${wsId}?projectId=${pId}&tab=notes`).
- Whether `navigateTo` for asset results includes a `?tab=assets` query param.

### Deferred Ideas (OUT OF SCOPE)
- Phase 10 Search UI Extension (SUI-01, SUI-02, SUI-03, ASSET-03) — UI tabs and snippet rendering are Phase 10 only.
- FTS5 indexing of asset descriptions — assets use plain LIKE search (description field is plain text, no virtual table).
- Semantic search / embeddings — explicitly out of scope in REQUIREMENTS.md.
- Note tag system (SRCH-F01) — future requirement, not in v0.3.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SRCH-01 | User can search notes by title and content via FTS5 full-text search | New `note` branch in `globalSearch` — calls raw SQL against `notes_fts` joined to `ProjectNote` and `Project`; falls back to LIKE on malformed FTS5 query |
| SRCH-02 | User can search assets by filename and description | New `asset` branch in `globalSearch` — Prisma `findMany` with OR on `filename` and `description` LIKE; `description` field now exists on `ProjectAsset` (Phase 8 complete) |
| SRCH-03 | User can search across all types ("All" mode) with results grouped by type | New `all` branch — `Promise.allSettled` fan-out to all 5 category branches; results returned as grouped object or flat array with `type` discriminant; per-type cap of ~5 |
| SRCH-04 | MCP search tool supports note, asset, and all categories | `search-tools.ts` category enum extended from `["task","project","repository"]` to `["task","project","repository","note","asset","all"]`; handler logic mirrored from `search-actions.ts` |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@prisma/client` | 6.x (project-locked) | ORM — asset LIKE search; note JOIN queries | Already in use; `db.$queryRawUnsafe` pattern established for FTS5 |
| `zod` | project-locked | Extend `SearchCategory` enum, validate MCP tool input | All inputs validated with Zod per project convention |
| SQLite FTS5 | bundled with SQLite | FTS5 trigram index for note title+content global search | `notes_fts` virtual table already exists; trigram tokenizer active |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `src/lib/fts.ts` | project file | `searchNotes` helper (per-project) — reference implementation for global variant | Read to understand SQL shape; do NOT modify to add Next.js imports |
| `Promise.allSettled` | Node.js built-in | Fan-out all 5 search branches in parallel for `all` mode | Required by locked decision: one SQLITE_BUSY must not drop all results |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Promise.allSettled` fan-out | Sequential `if/else` per type | Sequential is simpler but 5x slower for `all`; `allSettled` is the locked decision |
| Raw SQL for note global search | Prisma `findMany` with `content: { contains: q }` | Prisma LIKE would work but bypasses FTS5 ranking and trigram index; FTS5 is the requirement |
| Inline raw SQL in `search-actions.ts` | New `searchNotesGlobal` in `fts.ts` | Inline keeps all search logic in one place; new helper keeps `fts.ts` consistent but adds Next.js coupling risk if not careful |

**Installation:** No new packages needed. No schema changes needed (Phase 8 already added `description` to `ProjectAsset`).

---

## Architecture Patterns

### Files to Modify

```
src/
├── actions/
│   └── search-actions.ts      # Add "note", "asset", "all" to SearchCategory + handlers
└── mcp/tools/
    └── search-tools.ts        # Mirror same category changes + handlers
```

Optional (Claude's discretion):
```
src/lib/
└── fts.ts                     # May add searchNotesGlobal() helper — only if it can remain Next.js-free
```

No new files required unless a shared search helper is extracted.

### Pattern 1: Extending SearchCategory

**What:** Add `"note" | "asset" | "all"` to the union type and default parameter.
**When to use:** Whenever new searchable content types are added.

```typescript
// src/actions/search-actions.ts
export type SearchCategory = "task" | "project" | "repository" | "note" | "asset" | "all";

export async function globalSearch(
  query: string,
  category: SearchCategory = "task"
): Promise<SearchResult[]> { ... }
```

The MCP schema:
```typescript
// src/mcp/tools/search-tools.ts
schema: z.object({
  query: z.string(),
  category: z
    .enum(["task", "project", "repository", "note", "asset", "all"])
    .default("task")
    .optional(),
}),
```

### Pattern 2: Global Note Search with FTS5 + Malformed Query Fallback

**What:** Search `notes_fts` joined to `ProjectNote` + `Project` + `Workspace` without a `projectId` filter.
**When to use:** `category === "note"` in `globalSearch`.

The existing `searchNotes` in `fts.ts` filters by `projectId`. The global version removes that filter and adds workspace JOIN for navigation paths.

Column quoting note: the live schema confirmed SQLite stores the column as `projectId` (case-sensitive as created by Prisma). The existing `fts.ts` uses `n."projectId"` with double-quotes — this is safe and should be kept for consistency.

```typescript
// Inline inside search-actions.ts — note category handler
if (category === "note") {
  const trimmed = q.trim();

  // Short query fallback (< 3 chars): FTS5 trigram needs 3+
  if (trimmed.length < 3) {
    return db.$queryRawUnsafe<NoteRawRow[]>(
      `SELECT n.id as note_id, n.title, n.content,
              n."projectId", p."workspaceId", p.name as project_name, w.name as workspace_name
       FROM "ProjectNote" n
       JOIN "Project" p ON p.id = n."projectId"
       JOIN "Workspace" w ON w.id = p."workspaceId"
       WHERE n.title LIKE ? OR n.content LIKE ?
       LIMIT 20`,
      `%${trimmed}%`,
      `%${trimmed}%`
    ).then(rows => rows.map(toNoteResult));
  }

  // FTS5 search — catch malformed query and fall back to LIKE
  try {
    const rows = await db.$queryRawUnsafe<NoteRawRow[]>(
      `SELECT f.note_id, f.title, f.content,
              n."projectId", p."workspaceId", p.name as project_name, w.name as workspace_name
       FROM notes_fts f
       JOIN "ProjectNote" n ON n.id = f.note_id
       JOIN "Project" p ON p.id = n."projectId"
       JOIN "Workspace" w ON w.id = p."workspaceId"
       WHERE f.notes_fts MATCH ?
       ORDER BY rank
       LIMIT 20`,
      trimmed
    );
    return rows.map(toNoteResult);
  } catch (err) {
    // Malformed FTS5 query (e.g., unmatched quotes) — fall back to LIKE
    const rows = await db.$queryRawUnsafe<NoteRawRow[]>(
      `SELECT n.id as note_id, n.title, n.content,
              n."projectId", p."workspaceId", p.name as project_name, w.name as workspace_name
       FROM "ProjectNote" n
       JOIN "Project" p ON p.id = n."projectId"
       JOIN "Workspace" w ON w.id = p."workspaceId"
       WHERE n.title LIKE ? OR n.content LIKE ?
       LIMIT 20`,
      `%${trimmed}%`,
      `%${trimmed}%`
    );
    return rows.map(toNoteResult);
  }
}
```

The `toNoteResult` mapper:
```typescript
interface NoteRawRow {
  note_id: string;
  title: string;
  content: string;
  projectId: string;
  workspaceId: string;
  project_name: string;
  workspace_name: string;
}

function toNoteResult(row: NoteRawRow): SearchResult {
  return {
    id: row.note_id,
    type: "note" as const,
    title: row.title,
    subtitle: `${row.workspace_name} / ${row.project_name}`,
    navigateTo: `/workspaces/${row.workspaceId}?projectId=${row.projectId}`,
  };
}
```

### Pattern 3: Asset Search via Prisma LIKE

**What:** Search `ProjectAsset` by `filename` OR `description` using Prisma `contains`.
**When to use:** `category === "asset"` in `globalSearch`.

No FTS5 needed — asset description is plain text; the field exists in the live DB (verified: `description TEXT DEFAULT ''`).

```typescript
if (category === "asset") {
  const assets = await db.projectAsset.findMany({
    where: {
      OR: [
        { filename: { contains: q } },
        { description: { contains: q } },
      ],
    },
    include: {
      project: {
        include: { workspace: true },
      },
    },
    take: 20,
    orderBy: { createdAt: "desc" },
  });
  return assets.map((a) => ({
    id: a.id,
    type: "asset" as const,
    title: a.filename,
    subtitle: `${a.project.workspace.name} / ${a.project.name}`,
    navigateTo: `/workspaces/${a.project.workspaceId}?projectId=${a.projectId}`,
  }));
}
```

### Pattern 4: All-Mode Fan-Out with Promise.allSettled

**What:** Run all 5 category searches in parallel, collect results regardless of individual failures.
**When to use:** `category === "all"`.

The locked decision mandates `Promise.allSettled` to prevent SQLITE_BUSY on one query from collapsing all results.

```typescript
if (category === "all") {
  const CAP = 5; // per-type result cap

  const [taskRes, projectRes, repoRes, noteRes, assetRes] = await Promise.allSettled([
    globalSearch(q, "task"),
    globalSearch(q, "project"),
    globalSearch(q, "repository"),
    globalSearch(q, "note"),
    globalSearch(q, "asset"),
  ]);

  // Collect results from settled promises; skip rejected
  const collect = (res: PromiseSettledResult<SearchResult[]>) =>
    res.status === "fulfilled" ? res.value.slice(0, CAP) : [];

  return [
    ...collect(taskRes),
    ...collect(projectRes),
    ...collect(repoRes),
    ...collect(noteRes),
    ...collect(assetRes),
  ];
}
```

**Key detail:** The `SearchResult.type` discriminant (`"task"`, `"project"`, `"repository"`, `"note"`, `"asset"`) is already present on every result. Phase 10's UI will use this to group results into sections. Phase 9 returns them as a flat array — grouping is a Phase 10 concern.

### Pattern 5: SearchResult Type Extension

**What:** Add `"note"` and `"asset"` to the `SearchResult.type` union so TypeScript is satisfied.
**When to use:** When updating the type definitions in `search-actions.ts`.

```typescript
export type SearchCategory = "task" | "project" | "repository" | "note" | "asset" | "all";

export interface SearchResult {
  id: string;
  type: "task" | "project" | "repository" | "note" | "asset"; // no "all" — "all" is a query mode, not a result type
  title: string;
  subtitle: string;
  navigateTo: string;
}
```

### Anti-Patterns to Avoid

- **Using `Promise.all` instead of `Promise.allSettled` for the `all` fan-out:** One SQLITE_BUSY rejects the entire Promise, returning nothing. Use `allSettled`.
- **Adding FTS5 search for assets:** `ProjectAsset` has no FTS5 virtual table. Plain LIKE on `filename` and `description` is correct.
- **Calling `searchNotes(db, projectId, query)` inside `globalSearch`:** That function requires a `projectId`. For global search, use inline raw SQL without the `projectId` filter.
- **Adding `"all"` to `SearchResult.type`:** `"all"` is a query mode, not a result type. Results always carry a specific type. Adding `"all"` to the result type union confuses Phase 10's grouping logic.
- **Updating only `search-actions.ts` without `search-tools.ts`:** SRCH-04 requires parity. The locked decision says both must be updated in the same commit. Divergence is silent — the MCP tool will still accept only 3 categories, breaking MCP callers.
- **Importing Next.js modules in `fts.ts` if a helper is added there:** `fts.ts` must remain Next.js-free (shared between Next.js and MCP stdio).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FTS5 query parser | Custom regex to detect malformed queries pre-flight | try/catch around `$queryRawUnsafe` FTS5 call, LIKE fallback on error | SQLite FTS5 syntax is complex; the catch is simpler and handles all edge cases |
| Cross-project note JOIN | Separate queries for each project then merge | Single raw SQL JOIN across `notes_fts`, `ProjectNote`, `Project`, `Workspace` | Single JOIN is more efficient and avoids N+1 |
| Asset description FTS | Create new `assets_fts` virtual table | Plain Prisma LIKE on `description` | FTS5 table requires initialization script maintenance; LIKE is sufficient for asset descriptions (shorter text, less content than notes) |
| Fan-out aggregation | Manual sequential calls and array concat | `Promise.allSettled` with parallel calls | Parallel is faster; `allSettled` is the correct resilience primitive |

**Key insight:** This phase is pure logic extension — no schema changes, no new infrastructure. All complexity is in the SQL for note search and the error handling for FTS5.

---

## Runtime State Inventory

> No schema changes in Phase 9 (Phase 8 already added `description`). No rename/refactor. This section confirms nothing unexpected needs migrating.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | 1 `ProjectNote` row in live DB (`notes_fts` has 0 rows — note was not synced to FTS) | No migration needed; global note search will find notes both via FTS5 (if synced) and LIKE fallback |
| Stored data | 1 `ProjectAsset` row with `description = ''` (empty string, not NULL) | Asset LIKE search with `{ description: { contains: q } }` — empty string will not match any non-empty query; correct behavior |
| Live service config | None | — |
| OS-registered state | None | — |
| Secrets/env vars | None | — |
| Build artifacts | `@prisma/client` generated types already include `description` on `ProjectAsset` (Phase 8 applied) | No regeneration needed |

**FTS5 table status:** `notes_fts` exists (confirmed: `sqlite3 prisma/dev.db ".tables"` shows `notes_fts` and 5 shadow tables). The one existing note has `note_id = cmnci6e4o0001cjltbruwbpy9` but is NOT in `notes_fts` (was created before FTS sync was wired, or sync was skipped). Global note search will find it via the LIKE fallback when query is short, or will miss it via FTS5 until it is re-synced. This is acceptable — re-sync only happens on note edit/update.

**PRAGMA verification (pending todo from STATE.md):** Confirmed `src/lib/db.ts` sets `PRAGMA busy_timeout=5000` at lines 21-22. Confirmed `src/mcp/db.ts` sets it at line 9. Both PrismaClient instances are safe for parallel queries.

**Column name quoting (pending todo from STATE.md):** Confirmed `PRAGMA table_info(ProjectAsset)` shows column name is `projectId` (camelCase). Double-quoting `"projectId"` in raw SQL is correct and matches the existing pattern in `fts.ts`.

---

## Common Pitfalls

### Pitfall 1: FTS5 Malformed Query Crashes the Server

**What goes wrong:** A query like `"unmatched` (unmatched quote) causes SQLite to throw a native error from the FTS5 MATCH call. Without a catch, the server action throws a 500 error.
**Why it happens:** FTS5 MATCH parses the query string as a boolean expression. Unmatched quotes, stray operators (`AND`, `OR` at end), and other syntax errors cause parse failures at the SQLite level, not at the JavaScript level.
**How to avoid:** Wrap the FTS5 `$queryRawUnsafe` call in a try/catch. On any error, retry with a LIKE query. Do NOT attempt to sanitize/escape the query string — it is complex and error-prone.
**Warning signs:** Integration test with query `'"unmatched'` throws instead of returning results.

### Pitfall 2: Forgetting to Update search-tools.ts

**What goes wrong:** `globalSearch` accepts `"note"` and `"asset"`, but the MCP `search` tool still has `z.enum(["task", "project", "repository"])`. MCP callers get a Zod validation error when they pass `"note"` or `"all"`.
**Why it happens:** The two files share no code — divergence is silent until an MCP client actually passes the new category.
**How to avoid:** Update both files in the same commit. The locked decision from v0.3 research explicitly calls this out.
**Warning signs:** MCP test for `search` tool with `category: "note"` throws Zod error.

### Pitfall 3: Using Promise.all Instead of Promise.allSettled in All Mode

**What goes wrong:** One SQLITE_BUSY error (timeout after 5000ms) causes `Promise.all` to reject, returning zero results instead of partial results from the other 4 categories.
**Why it happens:** `Promise.all` short-circuits on first rejection. With 5 parallel SQLite reads, contention is possible especially under load.
**How to avoid:** Use `Promise.allSettled`. Check `res.status === "fulfilled"` before using `res.value`.
**Warning signs:** `all` mode returns empty array when one category has an error.

### Pitfall 4: Calling searchNotes(db, projectId, query) with a hardcoded projectId

**What goes wrong:** Developer reuses the existing `searchNotes` from `fts.ts` but passes an empty string or a placeholder projectId. The FTS5 JOIN filters to `n."projectId" = ''`, returning zero results.
**Why it happens:** `searchNotes` was designed for per-project search and always requires a `projectId` filter.
**How to avoid:** For global search, write inline raw SQL without the `projectId` filter. Do NOT call `searchNotes` from `globalSearch`.
**Warning signs:** Note search returns 0 results even when matching notes exist in other projects.

### Pitfall 5: Adding "all" to SearchResult.type Union

**What goes wrong:** Phase 10's grouping logic uses `result.type` to determine which section to render. If `"all"` appears as a result type, the UI has no section for it.
**Why it happens:** Developer conflates the query category with the result type.
**How to avoid:** `SearchResult.type` should be `"task" | "project" | "repository" | "note" | "asset"` only. `"all"` is a query mode input, never a result type.
**Warning signs:** TypeScript type error when Phase 10 adds a switch/map on `result.type`.

### Pitfall 6: Asset description LIKE with NULL vs Empty String

**What goes wrong:** The existing asset in the live DB has `description = ''` (empty string default). Prisma `{ description: { contains: q } }` on SQLite generates `description LIKE '%q%'`. An empty string `''` does NOT match `'%api%'`, so this is correct. But if description were `NULL`, `NULL LIKE '%q%'` evaluates to NULL (falsy) — also correct. No special handling needed.
**Why it happens:** This is actually not a pitfall — both NULL and `''` are correctly excluded by LIKE. Document to prevent unnecessary defensive coding.
**How to avoid:** No action needed. Do not add `{ description: { not: null } }` pre-filter — it is unnecessary and would exclude assets with empty descriptions from the OR clause unnecessarily.

---

## Code Examples

### Verified: PRAGMA busy_timeout in Both DB Clients

```typescript
// Source: src/lib/db.ts (read directly) — lines 21-22
await db.$queryRaw`PRAGMA journal_mode=WAL`;
await db.$queryRaw`PRAGMA busy_timeout=5000`;

// Source: src/mcp/db.ts (read directly) — line 9
await db.$queryRaw(Prisma.sql`PRAGMA busy_timeout=5000`);
```

Both PrismaClient instances are safe for the Promise.allSettled parallel fan-out.

### Verified: Column Quoting in FTS5 JOIN (matches live schema)

```sql
-- Source: src/lib/fts.ts (read directly) — lines 38-47
-- Column "projectId" quoting is correct for SQLite camelCase columns
SELECT f.note_id, f.title, f.content
FROM notes_fts f
JOIN "ProjectNote" n ON n.id = f.note_id
WHERE f.notes_fts MATCH ? AND n."projectId" = ?
ORDER BY rank
LIMIT 20
```

Global variant removes the `AND n."projectId" = ?` filter and adds Project + Workspace JOINs.

### Verified: FTS5 Table Structure (from init-fts.ts)

```typescript
// Source: prisma/init-fts.ts (read directly)
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
USING fts5(
  note_id UNINDEXED,
  content rowid reference to ProjectNote id,
  title,
  content,
  tokenize='trigram case_sensitive 0'
)
```

The FTS table column for MATCH is `notes_fts` (the table name itself, which is the default FTS5 content column). The existing SQL `WHERE f.notes_fts MATCH ?` is correct.

### Verified: Existing SearchResult Shape (no breaking changes needed)

```typescript
// Source: src/actions/search-actions.ts (read directly)
export interface SearchResult {
  id: string;
  type: SearchCategory;  // NOTE: currently typed as SearchCategory — should be narrowed
  title: string;
  subtitle: string;
  navigateTo: string;
}
```

Phase 9 should tighten `type` to `"task" | "project" | "repository" | "note" | "asset"` (not `SearchCategory`, which includes `"all"`).

### Test Pattern: FTS5 Malformed Query Must Not Throw

```typescript
// Source: tests/unit/lib/fts.test.ts pattern (adapted for global search)
// @vitest-environment node
it("falls back to LIKE when FTS5 query is malformed", async () => {
  // Create a note
  const note = await testDb.projectNote.create({
    data: { title: "API Setup", content: "config details", projectId: testProjectId },
  });

  // Malformed FTS5 query — unmatched quote
  await expect(
    globalSearch('"unmatched', "note")
  ).resolves.not.toThrow(); // must resolve, not reject

  await testDb.projectNote.delete({ where: { id: note.id } });
});
```

---

## Environment Availability

> No new external dependencies for this phase.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| SQLite FTS5 | Note search | Yes | Bundled with SQLite 3.43.2 | — |
| `sqlite3` CLI | Manual DB verification | Yes | Bundled | — |
| `prisma` CLI | No schema push needed this phase | Yes | 6.x | — |
| `vitest` | Test suite | Yes | 4.x | — |
| `pnpm` | Scripts | Yes | 10.28.2 | — |
| `node` | tsx, tests | Yes | 22.17.0 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

---

## Validation Architecture

> `workflow.nyquist_validation` is absent from `.planning/config.json` — treated as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `pnpm test:run tests/unit/lib/search-actions.test.ts` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SRCH-01 | `globalSearch(q, "note")` returns notes matching title/content via FTS5 | integration | `pnpm test:run tests/unit/lib/search-actions.test.ts` | No — Wave 0 |
| SRCH-01 | FTS5 malformed query falls back to LIKE, does not throw | integration | `pnpm test:run tests/unit/lib/search-actions.test.ts` | No — Wave 0 |
| SRCH-02 | `globalSearch(q, "asset")` returns assets matching filename or description | integration | `pnpm test:run tests/unit/lib/search-actions.test.ts` | No — Wave 0 |
| SRCH-03 | `globalSearch(q, "all")` returns results from all 5 types, capped per type | integration | `pnpm test:run tests/unit/lib/search-actions.test.ts` | No — Wave 0 |
| SRCH-03 | `all` mode does not drop results when one category has an error | integration | `pnpm test:run tests/unit/lib/search-actions.test.ts` | No — Wave 0 |
| SRCH-04 | MCP `search` tool accepts `"note"`, `"asset"`, `"all"` categories | unit | `pnpm test:run tests/unit/mcp/search-tool.test.ts` | No — Wave 0 |
| SRCH-04 | MCP `search` tool returns same structure as `globalSearch` | integration | `pnpm test:run tests/unit/mcp/search-tool.test.ts` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test:run tests/unit/lib/search-actions.test.ts --reporter=dot`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/lib/search-actions.test.ts` — covers SRCH-01, SRCH-02, SRCH-03 (new file; model after `fts.test.ts` pattern with `@vitest-environment node`)
- [ ] `tests/unit/mcp/search-tool.test.ts` — covers SRCH-04 (new file; model after `tests/unit/mcp/manage-notes.test.ts`)

*(Existing test files do not cover `globalSearch` — no existing `search-actions.test.ts` found.)*

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Read Next.js guide in `node_modules/next/dist/docs/` before writing any Next.js-touching code** — AGENTS.md explicitly states this version has breaking changes. `search-actions.ts` is a `"use server"` file.
- No `console.log` in production code.
- Use Zod for all server action and MCP tool input validation — category enum must be in Zod schema.
- Files under 800 lines; functions under 50 lines — `search-actions.ts` is currently 91 lines; adding 3 new branches (~60 lines each with comments) will grow it to ~270 lines, still well under 800.
- No mutation — immutable patterns. All search functions return new arrays via `.map()`.
- Test coverage minimum 80% — 2 new test files are required (Wave 0 gaps above).
- `file-utils.ts` and `fts.ts` must remain zero-import from Next.js. If a `searchNotesGlobal` helper is added to `fts.ts`, it must not import `db` from `@/lib/db` or any Next.js module.
- MCP tools use action-dispatch pattern — the `search` tool is already a regular tool (not action-dispatch). Keep it that way; extend the category enum.
- `search-actions.ts` and `search-tools.ts` must be updated in the same commit.

---

## Sources

### Primary (HIGH confidence)
- `src/actions/search-actions.ts` (read directly) — current shape of `globalSearch`, `SearchCategory`, `SearchResult`
- `src/mcp/tools/search-tools.ts` (read directly) — current MCP search tool schema and handler
- `src/lib/fts.ts` (read directly) — FTS5 SQL patterns, column quoting, LIKE fallback logic
- `src/lib/db.ts` (read directly) — `PRAGMA busy_timeout=5000` confirmed at lines 21-22
- `src/mcp/db.ts` (read directly) — `PRAGMA busy_timeout=5000` confirmed at line 9
- `prisma/schema.prisma` (read directly) — `ProjectAsset.description String? @default("")` confirmed
- `prisma/init-fts.ts` (read directly) — `notes_fts` FTS5 table definition, tokenizer config
- `sqlite3 prisma/dev.db ".tables"` (live query) — `notes_fts` and all shadow tables confirmed present
- `sqlite3 prisma/dev.db "PRAGMA table_info(ProjectAsset);"` (live query) — `description` column confirmed at position 7, type TEXT, default `''`
- `sqlite3 prisma/dev.db "SELECT ..."` (live query) — 1 note, 1 asset in live DB; asset `description` is empty string
- `.planning/STATE.md` (read directly) — all locked decisions and pending todos for Phase 9
- `tests/unit/lib/fts.test.ts` (read directly) — test patterns to follow for new search tests
- `tests/unit/lib/asset-actions.test.ts` (read directly) — confirmed description field already tested (Phase 8 complete)
- `.planning/ROADMAP.md` (read directly) — success criteria for Phase 9

### Secondary (MEDIUM confidence)
- Phase 8 RESEARCH.md (`.planning/phases/08-asset-description-schema/08-RESEARCH.md`) — confirms `description` nullable column added; asset action patterns

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages project-locked; no new dependencies; all patterns verified against live files
- Architecture: HIGH — all modified files read directly; SQL patterns traced from existing `fts.ts`; live DB queries confirm schema state
- Pitfalls: HIGH — FTS5 malformed query behavior verified against SQLite FTS5 specification; PRAGMA settings confirmed in both DB clients; column quoting verified against live `PRAGMA table_info`

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (all dependencies project-locked; SQLite FTS5 behavior is stable)
