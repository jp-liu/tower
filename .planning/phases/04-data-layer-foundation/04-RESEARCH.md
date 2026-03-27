# Phase 4: Data Layer Foundation - Research

**Researched:** 2026-03-27
**Domain:** Prisma schema extension, SQLite FTS5, filesystem utilities, dual-process PrismaClient safety
**Confidence:** HIGH

## Summary

Phase 4 establishes the data layer for the notes and assets features. It involves three distinct concerns: (1) extending the Prisma schema with `ProjectNote` and `ProjectAsset` models and running `db push`, (2) creating the FTS5 virtual table via raw SQL after `db push` and exposing a `fts.ts` search utility, and (3) creating `file-utils.ts` for `data/assets/` and `data/cache/` directory management.

The existing codebase uses `prisma db push` (no migrations), SQLite in WAL mode, and two separate `PrismaClient` instances — one for Next.js (`src/lib/db.ts`) and one for MCP stdio (`src/mcp/db.ts`). Both instances need `PRAGMA busy_timeout=5000` added. The FTS5 trigram tokenizer is confirmed available in the bundled SQLite (version 3.43.2) and works for Chinese and English, with the constraint that search queries must be 3 or more characters.

**Primary recommendation:** Extend `schema.prisma`, run `db:push`, then run a one-time `db:init-fts` script via `$executeRawUnsafe` to create the virtual table. Add `busy_timeout` pragma to both `db.ts` files. Write `src/lib/fts.ts` and `src/lib/file-utils.ts` with zero Next.js imports.

---

<user_constraints>
## User Constraints (from STATE.md Decisions)

### Locked Decisions
- FTS5 virtual tables must be created via raw SQL AFTER `prisma db push` — never before, or Prisma detects schema drift.
- Both PrismaClient instances (Next.js + MCP) need `PRAGMA busy_timeout=5000` to prevent "database is locked" errors.
- MCP tools use action-dispatch pattern (`manage_notes`, `manage_assets`) to keep total tool count at or below 30. (Scoped to Phase 5, but data layer must support it.)
- `file-utils.ts` and `fts.ts` must never import Next.js modules — they are shared between Next.js and MCP stdio processes.
- `@uiw/react-md-editor` requires dynamic import with `ssr:false` — relevant to Phase 7, deferred.

### Claude's Discretion
- NoteCategory implementation approach: Prisma enum vs. plain String column with a constant list.
- FTS5 search fallback strategy for queries shorter than 3 characters.
- Exact directory for `file-utils.ts` and `fts.ts` within `src/lib/`.
- Whether to expose a `db:init-fts` npm script or inline FTS init in both `db.ts` files.

### Deferred Ideas (OUT OF SCOPE)
- Phase 5: MCP tools `manage_notes`, `manage_assets`, `identify_project`.
- Phase 6: File serving API route, path traversal protection.
- Phase 7: Notes/Assets web UI, `@uiw/react-md-editor`.
- SRCH-01/02, COLLAB-01/02 (future requirements).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NOTE-01 | User can create, read, update, delete Markdown notes per project | Prisma `ProjectNote` model; CRUD via server actions |
| NOTE-02 | Notes support preset categories (账号/环境/需求/备忘) and custom categories | `NoteCategory` string column + enum-like constant list; queryable per project |
| NOTE-03 | FTS5 full-text search over note content (Chinese and English) | Confirmed: FTS5 trigram tokenizer works; min 3-char query constraint documented |
| ASST-01 | User can save project-level persistent assets under `data/assets/{projectId}/` | `ProjectAsset` Prisma model + `file-utils.ts` for directory creation/listing |
| ASST-02 | Task-level temp files stored in `data/cache/{taskId}/`; manual cleanup | `file-utils.ts` helper; `fs.mkdirSync` with `{ recursive: true }` |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@prisma/client` | 6.19.2 (project-locked) | ORM for `ProjectNote`, `ProjectAsset` models | Already in use; `db push` workflow established |
| `prisma` | 6.19.2 (project-locked) | Schema management and `db push` | Already in use |
| `node:fs` (built-in) | Node 22.17.0 | `data/assets/` and `data/cache/` directory management | No dependency needed; `fs.mkdirSync` with `recursive:true` |
| SQLite FTS5 | 3.43.2 (bundled by Prisma) | Full-text search over note content | Confirmed available; trigram tokenizer supports Chinese |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:path` (built-in) | Node 22.17.0 | Safe path construction for `data/` directories | Always use `path.join(process.cwd(), 'data', ...)` |
| `zod` | ^4.3.6 (project-locked) | Input validation for note/asset server actions | Per project patterns — all actions validate inputs |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| String column for NoteCategory | Prisma enum | SQLite enums are stored as strings anyway; string column with TS union type is simpler and allows custom categories without schema changes |
| FTS5 trigram | unicode61 tokenizer | unicode61 breaks on CJK characters (each character is a separate token; no bi-gram or substring matching) — trigram is the only tokenizer that supports CJK substring search in SQLite's bundled FTS5 |
| One-time init script | Inline FTS init in db.ts | Inline in db.ts risks creating the table before `db push` completes on first run; a separate `db:init-fts` npm script is explicit and order-safe |

