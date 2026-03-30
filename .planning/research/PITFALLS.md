# Pitfalls Research

**Domain:** Global search enhancement — adding "All" cross-type search, FTS5 note search, asset description field, and parallel queries to an existing Next.js 16 + SQLite + Prisma app
**Researched:** 2026-03-30
**Confidence:** HIGH (derived from direct codebase inspection of `search-actions.ts`, `fts.ts`, `schema.prisma`, `search-dialog.tsx`, and confirmed against SQLite FTS5 docs, Prisma issue tracker, and SQLite WAL behaviour)

---

## Critical Pitfalls

### Pitfall 1: `prisma db push` After Adding `description` Field Destroys FTS5 Tables

**What goes wrong:**
Adding the `description` field to `ProjectAsset` requires running `prisma db push`. This project has manually created FTS5 shadow tables (`notes_fts`, `notes_fts_data`, `notes_fts_idx`, etc.) outside of Prisma. When `db push` runs against a schema with a changed model, Prisma re-inspects the full database state. The FTS5 shadow tables appear as unrecognised drift, and Prisma may prompt "We need to reset the database" — wiping all notes, assets, tasks and the FTS index.

**Why it happens:**
This project uses `prisma db push` (not `prisma migrate`). There is no migration history. Each `db push` compares the Prisma schema against the live database. FTS5 shadow tables are visible in `sqlite_master` but have no corresponding Prisma model. On some Prisma 6.x versions the shadow tables are ignored; on others they trigger a drift warning that becomes a reset prompt. The risk is non-deterministic and environment-dependent. See the existing Pitfall 1 in this file (v0.2) for the root cause — it remains live for every subsequent schema change.

**How to avoid:**
1. Before touching `schema.prisma`, back up `prisma/dev.db`: `cp prisma/dev.db prisma/dev.db.backup`
2. Check WAL is checkpointed first: `sqlite3 prisma/dev.db 'PRAGMA wal_checkpoint(TRUNCATE)'`
3. Add the `description String? @default("")` field to `ProjectAsset` in `schema.prisma`
4. Run `prisma db push --accept-data-loss` only after the backup is confirmed
5. After `db push` succeeds, immediately re-run `pnpm db:init-fts` to restore the FTS5 virtual table if it was dropped
6. Verify: `sqlite3 prisma/dev.db ".tables"` — `notes_fts` must appear in the output

**Warning signs:**
- `prisma db push` output includes "The following changes will be made to the database schema" followed by table drops
- `prisma db push` shows a reset prompt — STOP; restore from backup
- After push, `pnpm db:init-fts` exits with "table already exists" (FTS survived) — this is safe; `IF NOT EXISTS` handles it
- After push, `searchNotes()` returns 0 results for a query that previously matched — FTS was wiped; re-run `db:init-fts` and re-index existing notes

**Phase to address:**
Phase 1 (Asset description field schema migration). Always perform the backup-push-verify sequence before any schema change that touches existing models.

---

### Pitfall 2: FTS5 Search in `globalSearch("all")` Skips the `projectId` Filter — Returns Cross-Project Note Leakage

**What goes wrong:**
The existing `searchNotes()` in `src/lib/fts.ts` accepts a required `projectId` parameter and filters to one project. The new "All" mode searches across the entire system with no project scope. When adapting `searchNotes()` for global use, developers omit the `projectId` filter and the JOIN with `ProjectNote` becomes the only filter. If the JOIN is also removed or loosened, all notes from all projects (and all workspaces) are returned — including private notes in unrelated workspaces. Even in a single-user tool this is confusing; if the tool is ever shared, it is a data boundary violation.

**Why it happens:**
The v0.2 `searchNotes()` was intentionally project-scoped. Extending it to "All" mode requires either a new function or a conditional filter. The easy path is to remove the `WHERE n."projectId" = ?` clause without considering the implication. Additionally, the FTS5 virtual table `notes_fts` stores only `note_id`, `title`, and `content` — it has no `workspaceId`. Cross-workspace scoping requires the JOIN with `ProjectNote` → `Project` → `Workspace`.

