# Project Research Summary

**Project:** ai-manager v0.3 — Global Search Enhancement
**Domain:** Cross-type search with FTS5 note indexing, asset metadata, and parallel query architecture
**Researched:** 2026-03-30
**Confidence:** HIGH

## Executive Summary

The v0.3 milestone extends an already-functional search system (Next.js 16 + SQLite + Prisma + FTS5) by adding three new search categories (All, Note, Asset) and a `description` field on `ProjectAsset`. This is a purely additive change: zero new npm packages are required, no new architectural components are introduced, and all features integrate into existing files. The recommended approach is to extend the `SearchCategory` type union, add parallel fan-out in `globalSearch` using `Promise.allSettled`, reuse the existing `notes_fts` virtual table with a cross-project SQL variant, and wire a new description textarea into the asset upload dialog.

The primary risk is schema migration: adding a field to `ProjectAsset` via `prisma db push` can silently drop the manually-created `notes_fts` FTS5 virtual table if Prisma detects schema drift. The mitigation is straightforward — back up `dev.db`, run `db push`, and re-run `pnpm db:init-fts` if the FTS table is lost. A secondary structural risk is the query logic duplication between `search-actions.ts` and `search-tools.ts` (MCP): any new search category must be added to both files or the MCP `search` tool silently returns empty arrays for the new categories with no error signal.

The recommended implementation order is strictly phased: Phase 1 lands the schema migration and asset description field (unblocking asset search), Phase 2 adds all search logic and MCP mirroring (consuming Phase 1's new column), and Phase 3 delivers the search UI extension (consuming Phase 2's expanded `SearchCategory` type). This ordering avoids every critical pitfall identified in research — the key rule is that no search code should reference `ProjectAsset.description` until after the schema migration is confirmed clean and `notes_fts` is verified intact.

---

## Key Findings

### Recommended Stack

v0.3 requires **no new dependencies**. All functionality is delivered through extensions to existing code. The base stack (Next.js 16.2.1, Prisma 6.x, SQLite with FTS5, TypeScript 5, Zod 4.x, Tailwind CSS v4) is fully capable of the new requirements. The `notes_fts` FTS5 virtual table created in v0.2 already indexes all notes content — the only change needed is a new cross-project SQL query that drops the `projectId` filter and adds workspace JOIN for context.

See `.planning/research/STACK.md` for full integration point details.

**Core technologies:**
- **Next.js 16.2.1 Server Actions:** handles `globalSearch` dispatch; no API routes needed — already the established pattern
- **Prisma 6.x + `$queryRawUnsafe`:** ORM for LIKE-based queries; raw SQL for FTS5 MATCH queries — established pattern in `src/lib/fts.ts`
- **SQLite FTS5 (trigram tokenizer):** cross-project note search via existing `notes_fts` virtual table; no new virtual tables needed for v0.3
- **Zod 4.x:** schema validation for the new `description` field on asset create/upload actions; enforce `max(500)` at action layer, not DB constraint layer

### Expected Features

See `.planning/research/FEATURES.md` for the full feature dependency graph and prioritization matrix.

**Must have (table stakes — v0.3 scope):**
- "All" tab with results grouped by type and section headers — users type once, see everything (Spotlight/Linear norm)
- Note search via FTS5 global variant (no `projectId` filter) — exposes existing FTS5 investment in global context
- Asset search by filename and description — requires `ProjectAsset.description` schema change first
- `ProjectAsset.description` field — nullable `String?` with `@default("")` to avoid migration failure on existing rows
- Upload dialog description input — textarea that passes `description` via FormData
- Extended `SearchCategory` type: `"all" | "task" | "project" | "repository" | "note" | "asset"`
- Preserve existing Task/Project/Repository tabs — no regression to current UX
- Note and asset result `navigateTo` routes — actionable results that open the correct project tab
- i18n keys for all new tabs and labels (zh + en)