**Installation:** No new packages needed. All dependencies already present.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── db.ts              # Next.js PrismaClient (add busy_timeout pragma)
│   ├── fts.ts             # FTS5 search helper (no Next.js imports)
│   ├── file-utils.ts      # data/assets/ and data/cache/ helpers (no Next.js imports)
│   └── ...
├── actions/
│   ├── note-actions.ts    # "use server" CRUD for ProjectNote
│   └── asset-actions.ts   # "use server" CRUD for ProjectAsset
├── mcp/
│   └── db.ts              # MCP PrismaClient (add busy_timeout pragma)
└── ...
prisma/
├── schema.prisma          # Add ProjectNote, ProjectAsset models
└── init-fts.ts            # One-time FTS5 virtual table creation script
```

### Pattern 1: Prisma Schema Extension

**What:** Add `ProjectNote` and `ProjectAsset` models with foreign keys to `Project`.
**When to use:** Whenever new persistent data models are required.

```typescript
// prisma/schema.prisma additions

model ProjectNote {
  id          String   @id @default(cuid())
  title       String
  content     String   // Markdown text
  category    String   // "账号" | "环境" | "需求" | "备忘" | custom string
  projectId   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
  @@index([category])
}

model ProjectAsset {
  id        String   @id @default(cuid())
  filename  String
  path      String   // relative: "data/assets/{projectId}/{filename}"
  mimeType  String?
  size      Int?
  projectId String
  createdAt DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
}
```

Add `notes` and `assets` relations back to the `Project` model:
```typescript
// In the existing Project model, add:
notes  ProjectNote[]
assets ProjectAsset[]
```

### Pattern 2: FTS5 Virtual Table Creation (Post-Push)

**What:** Create the FTS5 virtual table via a one-time raw SQL script run after `prisma db push`.
**When to use:** Any time the schema is re-pushed to a fresh database.

```typescript
// prisma/init-fts.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  await db.$connect();
  // MUST run after prisma db push — never before
  await db.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
    USING fts5(
      note_id UNINDEXED,
      title,
      content,
      tokenize='trigram case_sensitive 0'
    )
  `);
  console.log("FTS5 table initialized");
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Add to `package.json` scripts:
```json
"db:init-fts": "tsx prisma/init-fts.ts"
```

Workflow: `pnpm db:push && pnpm db:init-fts`

### Pattern 3: FTS5 Search Helper (fts.ts)

**What:** Thin wrapper around `$queryRawUnsafe` for FTS5 search. Falls back to `LIKE` for queries shorter than 3 characters (FTS5 trigram minimum).
**When to use:** Any note search operation.

```typescript
// src/lib/fts.ts — NO Next.js imports
import { PrismaClient } from "@prisma/client";

export interface FtsNoteResult {
  note_id: string;
  title: string;
  content: string;
}