**How to avoid:**
Write a separate `searchNotesGlobal()` function that keeps the JOIN to `ProjectNote` and `Project`, but removes the `projectId` filter. The `subtitle` in results should show `workspace / project` so the user knows where the note lives. Return `projectId` and `workspaceId` in the result so `navigateTo` can be computed correctly.

```typescript
// src/lib/fts.ts — global variant
export async function searchNotesGlobal(
  db: PrismaClient,
  query: string
): Promise<(FtsNoteResult & { projectId: string; workspaceId: string })[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (trimmed.length < 3) {
    return db.$queryRawUnsafe(
      `SELECT n.id as note_id, n.title, n.content, n."projectId", p."workspaceId"
       FROM "ProjectNote" n
       JOIN "Project" p ON p.id = n."projectId"
       WHERE n.title LIKE ? OR n.content LIKE ?
       LIMIT 20`,
      `%${trimmed}%`, `%${trimmed}%`
    );
  }

  return db.$queryRawUnsafe(
    `SELECT f.note_id, f.title, f.content, n."projectId", p."workspaceId"
     FROM notes_fts f
     JOIN "ProjectNote" n ON n.id = f.note_id
     JOIN "Project" p ON p.id = n."projectId"
     WHERE f.notes_fts MATCH ?
     ORDER BY rank
     LIMIT 20`,
    trimmed
  );
}
```

**Warning signs:**
- "All" search returns notes from projects the user did not select
- `navigateTo` for note results points to the wrong workspace URL
- Removing `projectId` filter from the SQL query with no alternative scope guard

**Phase to address:**
Phase 2 (Notes search integration into globalSearch). Review the SQL for every new search path to confirm scope is intentional.

---

### Pitfall 3: `Promise.all` Parallel Queries in "All" Mode Cause SQLite WAL Contention

**What goes wrong:**
The "All" mode fires 5 concurrent read queries (tasks, projects, repositories, notes FTS5, assets). SQLite in WAL mode supports multiple concurrent readers — but only when all connections share the same WAL file and are coordinated. The Next.js app uses a single `PrismaClient` singleton, so all 5 queries share one connection pool. However, `$queryRawUnsafe` (used for FTS5) and Prisma ORM queries (used for the others) may acquire separate transactions. Under high load or when the MCP process is also reading, contention on the WAL read lock can cause one or more `Promise.all` branches to throw `SQLITE_BUSY`. Because `Promise.all` rejects on the first failure, a single contended read silently drops all results.

**Why it happens:**
SQLite allows concurrent reads in WAL mode, but each query still opens a read transaction. If a write (from MCP or from a concurrent server action) holds a write lock at the instant the read transaction tries to start, and `busy_timeout` is 0 (the default in `src/lib/db.ts`), the read fails immediately with `SQLITE_BUSY`. With 5 parallel reads, the probability of one hitting a write window is 5x higher than with a single sequential query.

**How to avoid:**
1. Ensure `PRAGMA busy_timeout=5000` is set on `src/lib/db.ts` (this is a known gap from the v0.2 pitfall — verify it was actually added)
2. Wrap `Promise.all` in a try/catch that returns partial results rather than crashing the search:

```typescript
const [tasks, projects, repos, notes, assets] = await Promise.allSettled([
  searchTasks(q), searchProjects(q), searchRepos(q),
  searchNotesGlobal(q), searchAssets(q)
]);
// Use .status === 'fulfilled' to collect results; log rejections
```

3. Consider sequential fallback: if `Promise.allSettled` shows >1 rejection, retry sequentially
4. Cap each branch at `LIMIT 10` in "All" mode (vs `LIMIT 20` in typed mode) to reduce query duration

**Warning signs:**
- "All" mode occasionally returns empty results for one result type while others populate correctly
- Server logs show `SQLITE_BUSY` or `P1001` errors specifically during "All" mode searches
- Intermittent 500 errors from `globalSearch` when "all" category is used

**Phase to address:**
Phase 2 (globalSearch "All" mode implementation). Use `Promise.allSettled` from the start; never use bare `Promise.all` for parallel SQLite reads.

---

### Pitfall 4: `SearchCategory` Type Union Breaks Existing MCP Search Tool Silently

