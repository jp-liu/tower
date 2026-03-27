# Pitfalls Research

**Domain:** Knowledge base, notes, file management, and expanded MCP tools added to existing Next.js 16 + SQLite + Prisma system
**Researched:** 2026-03-27
**Confidence:** HIGH (pitfalls derived from codebase inspection, Prisma issue tracker, official SQLite docs, MCP spec, and multiple community sources)

---

## Critical Pitfalls

### Pitfall 1: FTS5 Shadow Tables Break Prisma db push

**What goes wrong:**
SQLite FTS5 virtual tables automatically create internal "shadow tables" (e.g., `notes_fts_data`, `notes_fts_idx`, `notes_fts_content`, `notes_fts_docsize`, `notes_fts_config`). Prisma's `db push` sees these shadow tables as schema drift — tables it didn't create and doesn't know about. The result is either a prompt to reset the database (destroying all data) or a migration failure that leaves the schema half-applied.

**Why it happens:**
Prisma tracks schema state by comparing its model definitions against the actual database. FTS5 shadow tables are SQLite internals with no Prisma model equivalents. As of Prisma 6.x, this is a confirmed open issue ([#8106](https://github.com/prisma/prisma/issues/8106)). The FTS5 virtual table itself is skipped, but its shadow tables are not, causing drift detection to fire.

**How to avoid:**
Do NOT create FTS5 indexes via `prisma db push` schema changes. Instead:
1. Create the FTS5 virtual table using a raw SQL seed/migration script run once at startup
2. Use `db.$executeRaw` in a setup function called during database initialization
3. The `initDb()` function in `src/mcp/db.ts` already sets `PRAGMA journal_mode=WAL` — add FTS5 setup there
4. For the Next.js side, run FTS5 setup in a startup module (not per-request)

```typescript
// Add to initDb() or a dedicated setupFts() call
await db.$executeRaw`
  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
  USING fts5(title, content, content='Note', content_rowid='id')
`;
// Keep FTS in sync with triggers on INSERT/UPDATE/DELETE
await db.$executeRaw`
  CREATE TRIGGER IF NOT EXISTS notes_fts_insert
  AFTER INSERT ON "Note" BEGIN
    INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
  END
`;
```

**Warning signs:**
- `prisma db push` shows "The following changes will be made to the database" with unexpected table drops
- `prisma db push` prompts "We need to reset the database" — STOP immediately
- After a `db push`, notes become unsearchable (FTS table was dropped)

**Phase to address:**
Phase 1 (Note CRUD + Schema). Set up FTS5 outside Prisma schema before building any search feature.

---

### Pitfall 2: Two Separate PrismaClient Instances Writing to the Same SQLite File

**What goes wrong:**
The Next.js app (`src/lib/db.ts`) and the MCP server (`src/mcp/db.ts`) are separate processes that each instantiate a `PrismaClient` pointing at the same `prisma/dev.db` file. When both are active simultaneously — which is the normal operating mode — concurrent writes can trigger `SQLITE_BUSY` / "database is locked" errors. This is especially likely when MCP tools perform note/asset writes at the same time as the web UI saves notes.

**Why it happens:**
SQLite WAL mode allows one writer at a time. When two processes try to write simultaneously, the second one blocks and eventually times out if the first holds the lock too long. The MCP process already sets `PRAGMA journal_mode=WAL` (in `initDb()`), but the Next.js process does not. Without WAL mode on both sides, even short concurrent writes contend on a journal lock. Additionally, there is no `busy_timeout` set on either connection, so lock contention fails immediately instead of retrying.

**How to avoid:**
1. Ensure both `src/lib/db.ts` and `src/mcp/db.ts` set `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` on connection open
2. Add to `src/lib/db.ts` startup:
```typescript
// After creating PrismaClient
await db.$executeRawUnsafe('PRAGMA journal_mode=WAL');
await db.$executeRawUnsafe('PRAGMA busy_timeout=5000');
```
3. Keep write transactions short — avoid holding open transactions while waiting for user input
4. For file move operations (mv), complete the database record update in a single fast transaction; don't interleave filesystem I/O inside a transaction

**Warning signs:**
- Intermittent 500 errors from server actions when MCP is active
- `PrismaClientKnownRequestError` with code `P1001` or SQLite error code `SQLITE_BUSY`
- Note saves fail only when Claude Code agent is actively running tasks

**Phase to address:**
Phase 1 (Schema + Database Setup). Add WAL/timeout pragmas to both DB clients before any concurrent write path is built.

---

### Pitfall 3: fs.rename() Fails Across Filesystem Boundaries (EXDEV Error)

**What goes wrong:**
The v0.2 design uses `mv` (file rename/move) to transfer files from a source path (e.g., `/tmp/...` or the AI agent's working directory) into `data/assets/{projectId}/` or `data/cache/{taskId}/`. On macOS with Docker volumes, or when `/tmp` and the project directory are on different filesystems or APFS volumes, `fs.rename()` throws `EXDEV: cross-device link not permitted`. The app crashes or returns an error; the file is not moved and no cleanup occurs.

**Why it happens:**
`fs.rename()` calls the OS `rename(2)` syscall, which only works within the same filesystem. It cannot atomically move across device/filesystem boundaries. This is a Node.js fundamental constraint, not a bug. AI agents often write output to `/tmp` or their working directory, which may be on a different volume than `data/`.

**How to avoid:**
Never use `fs.rename()` directly for user-initiated file moves. Use a helper that:
1. Attempts `fs.rename()` first (fast path, same-filesystem)
2. On `EXDEV` error, falls back to `fs.copyFile()` followed by `fs.unlink()` (copy-then-delete)

```typescript
import { rename, copyFile, unlink } from 'fs/promises';

async function moveFile(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      await copyFile(src, dest);
      await unlink(src);
    } else {
      throw err;
    }
  }
}
```

This pattern is identical to how `npm`, `pnpm`, and other tools handle cross-device moves.

**Warning signs:**
- `Error: EXDEV: cross-device link not permitted, rename` in server logs
- File moves work in local development but fail in certain environments (Docker, network mounts)
- Attachment links in messages are broken even though the file exists at the source

**Phase to address:**
Phase 3 (File Management / Asset Storage). Implement the `moveFile` utility before the first MCP tool that performs file moves.

---

### Pitfall 4: Unvalidated File Paths Allow Directory Traversal

**What goes wrong:**
MCP tools and server actions that accept a `sourcePath` parameter for `mv` operations can be exploited to read or overwrite arbitrary files if the path is not validated. Even in a localhost-only single-user tool, a misbehaving or compromised AI agent could pass a path like `../../prisma/dev.db` or `../../.env` as the source, causing the move operation to expose or destroy sensitive files.

**Why it happens:**
`mv` operations require accepting an external file path as input. Without validation, any path is accepted. The MCP server already runs as a separate process with full filesystem access. An AI agent's tool call is untrusted input — it could produce any path string.

**How to avoid:**
For destination paths: always construct them from trusted components (projectId + filename), never from raw user/agent input.

For source paths (the file being moved in): validate that the path is under an allowed source root. Since the use case is "AI agent writes a file to its working directory, then hands path to ai-manager," the source should be restricted to known project `localPath` values or explicitly whitelisted directories.

```typescript
import path from 'path';

function validateSourcePath(src: string, allowedRoot: string): string {
  const resolved = path.resolve(src);
  const root = path.resolve(allowedRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Source path outside allowed root: ${src}`);
  }
  return resolved;
}
```

Additionally, sanitize filenames before writing to `data/assets/` — reject names containing `..`, `/`, or null bytes.

**Warning signs:**
- MCP tool accepts arbitrary path strings with no validation
- `data/` directory contains files named with `..` segments
- `fs.stat()` on a "source" path resolves to a sensitive file (DB, .env, private key)

**Phase to address:**
Phase 3 (File Management). Implement path validation utility before the first file-accepting MCP tool.

---

### Pitfall 5: MCP Tool Proliferation Degrades AI Agent Performance

**What goes wrong:**
The existing MCP server exposes 18 tools. v0.2 adds approximately 8-10 more (note CRUD, asset management, enhanced search, fuzzy project resolution). At ~28 tools, each tool definition consuming 400-500 tokens means the tool list alone consumes 11,000-14,000 tokens of context before any conversation begins. Tool calling accuracy declines measurably at this scale. Some MCP clients (e.g., Cursor) have a hard limit of 40 tools total across all servers.

**Why it happens:**
Every MCP tool is serialized into the system context for every request. Unlike a REST API where endpoints don't consume context, MCP tools pay a per-tool context cost at all times. This is an architectural constraint of the protocol, not a bug. Adding 10 narrow-purpose tools (e.g., `note_create`, `note_update`, `note_delete`, `note_list`, `note_search`, `asset_upload`, `asset_list`, `asset_delete`) multiplies the context tax.

**How to avoid:**
Design tools with broader signatures that combine related operations, rather than one tool per CRUD verb:
- `manage_note(action: 'create'|'update'|'delete'|'list'|'search', ...)` — one tool, five operations
- `manage_asset(action: 'upload'|'list'|'delete', ...)` — one tool, three operations

Also consolidate the fuzzy project lookup into the existing `search` tool via a new `category: 'project_fuzzy'` option rather than a new standalone tool.

Write maximally concise tool descriptions — every word in a description is a token. Aim for 1-2 sentence descriptions, not paragraphs.

**Warning signs:**
- Agent stops calling certain tools (context window crowding pushes later tools out)
- Token counter shows >10,000 tokens consumed before first message
- Agent reports "I don't have a tool for X" when the tool exists (name/description crowded out)

**Phase to address:**
Phase 2 (MCP Knowledge Base Tools). Design tool surface before implementation; do not add CRUD-per-verb tools.

---

### Pitfall 6: Fuzzy Project Matching Returns Wrong Project (Silent Mismatch)

**What goes wrong:**
The `identify_project` MCP tool is designed to let AI agents find a project by name/alias/description without knowing the exact ID. If the fuzzy match returns a wrong project (e.g., "ai-helper" matches "ai-manager" with 80% similarity), all subsequent note/task operations silently corrupt the wrong project's data. There is no warning — the tool returns a project, the agent proceeds confidently.

**Why it happens:**
Simple `LIKE`-based substring matching has no score threshold — it returns the best match regardless of quality. Fuzzy matching at low thresholds (60-70%) produces false positives when project names share common words ("ai-", "manager", "project"). The MCP caller (AI agent) treats any non-null return as authoritative.

**How to avoid:**
1. Return a `confidence` score alongside the match result
2. Return `null` when the best match score is below a defined threshold (recommend: 0.85 for name/alias, 0.70 for description)
3. When multiple projects score within 10% of each other, return all candidates instead of the top one — let the agent decide
4. Always return `id`, `name`, `alias`, and `localPath` so the agent can confirm the match makes sense

For implementation: use normalized Levenshtein distance or trigram similarity on `name` + `alias` fields. For `description` fuzzy search, use SQLite FTS5 BM25 ranking.

```typescript
// Return format for fuzzy project lookup
type FuzzyProjectMatch = {
  project: Project;
  confidence: number;         // 0.0 - 1.0
  matchedField: 'name' | 'alias' | 'description';
  alternatives?: Project[];   // when multiple candidates close in score
};
```

**Warning signs:**
- Notes appear under the wrong project with no error
- Agent says "I found project X" but the returned ID belongs to a different project
- Multiple short-named projects (e.g., "app", "api", "web") get confused with each other

**Phase to address:**
Phase 2 (Smart Project Identification). Build scoring and threshold into the fuzzy lookup before any write operations depend on it.

---

### Pitfall 7: Notes Schema Migration Breaks Existing Data Without Backup

**What goes wrong:**
Adding a `Note` model to `schema.prisma` and running `prisma db push` is generally safe (adding a new table). However, if the `Note` model also adds constraints or triggers (for FTS5 sync), and a previous partial push left the DB in an inconsistent state, `prisma db push` will prompt to reset the database. Since this project uses `db push` (not `prisma migrate`), there is no migration history and no rollback path.

**Why it happens:**
The project already uses `db push` as documented in the existing PITFALLS.md (Pitfall 5 of v0.1 research). The SQLite WAL files (`dev.db-shm`, `dev.db-wal`) are uncommitted — if a push fails midway, the WAL may hold partial writes. Additionally, adding a `Note` model with a `categoryId` foreign key after a `NoteCategory` model will fail if `NoteCategory` doesn't exist yet (ordering matters in `db push`).

**How to avoid:**
1. Before any schema change, copy `prisma/dev.db` to `prisma/dev.db.backup`
2. Add `Note` and `NoteCategory` models to `schema.prisma` in a single push (not sequentially)
3. Run `prisma db push --accept-data-loss` only after confirming the backup exists
4. Do NOT add FTS5 triggers via schema — do it via raw SQL after push
5. Add `@@index` on Note's `projectId`, `categoryId`, and `createdAt` in the same push to avoid a second migration

**Warning signs:**
- `prisma db push` output includes "The following tables need to be dropped and recreated"
- WAL checkpoint is pending (`.db-wal` file is non-zero size before the push)
- Push completes but `prisma studio` shows empty tables that had data

**Phase to address:**
Phase 1 (Note Schema). Run backup before push; add all Note-related models in one atomic push.

---

### Pitfall 8: File Serving API Route Leaks Files Outside data/ Boundary

**What goes wrong:**
The planned `GET /api/files/[...path]` route that serves assets from `data/assets/{projectId}/` can be tricked into serving files outside the `data/` directory if the path segments are not normalized. A request like `/api/files/../../prisma/dev.db` resolves via `path.join(process.cwd(), 'data', '../../prisma/dev.db')` to the database file.

**Why it happens:**
`path.join()` resolves `..` segments. When route params are joined with a base directory without a containment check, `..` traversal escapes the intended root. Next.js does not automatically strip `..` from App Router catch-all route params.

**How to avoid:**
Always use `path.resolve()` and verify the resolved path starts with the allowed base:

```typescript
import path from 'path';
import { readFile } from 'fs/promises';