export async function searchNotes(
  db: PrismaClient,
  projectId: string,
  query: string
): Promise<FtsNoteResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (trimmed.length < 3) {
    // Fallback: LIKE search on the regular note table
    return db.$queryRawUnsafe<FtsNoteResult[]>(
      `SELECT id as note_id, title, content FROM "ProjectNote"
       WHERE project_id = ? AND (title LIKE ? OR content LIKE ?)
       LIMIT 20`,
      projectId,
      `%${trimmed}%`,
      `%${trimmed}%`
    );
  }

  // FTS5 trigram search (3+ chars)
  return db.$queryRawUnsafe<FtsNoteResult[]>(
    `SELECT f.note_id, f.title, f.content
     FROM notes_fts f
     JOIN "ProjectNote" n ON n.id = f.note_id
     WHERE f.notes_fts MATCH ? AND n.project_id = ?
     ORDER BY rank
     LIMIT 20`,
    trimmed,
    projectId
  );
}
```

### Pattern 4: FTS5 Sync (Keep in Sync with ProjectNote)

**What:** Keep `notes_fts` virtual table in sync with `ProjectNote` records using explicit raw SQL insert/delete.
**When to use:** After every note create, update, or delete.

```typescript
// In note-actions.ts (conceptually):
// After db.projectNote.create(...):
await db.$executeRawUnsafe(
  "INSERT INTO notes_fts(note_id, title, content) VALUES (?, ?, ?)",
  note.id, note.title, note.content
);

// After db.projectNote.update(...):
await db.$executeRawUnsafe(
  "DELETE FROM notes_fts WHERE note_id = ?", id
);
await db.$executeRawUnsafe(
  "INSERT INTO notes_fts(note_id, title, content) VALUES (?, ?, ?)",
  note.id, note.title, note.content
);

// After db.projectNote.delete(...):
await db.$executeRawUnsafe(
  "DELETE FROM notes_fts WHERE note_id = ?", id
);
```

### Pattern 5: Dual PrismaClient busy_timeout

**What:** Both Next.js and MCP PrismaClient instances set `PRAGMA busy_timeout=5000` and `PRAGMA journal_mode=WAL` at connect time.
**When to use:** Always — prevents "database is locked" when both processes access the DB concurrently.

```typescript
// src/lib/db.ts — updated
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

async function createDb(): Promise<PrismaClient> {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  });
  await client.$connect();
  await client.$queryRaw`PRAGMA journal_mode=WAL`;
  await client.$queryRaw`PRAGMA busy_timeout=5000`;
  return client;
}

export const db: PrismaClient =
  globalForPrisma.prisma ??
  (() => {
    // Note: pragmas are set lazily — call ensureDb() for critical paths
    const client = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["query"] : [],
    });
    return client;
  })();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

**Important nuance:** `PrismaClient` in Next.js is synchronous to initialize (singleton pattern). The PRAGMA must be set before first use. The safest approach is to add the pragmas to `src/mcp/db.ts`'s `initDb()` function (already has connect) and add a similar `initDb` export to `src/lib/db.ts` called at app startup in a layout or instrumentation file.

### Pattern 6: File Utilities (file-utils.ts)

**What:** Stateless functions for creating and querying `data/assets/` and `data/cache/` directories.
**When to use:** Any MCP tool or server action that needs the filesystem.

```typescript
// src/lib/file-utils.ts — NO Next.js imports
import * as fs from "node:fs";
import * as path from "node:path";

// All paths are relative to process.cwd() (project root)
const DATA_ROOT = path.join(process.cwd(), "data");

export function getAssetsDir(projectId: string): string {
  return path.join(DATA_ROOT, "assets", projectId);
}

export function getCacheDir(taskId: string): string {
  return path.join(DATA_ROOT, "cache", taskId);
}

export function ensureAssetsDir(projectId: string): string {
  const dir = getAssetsDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureCacheDir(taskId: string): string {
  const dir = getCacheDir(taskId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listAssetFiles(projectId: string): string[] {
  const dir = getAssetsDir(projectId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}
```

### Anti-Patterns to Avoid