**What goes wrong:**
`SearchCategory` in `search-actions.ts` is currently a string union `"task" | "project" | "repository"`. The MCP `search-tools.ts` imports and uses the same type. Adding `"note" | "asset" | "all"` to this union in the server action file, combined with a default of `"task"` in the MCP tool, is safe in TypeScript — but the MCP tool still uses `category` in a switch/if-chain that has no branch for the new values. When an external agent calls `search` with `category: "note"`, the MCP handler falls through to `return []` silently with no error, no tool failure, and no agent feedback.

**Why it happens:**
`search-tools.ts` duplicates the search logic from `search-actions.ts` rather than importing it. Any expansion of the server action's search logic is not automatically reflected in the MCP tool. The TypeScript types align (both accept the new union values) but the runtime logic diverges. No test currently covers the MCP tool's note or asset search paths, so the gap is invisible until an agent tries to use it.

**How to avoid:**
1. Refactor the MCP `search-tools.ts` handler to delegate to the same underlying query functions as `search-actions.ts` — extract shared logic to `src/lib/search.ts` imported by both
2. After adding new categories, explicitly add branches for `"note"`, `"asset"`, and `"all"` in BOTH files (or enforce DRY via the shared library)
3. Add a unit test for the MCP tool that calls each category value and verifies it returns results (not an empty array for a query that should match)

**Warning signs:**
- MCP `search` tool returns `[]` for `category: "note"` even when notes exist with matching content
- TypeScript compilation passes with no errors but runtime returns nothing
- `search-actions.ts` and `search-tools.ts` have diverged — one handles `"note"` and the other does not

**Phase to address:**
Phase 2 (search-actions.ts expansion). Extract shared query logic to `src/lib/search.ts` before implementing new categories; update both consumers in the same PR.

---

### Pitfall 5: Adding Required `description` Field to `ProjectAsset` Without a Default Breaks Existing Records

**What goes wrong:**
`ProjectAsset.description` is planned as a "required" field in the new upload dialog. If added to `schema.prisma` as `String` (not nullable, no default), `prisma db push` will attempt to add a NOT NULL column to an existing table that has rows. SQLite does not support `ALTER TABLE ADD COLUMN NOT NULL` without a default value. Prisma handles this by internally creating a new table, copying data, and dropping the old one — a destructive operation that can fail if WAL is not clean. Even if it succeeds, existing assets will have an empty `description` that the new UI shows as a blank field.

**Why it happens:**
Prisma's SQLite adapter simulates `ALTER TABLE` via table recreation for NOT NULL columns (SQLite does not support `ADD COLUMN NOT NULL` natively). This recreation clears any FTS-related triggers if they existed on the old table (they don't currently, but the asset table may gain triggers in future). More critically, it can fail with "database is locked" if the WAL has uncommitted reads from the MCP process.

**How to avoid:**
Define the field as optional with an empty string default: `description String? @default("")` in `schema.prisma`. This allows SQLite to add the column via a simple `ALTER TABLE ADD COLUMN` with a default, which is always safe — no table recreation. The upload dialog can treat empty-string as "no description provided" rather than requiring it at the DB level. Enforce non-empty at the UI/action validation layer (Zod), not at the DB constraint layer.

```prisma
model ProjectAsset {
  // ... existing fields
  description String? @default("")
  // ...
}
```

```typescript
// In createAsset Zod schema — enforce at action layer
description: z.string().max(500).optional().default(""),
```

**Warning signs:**
- `schema.prisma` has `description String` (no `?`, no `@default`) on `ProjectAsset`
- `prisma db push` attempts table recreation ("The following changes will be made") for `ProjectAsset`
- Existing assets lose their `filename` or `path` data after push (data loss during recreation)

**Phase to address:**
Phase 1 (Asset description field). Make `description` optional with a default in the schema; enforce content in the upload dialog via Zod.

---

### Pitfall 6: FTS5 `MATCH` Query Syntax Errors Throw Unhandled Exceptions in "All" Mode