**Should have (competitive differentiators — add when possible):**
- Note content snippet in subtitle (first ~80 chars of content) — reduces relevance scanning time
- Per-result type icon differentiation (BookOpen for notes, Paperclip for assets) — improves visual scanning speed
- Empty-state per section in "All" tab (omit section header when 0 results for a type)
- Asset result shows file type hint parsed from `mimeType`

**Defer (v0.4+):**
- Keyboard arrow navigation through search results — medium complexity, not blocking MVP
- Real-time result count badges on tabs — requires firing all 5 searches regardless of active tab (wasteful)

**Defer indefinitely (v1.0+ or never):**
- Semantic / embedding-based search — explicitly out of scope per PROJECT.md
- Search history / recent queries — requires persistent user state model that does not exist
- Per-workspace scoping filter — not needed for single-developer localhost tool

### Architecture Approach

All v0.3 changes are modifications to existing files — no new files are required. The architecture extends the existing category-dispatch pattern in `globalSearch` with three new `if (category === X)` branches, plus an `"all"` branch that uses `Promise.allSettled` (not `Promise.all`) to fan out 5 parallel SQLite queries and merge results capped at 5 per type. The search dialog extends `CATEGORY_DEFS` with 3 new tab entries; the "All" tab switches from a flat `results.map()` to a `useMemo` grouped reduce. The `search-tools.ts` MCP file must mirror every change to `search-actions.ts` — the two files are structurally coupled with no shared abstraction.

See `.planning/research/ARCHITECTURE.md` for full data flow diagrams, component boundary table, and anti-pattern catalog.

**Major components:**
1. `prisma/schema.prisma` — add `description String? @default("")` to `ProjectAsset`; deploy via `pnpm db:push`
2. `src/actions/search-actions.ts` + `src/mcp/tools/search-tools.ts` — extend `SearchCategory`; add note/asset/all branches; update in the same commit
3. `src/components/layout/search-dialog.tsx` — add 3 tabs; grouped renderer for All mode; import updated `SearchCategory` type
4. `src/actions/asset-actions.ts` + `src/components/assets/asset-upload.tsx` — accept and persist `description`; add textarea input
5. `src/lib/i18n.tsx` — add translation keys for all new strings (zh + en)

### Critical Pitfalls

See `.planning/research/PITFALLS.md` for full detail, warning signs, recovery steps, and a "Looks Done But Isn't" verification checklist.

1. **`prisma db push` destroying FTS5 virtual tables** — Back up `prisma/dev.db` before any `db push`; checkpoint WAL first; after push verify `notes_fts` exists via `sqlite3 dev.db ".tables"`; re-run `pnpm db:init-fts` if missing. This is Phase 1's most dangerous operation and the most likely cause of data loss.

2. **`description` as NOT NULL on `ProjectAsset`** — Always use `description String? @default("")`. A non-nullable field without a default triggers SQLite table recreation, which can cause existing asset data loss. Enforce non-empty at the Zod layer, not the DB constraint layer.

3. **`SearchCategory` type divergence between actions and MCP tool** — `search-actions.ts` and `search-tools.ts` share no code; adding new categories to one without the other silently returns `[]` from MCP with no error. Update both in the same commit.

4. **FTS5 `MATCH` syntax errors from unescaped user input** — Characters like `"`, `(`, `)`, `-`, `*`, `AND`, `OR`, `NOT` have special meaning in FTS5 syntax. Sanitize/escape queries before every `$queryRawUnsafe` FTS5 call; wrap in try/catch with LIKE fallback. Apply to `searchNotes()` and the new `searchNotesGlobal()`.

5. **`Promise.all` SQLite contention in "All" mode** — Never use bare `Promise.all` for parallel SQLite reads. Use `Promise.allSettled` so that a single `SQLITE_BUSY` error does not drop all search results. Verify `PRAGMA busy_timeout=5000` is set in `src/lib/db.ts` (known gap from v0.2).

---

## Implications for Roadmap

Research confirms a clear two-dependency chain: schema migration must land before asset search, and search logic must land before the search UI. The natural implementation breakdown is three phases with explicit verification gates between them.

### Phase 1: Asset Description Schema Migration