- **Creating FTS5 table before `db push`:** Prisma's shadow database checks for drift and will error if the virtual table exists. Always `db push` first.
- **Using `$executeRaw` with Prisma.sql template for PRAGMA that returns results:** `$executeRaw` rejects when SQLite returns rows. Use `$queryRaw` for read PRAGMAs (`PRAGMA journal_mode=WAL` returns `{"journal_mode":"wal"}`).
- **Importing from `next/cache` or `next/server` in `fts.ts` or `file-utils.ts`:** These files run in the MCP stdio process which has no Next.js runtime. Keep them pure Node.js.
- **Using the unicode61 FTS5 tokenizer for Chinese:** It tokenizes CJK characters individually and cannot do substring matching. Only trigram works for Chinese keyword search.
- **Relying on 1-2 char FTS5 queries returning results:** The trigram tokenizer silently returns empty results for queries shorter than 3 characters. Always implement the LIKE fallback.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Full-text search | Custom inverted index | SQLite FTS5 with trigram | Built into SQLite; handles ranking, escaping, concurrent reads |
| Directory creation | Manual path checks | `fs.mkdirSync(dir, { recursive: true })` | Atomic, handles race conditions, cross-platform |
| Schema drift prevention | Custom migration script | `prisma db push` | Handles column additions, type changes, index creation |
| Note CRUD | Direct `$queryRaw` calls | Prisma typed model operations | Type-safe, cascade deletes, relation loading |

**Key insight:** The only custom SQL needed in this phase is the FTS5 virtual table DDL (Prisma cannot express virtual tables) and the FTS5 sync DML. Everything else should use typed Prisma operations.

---

## Common Pitfalls

### Pitfall 1: FTS5 Table Survives db:push and Causes Drift

**What goes wrong:** Developer runs `prisma db push` after adding schema models. Prisma detects the `notes_fts` virtual table it doesn't know about and errors on `--force-reset`, or shadow database reports drift.
**Why it happens:** Prisma introspects the database to detect drift. Virtual tables appear as unknown tables.
**How to avoid:** Always use `IF NOT EXISTS` in the FTS5 CREATE statement. Never include it in schema.prisma. Document the required run order: `db:push` then `db:init-fts`.
**Warning signs:** `prisma db push` output includes "Drift detected" or errors referencing `notes_fts`.

### Pitfall 2: Database Locked Error Under Concurrent Access

**What goes wrong:** Next.js server and MCP stdio process both try to write to SQLite simultaneously. One gets `SQLITE_BUSY: database is locked`.
**Why it happens:** SQLite default timeout is 0ms — it fails immediately on a lock rather than waiting.
**How to avoid:** Set `PRAGMA busy_timeout=5000` in both PrismaClient instances before first use. WAL mode (already set in MCP db.ts) also reduces lock contention by allowing concurrent readers.
**Warning signs:** Intermittent `P2010` Prisma errors with code `SQLITE_BUSY`.

### Pitfall 3: FTS5 and ProjectNote Out of Sync

**What goes wrong:** A note is deleted from `ProjectNote` but the FTS5 row remains. Search returns results for deleted notes. Or a note is updated but FTS5 still has old content.
**Why it happens:** FTS5 virtual table is not a Prisma model — cascade deletes and updates don't propagate automatically.
**How to avoid:** Every `note-actions.ts` create/update/delete must include a corresponding raw SQL statement to sync `notes_fts`. Wrap both in a `db.$transaction` (Prisma interactive transaction).
**Warning signs:** `searchNotes` returns note IDs that don't exist in `ProjectNote`.

### Pitfall 4: process.cwd() Returns Different Paths in Next.js vs MCP

**What goes wrong:** `file-utils.ts` uses `process.cwd()` to anchor `data/`. In Next.js dev server, cwd is the project root. But if MCP is launched from a different directory, `data/` is created in the wrong place.
**Why it happens:** stdio process inherits cwd from the terminal that launched it.
**How to avoid:** Document that MCP must be launched from the project root (`npx tsx src/mcp/index.ts` from the project root). Consider using `DATABASE_URL` env var path as a reference to derive the project root in `file-utils.ts` as a fallback.
**Warning signs:** `data/assets/` created in wrong directory; assets not found by file serving routes.

### Pitfall 5: BigInt Serialization in Prisma $queryRaw Results