const DATA_ROOT = path.resolve(process.cwd(), 'data');

export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  const joined = params.path.join('/');
  const resolved = path.resolve(DATA_ROOT, joined);

  // Containment check — must be inside DATA_ROOT
  if (!resolved.startsWith(DATA_ROOT + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }

  const buffer = await readFile(resolved);
  // ... serve with appropriate Content-Type
}
```

**Warning signs:**
- File serve route accepts path params without `path.resolve()` + startsWith check
- Test with `GET /api/files/../../.env` — any non-403 response is a vulnerability
- Route uses `path.join()` but no containment check

**Phase to address:**
Phase 3 (File Management / Asset Serving). Implement containment check in the very first version of the file serve route.

---

### Pitfall 9: react-markdown rawHtml Enabled Without Sanitization

**What goes wrong:**
The existing codebase uses `react-markdown` (v10.1.0) for rendering assistant messages. When extending to notes (user-authored Markdown), there is a temptation to enable `rehypeRaw` for rich formatting (tables, embedded images, etc.). If `rehypeRaw` is enabled without `rehype-sanitize`, users can embed `<script>` tags, `<iframe>` elements with malicious src, or CSS injection via `style` attributes in their notes. Even in a single-user local tool, this creates risk if notes are shared or synced.

**Why it happens:**
`react-markdown` is safe by default (strips raw HTML). But developers add `rehypeRaw` for legitimate reasons (tables in `.md` files, image sizing) and forget to pair it with `rehype-sanitize`. The risk is invisible during development because the developer's own content is safe.

**How to avoid:**
If raw HTML rendering is required, always pair `rehypeRaw` with `rehype-sanitize` using a restrictive schema:

```typescript
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