**What goes wrong:**
FTS5's `MATCH` operator has its own query syntax. Characters like `"`, `(`, `)`, `-`, `*`, `AND`, `OR`, `NOT` have special meaning. A user query like `"my note"` (with quotes), `(task)`, or `NOT done` will be interpreted as FTS5 syntax rather than a literal string, often causing a SQLite error: `fts5: syntax error near "..."`. In the existing per-project notes search, this error surfaces as a 500 on the notes page. In the new "All" mode with `Promise.allSettled`, the FTS5 branch rejects but the others succeed — the user sees partial results with no indication that note search failed. Worse, the FTS error is swallowed by `allSettled` and never surfaces in the UI.

**Why it happens:**
FTS5 uses a structured query language. Raw user input must be escaped before being passed to `MATCH`. The current `searchNotes()` passes `trimmed` directly to `MATCH` without escaping. This worked in v0.2 because only simple alphanumeric terms were common in practice. With the "All" search bar handling all user input including punctuation and multi-word phrases, syntax errors become frequent.

**How to avoid:**
Escape user queries before passing to FTS5. The safest approach for a fuzzy search UX is to wrap the query in double quotes (FTS5 phrase search) and escape any internal double quotes:

```typescript
function escapeFtsQuery(q: string): string {
  // Remove FTS5 operator characters or escape by wrapping in phrase
  return '"' + q.replace(/"/g, '""') + '"';
}
```

Or strip FTS5 special characters entirely and use trigram-native behaviour:

```typescript
function sanitizeFtsQuery(q: string): string {
  // Strip characters that break FTS5 MATCH syntax
  return q.replace(/["\(\)\-\*\^]/g, ' ').replace(/\s+/g, ' ').trim();
}
```

Apply this escape in `searchNotes()`, `searchNotesGlobal()`, and any future FTS5 query path. Add a try/catch around the `$queryRawUnsafe` call and fall back to the `LIKE` path on FTS5 syntax errors.

**Warning signs:**
- Searching for `"quoted text"` returns a 500 error or empty results instead of matching notes
- Server logs show `SqliteError: fts5: syntax error`
- The `LIKE` fallback path (for queries <3 chars) works fine, but FTS5 path (3+ chars) fails for certain inputs
- "All" mode returns tasks and projects but not notes for the same query