**What goes wrong:** `JSON.stringify()` throws `TypeError: Do not know how to serialize a BigInt` when serializing Prisma raw query results in Node.js tests or logging.
**Why it happens:** SQLite numeric results from `$queryRaw` may be returned as BigInt by the Prisma client.
**How to avoid:** Never call `JSON.stringify` directly on raw query results. Use `.toString()` or custom replacer: `JSON.stringify(r, (k, v) => typeof v === 'bigint' ? v.toString() : v)`.
**Warning signs:** Test crashes with BigInt serialization error in unit tests that call raw SQL helpers.

---

## Code Examples

Verified patterns from direct testing against the project's SQLite database:

### FTS5 Virtual Table Creation
```sql
-- Source: Verified against SQLite 3.43.2 bundled with Prisma 6.19.2
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
USING fts5(
  note_id UNINDEXED,
  title,
  content,
  tokenize='trigram case_sensitive 0'
);
```

### FTS5 Search via Prisma (3+ chars)
```typescript
// Source: Verified with node against project dev.db
const results = await db.$queryRawUnsafe<FtsNoteResult[]>(
  'SELECT * FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank',
  query  // must be 3+ chars
);
```

### PRAGMA Setup via queryRaw (not executeRaw)
```typescript
// Source: Verified — executeRaw fails when PRAGMA returns rows
await db.$queryRaw`PRAGMA journal_mode=WAL`;
await db.$queryRaw`PRAGMA busy_timeout=5000`;
```

### Directory Creation
```typescript
// Source: Node.js built-in, verified
import * as fs from "node:fs";
fs.mkdirSync(path.join(process.cwd(), "data", "assets", projectId), { recursive: true });
fs.mkdirSync(path.join(process.cwd(), "data", "cache", taskId), { recursive: true });
```