<ReactMarkdown
  rehypePlugins={[rehypeRaw, rehypeSanitize]}
  // defaultSchema blocks <script>, <iframe>, on* handlers, style injection
>
  {noteContent}
</ReactMarkdown>
```

Do NOT enable `rehypeRaw` without `rehypeSanitize`. If only tables and fenced code blocks are needed, do not enable raw HTML at all — `remarkGfm` handles tables without raw HTML.

**Warning signs:**
- Notes renderer uses `rehype-raw` without `rehype-sanitize` in the plugin list
- `<script>alert(1)</script>` in a note renders as an alert, not as text
- Notes can include `<img src="x" onerror="...">` and the onerror fires

**Phase to address:**
Phase 4 (Notes Web UI). Verify sanitization is in place before the note editor ships.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use `LIKE '%term%'` for note search instead of FTS5 | No FTS5 setup complexity | Slow at 1,000+ notes; no relevance ranking; can't search across title+content efficiently | Acceptable as a short-term fallback if FTS5 setup is deferred — but plan migration path |
| Store file paths as absolute paths in DB | Avoids path computation at serve time | Breaks if project directory moves or is shared; absolute paths are machine-specific | Never — always store relative to `data/` root |
| Create one MCP tool per CRUD operation (note_create, note_update, note_delete, note_list) | Clear naming | Consumes 4x the context tokens for one feature area | Never for localhost MCP tool with >20 existing tools |
| Skip `busy_timeout` PRAGMA on Next.js DB client | No code change | Intermittent "database is locked" when MCP and web UI write simultaneously | Never in a system with two concurrent DB connections |
| Use `fs.rename()` directly without EXDEV fallback | One-line move | Fails silently on cross-device moves; no error recovery | Never — the copy+delete fallback is 5 lines |
| Skip path containment check on file serve route | Faster initial implementation | Directory traversal vulnerability; exposes .env and SQLite DB | Never |
| Store notes as `.md` files instead of in SQLite | No schema migration needed | MCP cannot search/CRUD efficiently; no FTS; breaks the "db as source of truth" design decision already made | Never — PROJECT.md already decided: notes in SQLite |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Prisma + FTS5 | Add FTS5 virtual table to schema.prisma | Create FTS5 table and triggers via raw SQL in setup script; never in Prisma schema |
| Prisma + FTS5 | Run `db push` after creating FTS5 table manually | FTS5 shadow tables cause Prisma to detect drift; run `db push` BEFORE creating FTS5 tables, then create FTS5 |
| MCP + Next.js (same SQLite file) | Default PrismaClient with no WAL/timeout config | Set `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` on both `src/lib/db.ts` and `src/mcp/db.ts` at startup |
| FTS5 + Prisma `$queryRaw` | Use `db.note.findMany()` for full-text search | Use `db.$queryRaw\`SELECT rowid, * FROM notes_fts WHERE notes_fts MATCH ${query}\`` for FTS queries |
| react-markdown + notes editor | Enable `rehypeRaw` for table rendering | Use `remarkGfm` for GFM tables — no raw HTML required; only add `rehypeRaw` + `rehypeSanitize` if HTML passthrough is truly needed |
| File move (MCP tool) | Use `fs.rename()` directly | Wrap in try/catch with EXDEV fallback to `copyFile` + `unlink` |
| File serve route | `path.join(base, userParam)` without check | `path.resolve(base, userParam)` + `startsWith(base + sep)` guard |
| Fuzzy project lookup | Return first result above any similarity | Return result only above 0.85 threshold; return `confidence` score; return multiple candidates when close |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading all notes for a project without pagination | Note list slow when project has many notes | Add `take: 50` default limit + cursor-based pagination to note list query | At ~200+ notes per project |
| FTS5 content table not kept in sync | Search returns stale results after update/delete | Create INSERT/UPDATE/DELETE triggers on `Note` table that update `notes_fts` virtual table | First time a note is edited or deleted |
| Serving large files (images, PDFs) via Next.js route handler without streaming | Memory spike on large file requests | Use `fs.createReadStream()` piped to a `ReadableStream` response; set appropriate `Content-Length` and `Cache-Control` headers | For files >5MB |
| Note search doing `MATCH '*term*'` (FTS5 prefix on both sides) | Search is slow; FTS5 ignores leading wildcard | FTS5 supports trailing wildcards (`term*`) but not leading. Use `term*` for prefix search; use `LIKE` for substring if truly needed | Immediately — leading wildcards disable the FTS index |
| Fuzzy match scanning all projects on every MCP call | Acceptable at <100 projects; noticeable at 500+ | Add `@@index([name, alias])` to Project model; normalize candidate strings at write time | At ~500+ projects |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| File serve route without path containment check | Directory traversal — agent or user can read arbitrary files including .env, dev.db | Always `path.resolve()` + `startsWith(DATA_ROOT + sep)` check before serving |
| Accepting arbitrary sourcePath for mv operations | Agent can trick the system into moving sensitive files (keys, DB) into asset storage | Validate sourcePath is under a project's `localPath` or an explicitly allowed staging directory |
| Storing image/file metadata with raw user-supplied filenames | Malicious filename (`../../.env`) used in path construction | Sanitize filenames: strip all path separators, `..` segments, and null bytes; use a UUID-based storage name with original name stored separately in DB |
| Rendering note content with `dangerouslySetInnerHTML` | XSS via user-authored notes | Always render via `react-markdown` with sanitization; never raw HTML injection |
| MCP tool accepting note content without size limit | AI agent can insert 50MB note crashing the DB | Enforce `MAX_NOTE_CONTENT_LENGTH` (suggest 500,000 chars) in Zod schema validation on both MCP tool and server action |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Note editor without autosave or unsaved-changes warning | User loses edits on navigation or accidental tab close | Add debounced autosave (2s after last keystroke) or `beforeunload` guard; show "Unsaved changes" indicator |
| Asset list showing raw UUIDs or internal storage paths | User cannot identify which file is which | Store original filename in DB alongside internal storage path; display original name in UI |
| Cache files (`data/cache/`) never cleaned up | Disk fills up over time with task execution artifacts | Add a "Clear cache" button in UI or a cache size indicator; document that cache is safe to delete |
| No empty state for notes/assets panels | Users don't know what to do when a project has no notes | Add empty state with call-to-action ("Add your first note") |
| Fuzzy project lookup returns a match without showing the user the matched project | User doesn't know which project was resolved | MCP tools that resolve a project should return the full project name and alias in their response so the AI agent can confirm out loud |