**Rationale:** `ProjectAsset.description` is a hard prerequisite for asset search. Phase 2 cannot reference this column until it exists and the migration is verified clean. Isolating the migration reduces risk — if the migration causes FTS5 loss, recovery is contained to Phase 1 without any half-implemented search code to unwind.

**Delivers:** `description` field on `ProjectAsset` (nullable, empty-string default); description input in upload dialog; updated `createAsset` and `uploadAsset` actions

**Addresses features:** `ProjectAsset.description` schema field (P1), upload dialog description input (P1)

**Avoids pitfalls:** FTS5 table loss from `db push` (Pitfall 1); NOT NULL migration failure on existing rows (Pitfall 5)

**Verification gate:** `sqlite3 prisma/dev.db ".tables"` shows `notes_fts`; `SELECT description FROM ProjectAsset LIMIT 5` returns `""` for pre-existing rows

### Phase 2: Search Actions and MCP Expansion

**Rationale:** Once the schema migration is confirmed, the server-side query logic can be added without touching any UI. Doing actions before UI means the full search contract (`SearchCategory` type, `SearchResult` shape, `navigateTo` patterns) is validated before the dialog is extended. The `search-tools.ts` MCP mirror must be updated in the same phase to prevent silent divergence.

**Delivers:** `globalSearch` supporting `"note"`, `"asset"`, `"all"` categories; global note FTS5 query with proper workspace JOIN; FTS5 query sanitization/escape function; asset LIKE search on filename + description; `Promise.allSettled` parallel fan-out in All mode capped at 5 results per type; MCP `search` tool parity with all new categories

**Uses:** Prisma `$queryRawUnsafe` (FTS5 established pattern); `Promise.allSettled`; FTS5 sanitization with LIKE fallback

**Implements:** Category-dispatch extension pattern (ARCHITECTURE.md Pattern 1); cross-project note search (Pattern 2); `Promise.allSettled` fan-out (Pattern referenced in anti-patterns)

**Avoids pitfalls:** SearchCategory type divergence (Pitfall 4); FTS5 syntax errors (Pitfall 6); `Promise.all` contention (Pitfall 3); FTS5 workspace scope leak (Pitfall 2)

### Phase 3: Search UI Extension

**Rationale:** With the expanded `SearchCategory` type exported from Phase 2, the dialog extension is a mechanical wiring task — add 3 entries to `CATEGORY_DEFS`, add a grouped renderer for All mode, add i18n keys. No risky operations exist in this phase; it is the safest phase to implement.

**Delivers:** Search dialog with 6 tabs (All, Task, Project, Repository, Note, Asset); grouped section rendering for All mode with per-type headers; i18n keys for zh + en; result type icons (BookOpen/Paperclip); note content snippets in subtitle; asset mimeType hint

**Uses:** Existing `CATEGORY_DEFS` tab extension pattern; `useMemo` grouped reduce (ARCHITECTURE.md Pattern 4)

**Avoids pitfalls:** "All" tab as default on dialog open (UX pitfall — keep default as `"task"`); flat list mutation for group headers (Architecture anti-pattern 4); in-flight search not cancelled on tab switch (UX pitfall — clear results on category change)

### Phase Ordering Rationale

- Schema migration must precede any code that queries `ProjectAsset.description` — this is a hard compile-time and runtime dependency; there is no workaround
- Server actions must precede UI — the TypeScript `SearchCategory` type must exist before the dialog imports it, and the `navigateTo` route patterns must be confirmed before navigation is wired
- This three-phase structure matches the `ARCHITECTURE.md` integration order table exactly (Steps 1-2 then Steps 3-4 then Step 5-6)
- Each phase has a clear verification gate before the next begins — no speculative parallel work across phases

### Research Flags

Phases likely needing attention during implementation:

- **Phase 2 (FTS5 cross-project note search):** The SQL JOIN pattern traversing `notes_fts → ProjectNote → Project → Workspace` is defined in research with a complete example, but the exact Prisma column name quoting for SQLite (e.g., `n."projectId"` vs `n.projectId`) should be validated against the live schema before finalizing. The `navigateTo` URL pattern (`?projectId=X&tab=notes`) depends on the workspace page reading a `tab` query param — verify this param is consumed before Phase 3 wires navigation.

- **Phase 2 (`busy_timeout` gap):** Research flags that `PRAGMA busy_timeout=5000` may not be set in `src/lib/db.ts` (carried over as a known gap from v0.2). Verify and add in Phase 2 before implementing `Promise.allSettled` fan-out.

Phases with standard patterns (skip additional research):

- **Phase 1 (schema migration):** Pattern is fully defined with the backup-push-verify sequence. Prisma nullable field with `@default("")` is well-documented behavior.

- **Phase 3 (search UI):** Pure UI wiring following the existing `CATEGORY_DEFS` extension pattern. All code examples are provided in ARCHITECTURE.md.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All conclusions from direct codebase inspection; zero new dependencies confirmed via `package.json`; no inferred compatibility required |
| Features | HIGH | Codebase is fully known; feature dependencies are explicit and verified against existing code; UX patterns from established cross-type search products (Linear, Notion, Jira) |
| Architecture | HIGH | All component boundaries confirmed via direct file inspection; data flow validated end-to-end with working code examples; integration order derived from explicit dependency analysis |
| Pitfalls | HIGH | Pitfall 1 (FTS5/db push) confirmed via Prisma issue #8106 and v0.2 direct experience; all pitfalls derived from code inspection + SQLite official docs + WAL documentation |

**Overall confidence:** HIGH

### Gaps to Address

- **`navigateTo` `?tab=` param consumption:** Research flags that workspace page must read a `tab` query param to auto-activate Notes/Assets tabs on navigation. If not implemented, search results navigate correctly but do not focus the right tab — minor usability gap, not a blocker. Verify during Phase 3; add tab-param handling if missing.

- **`busy_timeout` in `src/lib/db.ts`:** Known gap from v0.2 research. Verify `PRAGMA busy_timeout=5000` is actually set before implementing Phase 2's parallel queries. One-line fix if missing.

- **`search-actions.ts` vs `search-tools.ts` DRY:** Research recommends extracting shared query logic to `src/lib/search.ts` to prevent divergence. Optional for v0.3 (manual sync is acceptable for a single milestone) but becomes a maintenance liability as more categories are added. Flag for v0.4 if not addressed in v0.3.

---

## Sources

### Primary (HIGH confidence)

- Codebase inspection: `src/actions/search-actions.ts`, `src/lib/fts.ts`, `src/mcp/tools/search-tools.ts`, `src/components/layout/search-dialog.tsx`, `prisma/schema.prisma`, `src/actions/asset-actions.ts`, `src/components/assets/asset-upload.tsx`, `src/lib/i18n.tsx` — direct read, current state confirmed
- `.planning/PROJECT.md` — authoritative v0.3 milestone scope and out-of-scope list
- [SQLite FTS5 documentation](https://www.sqlite.org/fts5.html) — MATCH syntax, trigram tokenizer (3-char minimum), shadow table behavior
- [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html) — NOT NULL without DEFAULT requires table recreation; nullable with DEFAULT is always safe

### Secondary (MEDIUM confidence)

- [Prisma issue #8106](https://github.com/prisma/prisma/issues/8106) — FTS5 shadow table drift detection still open in Prisma 6.x; behavior non-deterministic
- [SQLite WAL concurrency](https://www.sqlite.org/wal.html#concurrency) — multiple concurrent readers confirmed; writer briefly blocks reads; `busy_timeout` prevents immediate failure
- [Command Palette UX Patterns — Alicja Suska](https://medium.com/design-bootcamp/command-palette-ux-patterns-1-d6b6e68f30c1) — grouped search result norms
- [Search UX Best Practices — Pencil & Paper](https://www.pencilandpaper.io/articles/search-ux) — section header and empty-state conventions

---

*Research completed: 2026-03-30*
*Ready for roadmap: yes*