**Phase to address:**
Phase 2 (FTS5 integration into globalSearch). Add FTS5 query sanitization/escaping before the first integration test; cover edge-case queries (quoted strings, operators, Chinese + punctuation) in unit tests.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Duplicate search logic in `search-actions.ts` and `search-tools.ts` | No refactor needed now | Adding "note" + "asset" categories must be done twice; divergence is guaranteed | Never — extract to `src/lib/search.ts` in the same PR that adds new categories |
| Pass raw user query to FTS5 `MATCH` without escaping | Simpler code | Syntax errors crash note search for any query containing `"`, `(`, `)`, `-` | Never — escape before every MATCH call |
| Add `description` as NOT NULL to `ProjectAsset` | Cleaner schema | Requires SQLite table recreation; risks data loss for existing assets | Never — use `String? @default("")` |
| Use bare `Promise.all` for parallel search queries | One less import | Single `SQLITE_BUSY` error silently drops all search results | Never in production — use `Promise.allSettled` |
| Keep `LIMIT 20` per-type in "All" mode | Maximum results returned | 5 types × 20 = 100 rows fetched, assembled, then truncated in UI; wasted query time | Reduce to LIMIT 10 per type in "All" mode |
| Skip updating MCP `search-tools.ts` when adding new categories | Less code to write | Agent calling `search` with `category: "note"` gets empty array silently | Never — update MCP tool in the same commit as server action |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Prisma `db push` + existing FTS5 tables | Run push without backup | Back up `dev.db` → WAL checkpoint → `db push` → verify `notes_fts` still present → re-run `db:init-fts` if needed |
| `ProjectAsset` schema change + existing rows | Add `description String` (NOT NULL, no default) | Use `description String? @default("")`; SQLite can add nullable column without table recreation |
| FTS5 `MATCH` + user input | Pass raw query string directly | Sanitize/escape FTS5 special characters before every `MATCH` call; wrap in try/catch to fall back to `LIKE` |
| `Promise.all` + SQLite parallel reads | Assume WAL = no contention | Use `Promise.allSettled`; set `busy_timeout=5000`; log rejected branches |
| `SearchCategory` type expansion + MCP tool | Update `search-actions.ts` only | Update both `search-actions.ts` and `search-tools.ts`; or extract shared logic to `src/lib/search.ts` |
| FTS5 global search + workspace scoping | Remove `projectId` filter and use FTS table alone | Always JOIN `notes_fts` → `ProjectNote` → `Project` to get `workspaceId` for correct `navigateTo` construction |
| Asset search via `LIKE` + `description` field | Search `description` field before it exists in schema | Phase 1 must land schema migration before Phase 2 adds asset search to `globalSearch` |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| "All" mode with LIMIT 20 per type | 100 rows fetched across 5 queries; UI shows max 5-10 per type anyway | Cap each branch at LIMIT 10 in "All" mode; use LIMIT 20 only in typed mode | Immediately — wasteful from day one |
| FTS5 query without `ORDER BY rank` in global mode | Notes results are not relevance-ranked; best matches buried | Always include `ORDER BY rank` in FTS5 `MATCH` queries | Noticeable once a project has >10 matching notes |
| `LIKE '%term%'` on `ProjectAsset.description` with no index | Full table scan on every asset search | Add `@@index([description])` or accept LIKE-only at current scale (single user, <1000 assets) | At ~5,000+ assets — not a concern for v0.3 |
| Debounce timer in `search-dialog.tsx` fires 5 parallel queries on each keypress | Each keystroke fires 5 SQLite queries when category is "all" | The existing 250ms debounce is sufficient; ensure the "all" category does not bypass the debounce | Not a concern at current single-user scale |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| FTS5 `MATCH` with unescaped user input | SQL injection via FTS5 syntax; at worst, application crash from syntax error | Always sanitize/escape before `$queryRawUnsafe` FTS5 calls; `$queryRawUnsafe` does not parameterise the query itself |
| Asset `description` field stored raw with no length limit | Arbitrarily long description could degrade search performance or cause OOM in FTS indexing (if notes_fts is extended to cover assets) | Enforce `max(500)` in Zod schema on `createAsset` and `updateAsset` actions |
| Returning full `content` field of notes in global search results | Long note content (500k chars) serialised into search results inflates response payload | Return only a `snippet` (first 200 chars of content) in search results, not the full content |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| "All" tab returns results with no type label | User cannot tell if a result is a task, note, or asset | Always include a visible type badge on each result row; the existing `type` field on `SearchResult` must be surfaced in the UI |
| Notes results in "All" mode navigate to the notes tab with no specific note highlighted | User sees the notes list but does not know which note matched | Pass `noteId` as a query param in `navigateTo` so the notes panel can auto-select the matched note |
| Asset results show only filename — no project context | User cannot tell which project the asset belongs to | Include `workspace / project` as `subtitle` on asset results (same pattern as task results) |
| "All" tab selected by default on dialog open | Fires 5 queries on first keystroke; slower than single-type search | Keep default category as `"task"` (existing behaviour); add "All" as an explicit tab the user selects |
| Switching between category tabs while a query is in-flight | Previous search results flash before new ones load | Cancel in-flight search when category changes; the existing timer-based debounce does not cancel pending server action calls |

---

## "Looks Done But Isn't" Checklist

