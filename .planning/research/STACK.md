# Stack Research

**Domain:** Search enhancement for AI task management platform (v0.3)
**Researched:** 2026-03-30
**Confidence:** HIGH — all conclusions grounded in direct codebase inspection and SQLite/Prisma official docs

---

## Scope

This is a **delta research document** for the v0.3 milestone: global cross-type search ("All" mode), notes FTS5 search in global search, asset search, and a `description` field addition to `ProjectAsset`. The base stack (Next.js 16, React 19, Prisma 6, SQLite, Tailwind CSS v4) is validated — this document covers only what changes.

---

## What Is Actually New

| Feature | Stack Change Needed? | Notes |
|---------|----------------------|-------|
| "All" cross-type search | No new libraries | Extend `globalSearch` in `search-actions.ts` to run all category queries in parallel and merge results |
| Notes FTS5 in global search | No new libraries | `searchNotes()` in `src/lib/fts.ts` already exists; add `searchAllNotes()` without project filter |
| Asset search (filename + description) | No new libraries | LIKE query on `ProjectAsset.filename` + `ProjectAsset.description`; no FTS needed |
| `ProjectAsset.description` field | Prisma schema change only | Add `description String?` to `ProjectAsset` model, then `pnpm db:push` |
| New search tabs (All/Note/Asset) | No new libraries | Extend `SearchCategory` type union; update existing search UI component |

**Conclusion: v0.3 requires zero new npm dependencies.**

---

## Recommended Stack

### Core Technologies (unchanged — included for reference)

| Technology | Version (locked) | Purpose |
|------------|-----------------|---------|
| Next.js | 16.2.1 | App Router, Server Actions |
| Prisma | ^6.19.2 | ORM, schema change via `db push` |
| SQLite (via Prisma) | bundled | Persistence, FTS5 virtual table |
| TypeScript | ^5 | Type safety |

### Supporting Libraries (in use, relevant to v0.3)

| Library | Version (locked) | Role in v0.3 |
|---------|-----------------|--------------|
| zod | ^4.3.6 | Validate new `description` field in `createAssetSchema`; validate extended `SearchCategory` enum |
| lucide-react | ^1.6.0 | Icons for new All/Note/Asset tabs in search UI |

---

## Schema Change Required

### Add `description` to `ProjectAsset`

```prisma
model ProjectAsset {
  id          String   @id @default(cuid())
  filename    String
  path        String
  mimeType    String?
  size        Int?
  description String?          // ADD: human-readable description for search
  projectId   String
  createdAt   DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
}
```

**Why `String?` (optional):** Existing assets have no description. A required field would fail `db push` on a populated database without a default. Optional is the honest model here.

**Deployment:** `pnpm db:push` — no migration file needed. The project uses `prisma db push` throughout (no `prisma/migrations/` directory exists). This is consistent.

---

## Code Integration Points

### 1. `src/actions/search-actions.ts`

**Current state:** `SearchCategory = "task" | "project" | "repository"`. Single-category `if` chain, returns up to 20 results per type.

**Required changes:**

- Extend the type: `SearchCategory = "task" | "project" | "repository" | "note" | "asset" | "all"`
- Add `"note"` branch: call `searchAllNotes(db, query)` (new function from `src/lib/fts.ts`), map results to `SearchResult` with `type: "note"` and `navigateTo` pointing to the note's project
- Add `"asset"` branch: Prisma LIKE query on `ProjectAsset.filename` and `ProjectAsset.description`; include `project.workspace` for subtitle context
- Add `"all"` branch: `Promise.all([taskSearch, projectSearch, repoSearch, noteSearch, assetSearch])` with a per-type cap of 5 results each (25 total max); flatten and return — the UI handles grouping by type

### 2. `src/lib/fts.ts`

**Current state:** `searchNotes(db, projectId, query)` — project-scoped. Returns `FtsNoteResult[]` with `note_id`, `title`, `content`.

**Required change:** Add `searchAllNotes(db, query)` that drops the `projectId` filter and joins `ProjectNote → Project → Workspace` for context needed by the search result subtitle.

```typescript
// New function — add to src/lib/fts.ts
export interface FtsNoteGlobalResult {
  note_id: string;
  title: string;
  content: string;
  projectId: string;
  projectName: string;
  workspaceName: string;
  workspaceId: string;
}

export async function searchAllNotes(
  db: PrismaClient,
  query: string
): Promise<FtsNoteGlobalResult[]>
```

The existing `searchNotes(db, projectId, query)` stays untouched — it is used by the notes panel and must remain project-scoped.

### 3. `src/mcp/tools/search-tools.ts`

**Current state:** `category` enum is `"task" | "project" | "repository"`.

**Required change:** Mirror `search-actions.ts` — add `"note"`, `"asset"`, and `"all"` to the `category` enum. This extends the existing `search` tool rather than adding new tools, preserving the MCP tool count (currently 21/30).

### 4. `src/actions/asset-actions.ts`

**Required changes:**