---

## "Looks Done But Isn't" Checklist

- [ ] **FTS5 setup:** Run `prisma db push` after FTS5 tables are created — verify it does NOT prompt for database reset
- [ ] **FTS5 sync:** Edit a note, then search for the new content — verify search returns the updated note
- [ ] **FTS5 sync:** Delete a note, then search for its content — verify search no longer returns it
- [ ] **Cross-device mv:** Test file move with source on `/tmp` and destination in `data/` — verify no EXDEV error
- [ ] **Path traversal:** Test `GET /api/files/../../.env` — verify 403 response, not file content
- [ ] **Concurrent writes:** Run MCP write tool and web UI save simultaneously — verify no "database is locked" errors
- [ ] **Fuzzy match threshold:** Search for a non-existent project name — verify `null` is returned, not a low-confidence wrong match
- [ ] **Fuzzy match ambiguity:** Add two projects with similar names — verify both are returned as candidates instead of silently picking one
- [ ] **Note XSS:** Put `<script>alert(1)</script>` in a note — verify it renders as text, not as executable script
- [ ] **MCP tool count:** Count total tools after v0.2 — verify total stays under 30, and each tool description is ≤ 3 sentences
- [ ] **File size limit:** Upload a 50MB file via MCP asset tool — verify it is rejected with a clear error, not a silent timeout
- [ ] **i18n coverage:** All new UI strings in notes and assets panels have both `zh` and `en` translations

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| FTS5 shadow tables broke db push, data lost | HIGH | Restore from `prisma/dev.db.backup`; recreate FTS5 table and triggers via raw SQL; do NOT re-run db push after FTS5 tables exist |
| "database is locked" errors in production | LOW | Add `PRAGMA busy_timeout=5000` to both DB clients; restart both processes; errors should clear immediately |
| Wrong project matched by fuzzy lookup, notes written to wrong project | MEDIUM | Identify affected notes by `createdAt` timestamp; move them via raw SQL update to correct `projectId`; tighten confidence threshold |
| EXDEV error on file move left orphaned source file | LOW | Re-run the mv operation manually; implement the copyFile+unlink fallback going forward |
| File serve route exploited for path traversal | MEDIUM | Add containment check immediately (single-line fix); audit `data/` directory for files that should not be there; rotate any credentials that were readable |
| react-markdown XSS via missing sanitization | LOW | Add `rehype-sanitize` to the plugin list (one-line fix); no data migration needed |
| MCP tool list too large, agent performance degraded | MEDIUM | Consolidate tools (combine CRUD verbs into single action-dispatch tool); update tool descriptions to be shorter; restart MCP server |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| FTS5 shadow tables break db push | Phase 1: Note schema | Run db push after FTS5 setup — no reset prompt |
| Concurrent write "database is locked" | Phase 1: Note schema (DB setup) | Simulate concurrent MCP + web write — no lock errors |
| Notes schema migration data loss | Phase 1: Note schema | Backup exists before push; push completes without reset |
| Fuzzy match false positives | Phase 2: Smart project identification | Ambiguous names return multiple candidates; threshold rejects weak matches |
| MCP tool proliferation | Phase 2: MCP knowledge base tools | Tool count ≤ 30; no CRUD-per-verb pattern |
| EXDEV cross-device mv error | Phase 3: File management | File move works with `/tmp` source |
| Path traversal in file serve | Phase 3: File management | `/api/files/../../.env` returns 403 |
| Unvalidated source path in mv | Phase 3: File management | MCP mv tool rejects paths outside project localPath |
| react-markdown XSS | Phase 4: Notes web UI | `<script>` in note renders as escaped text |
| Autosave / unsaved changes loss | Phase 4: Notes web UI | Navigation away from dirty note shows warning |