- [ ] **Schema migration safety:** Run `prisma db push` for `description` field — verify `notes_fts` still exists afterward (`sqlite3 dev.db ".tables"` shows `notes_fts`)
- [ ] **Existing asset data:** After migration, query `SELECT description FROM ProjectAsset LIMIT 5` — existing rows should show `""` (empty string default), not `NULL` causing NULL pointer errors in the UI
- [ ] **FTS5 escape:** Search for `"quoted"` in the search dialog — verify it returns results or an empty state, not a 500 error
- [ ] **FTS5 escape:** Search for `(test)` and `NOT done` — verify no server error
- [ ] **All-mode note scope:** Create a note in Workspace A, search for it from the "All" tab — verify `navigateTo` points to the correct workspace URL, not a 404
- [ ] **All-mode partial failure:** Manually break the `notes_fts` table, then use "All" mode — verify tasks and projects still appear (graceful degradation via `allSettled`)
- [ ] **MCP search tool:** Call `search` MCP tool with `category: "note"` and `category: "asset"` — verify non-empty results when matching data exists
- [ ] **Asset search:** Upload an asset with a description, then search for a word from the description in "All" mode — verify the asset appears in results
- [ ] **i18n:** New "All", "Note", "Asset" tab labels must have both `zh` and `en` translations in the i18n config
- [ ] **Result type badges:** Every result row in "All" mode shows a visible type indicator (task/project/repository/note/asset)
- [ ] **Debounce in "all" mode:** Rapidly type 5 characters — verify only 1 search fires (debounce active), not 5 parallel searches

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| `db push` wiped FTS5 tables | MEDIUM | Restore `prisma/dev.db.backup`; run `pnpm db:init-fts`; re-sync FTS from ProjectNote table via bulk INSERT |
| `description` NOT NULL migration failed, existing assets lost | HIGH | Restore backup; change schema to `String? @default("")`; re-run push |
| FTS5 syntax error breaks note search in "All" mode | LOW | Add escape function to `searchNotesGlobal()`; the LIKE fallback path works for queries <3 chars as interim |
| MCP `search` returns empty for notes/assets | LOW | Add missing category branches to `search-tools.ts` handler; no data changes needed |
| "All" mode returns 0 results due to `Promise.all` rejection | LOW | Replace `Promise.all` with `Promise.allSettled`; check `busy_timeout` pragma on `src/lib/db.ts` |
| Note search returns wrong workspace's notes | MEDIUM | Add `workspaceId` JOIN to `searchNotesGlobal()`; no data changes needed, only query fix |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| `db push` destroys FTS5 tables on `description` migration | Phase 1: Asset description schema migration | After push: `sqlite3 dev.db ".tables"` includes `notes_fts` |
| `description` NOT NULL breaks existing rows | Phase 1: Asset description schema migration | `SELECT description FROM ProjectAsset` returns `""` for pre-existing rows |
| `SearchCategory` type divergence (actions vs MCP tool) | Phase 2: globalSearch + MCP expansion | MCP `search` with `category: "note"` returns matching notes |
| FTS5 `MATCH` syntax error on special chars | Phase 2: FTS5 note search integration | Searching `"quoted"` and `(test)` returns results or empty state, never 500 |
| FTS5 note scope leak across workspaces | Phase 2: globalSearch "All" mode | Notes from Workspace A do not appear when searching from Workspace B context |
| `Promise.all` contention in "All" mode | Phase 2: globalSearch "All" mode implementation | `Promise.allSettled` used; partial failures degrade gracefully |
| Asset search using description before migration | Phase ordering: Phase 1 must precede Phase 2 | Asset search branch in `globalSearch` is not wired until Phase 1 migration is verified |

---

## Sources

- Codebase analysis: `src/actions/search-actions.ts`, `src/lib/fts.ts`, `src/mcp/tools/search-tools.ts`, `src/components/layout/search-dialog.tsx`, `prisma/schema.prisma`, `prisma/init-fts.ts`
- [SQLite FTS5 — Query Syntax](https://www.sqlite.org/fts5.html#full_text_query_syntax) — documents MATCH operator syntax and special characters
- [SQLite ALTER TABLE limitations](https://www.sqlite.org/lang_altertable.html) — confirms NOT NULL without DEFAULT requires table recreation
- [Prisma issue #8106 — FTS5 shadow table drift](https://github.com/prisma/prisma/issues/8106) — still open as of Prisma 6.x
- [SQLite WAL concurrent readers](https://www.sqlite.org/wal.html#concurrency) — multiple readers allowed; writer blocks briefly
- Existing `.planning/research/PITFALLS.md` (v0.2) — Pitfalls 1–9 remain valid for v0.3 context

---
*Pitfalls research for: Global search enhancement (v0.3) — "All" cross-type search, FTS5 note search, asset description migration, parallel queries*
*Researched: 2026-03-30*