- Add `description?: string` to `createAsset` input type and `createAssetSchema` Zod schema: `description: z.string().max(500).optional()`
- Add `description` to `uploadAsset`: read from `formData.get("description")` and pass through to `createAsset`
- No changes to `deleteAsset` or `getProjectAssets` — they use Prisma's generated types which will include `description` automatically after schema push

### 5. Upload dialog component

**Required change:** Add a `<textarea>` or `<input>` for description in the existing asset upload form. Pass `description` via `FormData`. No new UI primitives needed — the existing form pattern applies.

### 6. Search UI component

**Required change:** Add tabs for `All`, `Note`, `Asset` alongside existing `Task`, `Project`, `Repository`. The `All` tab renders results grouped by type with section headers. No new component library needed — the existing tab and search result item components extend to cover these cases.

---

## FTS5 for Asset Search — Decision

**Decision: Do NOT create an `assets_fts` virtual table. Use Prisma LIKE.**

**Rationale:**
- Asset filenames and descriptions are short strings (not long prose like notes)
- The `notes_fts` table exists because notes have long markdown content where full-table LIKE scans degrade over time
- Assets have at most hundreds of rows per project; a LIKE query across all assets is instantaneous at this scale
- Creating `assets_fts` would require sync logic in `createAsset` and `deleteAsset` (similar to `syncNoteToFts`/`deleteNoteFromFts` in `src/lib/fts.ts`) — that complexity has no measurable benefit here
- FTS5 trigram tokenization requires 3+ character queries anyway; LIKE handles short queries (1-2 chars) more naturally

**Use:** `db.projectAsset.findMany({ where: { OR: [{ filename: { contains: q } }, { description: { contains: q } }] } })` — same pattern as the existing task/project/repository LIKE search.

---

## Global Note Search — FTS5 Strategy

**Decision: Extend the existing `notes_fts` virtual table for cross-project (global) note search.**

The existing `notes_fts` virtual table already indexes all notes across all projects. The current `searchNotes` function only filters to one project by adding `AND n."projectId" = ?` in the JOIN. A new `searchAllNotes` function removes that filter and adds workspace context via an additional join. No schema changes to `notes_fts` are needed.

---

## Alternatives Considered

| Decision | Alternative | Why Not |
|----------|-------------|---------|
| LIKE for asset search | Create `assets_fts` virtual table | FTS5 sync complexity not justified; short strings at hundreds-of-rows scale don't benefit |
| Extend existing `search` MCP tool with new category values | Add separate `search_notes`, `search_assets` tools | Would push tool count higher; action-dispatch via extended enum is the v0.2-established pattern |
| Optional `description` on ProjectAsset | Required with empty string default | Breaking change for existing rows; optional is semantically correct |
| New `searchAllNotes` function | Modify existing `searchNotes` signature to accept optional `projectId` | Changing the signature breaks the notes panel callers; a new function is cleaner and keeps existing behavior unchanged |
| `Promise.all` for "all" mode | Sequential category queries | Parallel is strictly better; queries are independent and SQLite handles concurrent reads fine |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `better-sqlite3` direct driver | Prisma is the ORM; mixing raw drivers creates two connection pools | Prisma `$queryRawUnsafe` for FTS5 (established pattern in `src/lib/fts.ts`) |
| `fuse.js` for search | Fuzzy client-side matching on small in-memory datasets; already used for project identification in MCP — not needed in global search | Server-side SQLite LIKE + FTS5 (already handles fuzzy via trigram) |
| Client-side search (fuse.js, minisearch) | Would require sending all records to the browser; breaks Server Action pattern | Server-side `globalSearch` Server Action |
| Semantic search / embeddings | Explicitly out of scope per PROJECT.md | FTS5 trigram is sufficient |
| `prisma migrate dev` | Project uses `prisma db push`; no migrations directory exists; stay consistent | `pnpm db:push` |

---

## Installation

No new packages required for v0.3.

```bash
# Schema change only — no new installs
pnpm db:push
```

---

## Version Compatibility

All packages are already installed and compatible:

| Package | Version | Compatibility Notes |
|---------|---------|---------------------|
| `@prisma/client` | ^6.19.2 | `$queryRawUnsafe` available; FTS5 virtual table queries confirmed working in v0.2 |
| `zod` | ^4.3.6 | `.optional()` and `.max()` for new `description` field validation |
| `next` | 16.2.1 | Server Actions for extended `globalSearch` |

---

## Sources

- Codebase inspection: `src/actions/search-actions.ts`, `src/lib/fts.ts`, `src/actions/asset-actions.ts`, `prisma/init-fts.ts`, `prisma/schema.prisma` — HIGH confidence (direct read)
- `package.json` — confirmed zero new dependencies needed — HIGH confidence
- PROJECT.md v0.3 milestone requirements — authoritative spec — HIGH confidence
- [SQLite FTS5 documentation](https://www.sqlite.org/fts5.html) — trigram tokenizer 3-character minimum; virtual table behavior — HIGH confidence

---

*Stack research for: ai-manager v0.3 — global search enhancement, notes FTS5 search, asset search, description field*
*Researched: 2026-03-30*