---

## Sources

- [Prisma issue #8106 — FTS5 shadow tables ignored by migrate but detected as drift](https://github.com/prisma/prisma/issues/8106)
- [Prisma issue #9414 — FTS support for SQLite](https://github.com/prisma/prisma/issues/9414)
- [SQLite FTS5 extension official docs](https://www.sqlite.org/fts5.html)
- [SQLite WAL mode official docs](https://www.sqlite.org/wal.html)
- [Node.js issue #19077 — fs.rename() cross-device EXDEV](https://github.com/nodejs/node/issues/19077)
- [MCP tool bloat and context window degradation — demiliani.com](https://demiliani.com/2025/09/04/model-context-protocol-and-the-too-many-tools-problem/)
- [MCP context window problem — junia.ai](https://www.junia.ai/blog/mcp-context-window-problem)
- [react-markdown XSS pitfall — Medium](https://medium.com/@brian3814/pitfall-of-potential-xss-in-markdown-editors-1d9e0d2df93a)
- [react-markdown security guide — Strapi](https://strapi.io/blog/react-markdown-complete-guide-security-styling)
- [Next.js path traversal CVE-2020-5284 — Snyk](https://security.snyk.io/vuln/SNYK-JS-NEXT-561584)
- [SQLite concurrent writes and "database is locked" errors](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/)
- [MCP versioning and breaking changes — Nordic APIs](https://nordicapis.com/the-weak-point-in-mcp-nobodys-talking-about-api-versioning/)
- Codebase analysis: `src/lib/db.ts`, `src/mcp/db.ts`, `prisma/schema.prisma`, `src/mcp/tools/search-tools.ts`, `.planning/PROJECT.md`

---
*Pitfalls research for: Knowledge base + notes + file management + expanded MCP tools in Next.js 16 + SQLite + Prisma*
*Researched: 2026-03-27*