### NoteCategory Constants (TypeScript)
```typescript
// src/lib/constants.ts addition
export const NOTE_CATEGORIES_PRESET = ["账号", "环境", "需求", "备忘"] as const;
export type NoteCategoryPreset = typeof NOTE_CATEGORIES_PRESET[number];
// category column is plain String — allows custom values beyond preset list
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Prisma migrations | `prisma db push` (schema push) | Project choice from start | No migration files; simpler local dev; not suitable for production multi-environment |
| unicode61 FTS5 tokenizer | trigram tokenizer for CJK support | N/A — both always existed | trigram is the correct choice for any app with Chinese content |
| Global `PrismaClient` without WAL | WAL mode + busy_timeout | MCP db.ts already has WAL; Next.js db.ts does not yet | Phase 4 adds busy_timeout to both |

**Deprecated/outdated:**
- Running `PRAGMA journal_mode=WAL` at every connection: WAL persists across connections in SQLite; setting it once is enough. However, setting it idempotently on connect is safe and the project already does it in MCP db.ts — continue the pattern.

---

## Open Questions

1. **PRAGMA busy_timeout in Next.js Singleton**
   - What we know: Next.js `db.ts` uses a synchronous singleton pattern; pragmas are async.
   - What's unclear: Where to trigger the async pragma setup in Next.js without adding complexity (layout, instrumentation.ts, or lazy on first server action call).
   - Recommendation: Add `export async function initDb()` to `src/lib/db.ts` mirroring the MCP pattern, and call it from a Next.js `instrumentation.ts` file (Next.js 15+ supports this natively).

2. **FTS5 Sync in Prisma Transactions**
   - What we know: Prisma supports interactive transactions (`db.$transaction(async (tx) => { ... })`).
   - What's unclear: Whether `tx.$executeRawUnsafe` works inside a Prisma interactive transaction.
   - Recommendation: Test in Wave 1 of the plan. If it doesn't work, use a sequential try/catch approach and document the consistency risk.

3. **data/ directory in .gitignore**
   - What we know: `data/` does not yet exist.
   - What's unclear: Whether `data/assets/` should be gitignored (user files) vs tracked.
   - Recommendation: Add `data/` to `.gitignore`. Asset files are runtime data, not source code.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| SQLite FTS5 | NOTE-03 full-text search | Yes | Bundled with SQLite 3.43.2 (Prisma 6.19.2) | — |
| Node.js `fs` module | ASST-01, ASST-02 | Yes | Node 22.17.0 | — |
| `tsx` | `db:init-fts` script | Yes | ^4.21.0 | — |
| `prisma` CLI | `db:push` | Yes | 6.19.2 | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

---

## Validation Architecture

> `workflow.nyquist_validation` is absent from `.planning/config.json` — treated as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `pnpm test:run --reporter=verbose tests/unit/lib/` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NOTE-01 | `ProjectNote` CRUD via Prisma (create/read/update/delete) | integration | `pnpm test:run tests/unit/lib/note-actions.test.ts -x` | No — Wave 0 |
| NOTE-02 | NoteCategory preset values queryable per project | unit | `pnpm test:run tests/unit/lib/note-categories.test.ts -x` | No — Wave 0 |
| NOTE-03 | FTS5 returns results for Chinese and English 3+ char queries | integration | `pnpm test:run tests/unit/lib/fts.test.ts -x` | No — Wave 0 |
| ASST-01 | `ProjectAsset` record saved with path under `data/assets/{projectId}/` | integration | `pnpm test:run tests/unit/lib/asset-actions.test.ts -x` | No — Wave 0 |
| ASST-02 | `data/cache/{taskId}/` directory created programmatically | unit | `pnpm test:run tests/unit/lib/file-utils.test.ts -x` | No — Wave 0 |

**Notes on integration tests:** Vitest runs in jsdom environment by default. Tests that use Prisma against a real SQLite DB need `environment: 'node'` (add `@vitest-environment node` docblock or configure per-file). Consider using `DATABASE_URL=file:./prisma/test.db` for tests, or use the existing dev.db with cleanup.

### Sampling Rate
- **Per task commit:** `pnpm test:run tests/unit/lib/ --reporter=dot`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/lib/fts.test.ts` — covers NOTE-03; needs `@vitest-environment node` and real SQLite
- [ ] `tests/unit/lib/file-utils.test.ts` — covers ASST-02; needs temp directory setup/teardown
- [ ] `tests/unit/lib/note-actions.test.ts` — covers NOTE-01; needs Prisma test client or mock
- [ ] `tests/unit/lib/note-categories.test.ts` — covers NOTE-02; pure unit test of constants and filtering
- [ ] `tests/unit/lib/asset-actions.test.ts` — covers ASST-01; needs Prisma test client

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Read Next.js guide in `node_modules/next/dist/docs/` before writing any code** — breaking changes from standard Next.js may apply.
- No `console.log` in production code (TypeScript hooks rule).
- Use Zod for input validation at system boundaries.
- Files must be < 800 lines; functions < 50 lines.
- No mutation — use immutable patterns.
- Test coverage minimum 80%.
- `fts.ts` and `file-utils.ts` must be zero-import from Next.js (shared with MCP stdio process).
- FTS5 virtual table created AFTER `prisma db push` (locked decision from pre-v0.2 discussion).

---

## Sources

### Primary (HIGH confidence)
- Direct SQLite CLI testing against `prisma/dev.db` (SQLite 3.43.2) — FTS5 trigram behavior, 3-char minimum, Chinese/English results
- Direct Prisma Node.js testing — `$queryRaw`, `$executeRawUnsafe`, PRAGMA behavior, BigInt serialization
- `prisma/schema.prisma` — existing model patterns, index conventions, cascade delete patterns
- `src/mcp/db.ts` — existing WAL+connect pattern
- `src/lib/db.ts` — existing Next.js singleton pattern
- `package.json` — confirmed no `better-sqlite3`, confirmed `tsx`, confirmed `vitest`

### Secondary (MEDIUM confidence)
- SQLite FTS5 documentation (https://www.sqlite.org/fts5.html) — trigram tokenizer, case_sensitive option, minimum gram size
- Prisma SQLite documentation — raw query patterns, transaction support

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified in project; no new packages needed
- Architecture: HIGH — FTS5 behavior verified with actual queries; Prisma patterns verified with actual code
- Pitfalls: HIGH — all pitfalls discovered through live testing (BigInt, executeRaw vs queryRaw, 2-char FTS5 limit)

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (SQLite and Prisma versions are project-locked; FTS5 behavior stable)
