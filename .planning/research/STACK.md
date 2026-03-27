# Stack Research

**Domain:** Project knowledge base & enhanced MCP — additive features on existing ai-manager
**Researched:** 2026-03-27
**Confidence:** HIGH (existing stack verified via codebase; additions verified via official docs and npm)

## Context: What Already Exists (DO NOT RE-RESEARCH)

| Already in Place | Version | Notes |
|-----------------|---------|-------|
| Next.js App Router | 16.2.1 | Server Components + Server Actions |
| React | 19.2.4 | |
| Prisma ORM | ^6.19.2 | With `$queryRaw` / `$executeRaw` raw SQL support |
| SQLite | (bundled with Prisma) | No external DB; `data/` dir for file storage |
| `react-markdown` | ^10.1.0 | Already in deps — renders Markdown |
| `remark-gfm` | ^4.0.1 | Already in deps — GFM tables/checklists |
| `@tailwindcss/typography` | ^0.5.19 | Already in deps — prose styling |
| `@modelcontextprotocol/sdk` | ^1.28.0 | MCP server with 18 CRUD tools |
| `zod` | ^4.3.6 | Input validation |
| `zustand` | ^5.0.12 | Client state |
| `lucide-react` | ^1.6.0 | Icons |

---

## New Additions Required for v0.2

### 1. SQLite Full-Text Search (FTS5)

**Decision: Use Prisma `$queryRaw` with raw SQL — NO new library needed.**

Prisma 6 does not natively manage FTS5 virtual tables through its schema/migration system. FTS5 virtual tables create shadow tables that Prisma's migrate dev ignores inconsistently (GitHub issue [#8106](https://github.com/prisma/prisma/issues/8106)). The correct approach:

1. Create the FTS5 virtual table via a raw SQL migration script run at app startup or via `prisma/seed.ts`
2. Maintain an INSERT/UPDATE/DELETE trigger set to keep the FTS index synchronized with the notes table
3. Query via `prisma.$queryRaw`

**Why NOT `LIKE '%term%'` instead:** For a personal notes store that grows over time, `LIKE '%term%'` is a full-table scan with no ranking. FTS5 gives prefix matching, phrase queries, relevance ranking (`bm25`), and sub-10ms query times at thousands of records. The engineering cost is one SQL setup block and one raw-query helper — worth it.

**Why NOT TypedSQL:** Prisma's TypedSQL feature requires static SQL files compiled at build time. FTS5 queries involve dynamic MATCH expressions that don't map cleanly to static files. Stick with `$queryRaw` tagged template literals (already sanitized by Prisma, safe against injection).

**FTS5 setup pattern:**

```sql
-- Run once at DB init (seed.ts or startup check)
CREATE VIRTUAL TABLE IF NOT EXISTS note_fts
  USING fts5(title, content, content='Note', content_rowid='id');

CREATE TRIGGER IF NOT EXISTS note_fts_insert AFTER INSERT ON Note BEGIN
  INSERT INTO note_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;
CREATE TRIGGER IF NOT EXISTS note_fts_delete AFTER DELETE ON Note BEGIN
  INSERT INTO note_fts(note_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
END;
CREATE TRIGGER IF NOT EXISTS note_fts_update AFTER UPDATE ON Note BEGIN
  INSERT INTO note_fts(note_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
  INSERT INTO note_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;
```

**Query pattern:**

```typescript
const results = await prisma.$queryRaw<{ id: string; title: string }[]>`
  SELECT n.id, n.title, n.content, n.projectId
  FROM Note n
  JOIN note_fts ON note_fts.rowid = n.id
  WHERE note_fts MATCH ${query + '*'}
  ORDER BY bm25(note_fts)
  LIMIT 20
`;
```

**Confidence:** HIGH — `$queryRaw` is confirmed in Prisma 6 docs; FTS5 trigger pattern is standard SQLite; shadow table issue confirmed in GitHub issues.

---

### 2. Fuzzy Project Matching

**Add: `fuse.js` ^7.1.0**

Smart project identification requires fuzzy matching across `name`, `alias`, and `description`. This runs in the MCP layer (Node.js server process, not browser), so bundle size is not a concern.

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `fuse.js` | ^7.1.0 | Fuzzy string matching across project fields | Zero deps, 12KB, built-in TypeScript types, field-weighted scoring; de facto standard for in-memory fuzzy search in JS; beats custom Levenshtein implementations |

**Usage in MCP `find_project` tool:**

```typescript
import Fuse from 'fuse.js';

const fuse = new Fuse(projects, {
  keys: [
    { name: 'name', weight: 3 },
    { name: 'alias', weight: 2 },
    { name: 'description', weight: 1 },
  ],
  threshold: 0.4,   // tighter = more exact matches required
  includeScore: true,
});
const results = fuse.search(query);
```

**Confidence:** HIGH — official docs verified, last published 7.1.0 (stable), zero deps, built-in TS types confirmed.

---

### 3. Markdown Notes Editor (Web UI)

**Add: `@uiw/react-md-editor` ^4.0.11**

The notes web UI needs both editing (textarea + toolbar) and preview (rendered Markdown). The project already has `react-markdown` for read-only rendering, but not for editing.

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `@uiw/react-md-editor` | ^4.0.11 | Split-pane Markdown editor with toolbar and live preview | ~4.6 kB gzipped; built-in TypeScript; standard controlled `value`/`onChange`; no CodeMirror or Monaco bloat; active maintenance (v4.0.11 Nov 2025) |

**Next.js SSR gotcha — mandatory:** This library accesses browser APIs and MUST be dynamically imported:

```typescript
import dynamic from 'next/dynamic';
const MDEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false });
```

Without `ssr: false`, the component will throw on server-side rendering in Next.js App Router.

**CSS import:** The library requires its own stylesheet. Import in the component file or in `globals.css`:

```typescript
import '@uiw/react-md-editor/markdown-editor.css';
import '@uiw/react-md-editor/markdown.css';
```

**React 19 compatibility:** Version 4.0.x targets React 18+ peer dep. React 19 is backward-compatible at the API level used by this library (standard hooks + controlled components). No issues expected — but use `dynamic` import as above to avoid SSR hydration errors that could be misattributed to React version.

**Alternative considered — plain `<textarea>` with `react-markdown` preview:** Viable if bundle size is the primary concern. Adds ~0 bytes but requires custom toolbar implementation. Recommend against for a notes-focused milestone; `@uiw/react-md-editor` provides a complete editing UX in one package.

**Confidence:** MEDIUM — latest version (4.0.11) confirmed on npm; React 19 compatibility inferred from backward compat (no explicit React 19 issue found); SSR workaround confirmed in GitHub issues.

---

### 4. File Serving for Assets (Route Handler)

**Decision: No new library — use Node.js built-in `fs.promises` + Route Handler.**

Assets are stored at `data/assets/{projectId}/{filename}` (persistent) and `data/cache/{taskId}/{filename}` (manual cleanup). These directories are outside Next.js `public/`, so files cannot be served as static assets.

**Solution: A Next.js App Router Route Handler at `/api/files/[...path]/route.ts`** reads files from the `data/` directory and streams them with appropriate `Content-Type` headers.

```typescript
// src/app/api/files/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import mime from 'mime-types';

export async function GET(
  _req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const filePath = path.join(process.cwd(), 'data', ...params.path);
  // Prevent path traversal
  if (!filePath.startsWith(path.join(process.cwd(), 'data'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const stats = await stat(filePath).catch(() => null);
  if (!stats) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const stream = createReadStream(filePath);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': mime.lookup(filePath) || 'application/octet-stream',
      'Content-Length': String(stats.size),
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
```

**Add: `mime-types` ^2.1.35** — maps file extensions to MIME types. Tiny (no deps), stable, used by hundreds of thousands of packages.

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `mime-types` | ^2.1.35 | Map file extension → MIME `Content-Type` | Standard utility, 0 deps, widely used; alternative `mime` v4 has ESM-only issues with some Next.js configs |

**File transfer pattern (mv not upload):** For MCP tool `add_asset` and `add_task_attachment`, the agent provides an absolute path on the local filesystem. The server copies (or renames) the file into `data/assets/{projectId}/` or `data/cache/{taskId}/` using `fs.promises.rename` (same-filesystem, atomic) or `fs.promises.copyFile` + `unlink` (cross-filesystem fallback).

```typescript
import { rename, copyFile, unlink, mkdir } from 'fs/promises';

async function mvFile(src: string, dest: string): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await rename(src, dest);          // atomic if same filesystem
  } catch (e: any) {
    if (e.code === 'EXDEV') {         // cross-device move
      await copyFile(src, dest);
      await unlink(src);
    } else throw e;
  }
}
```

No additional library needed — `fs.promises` is standard Node.js 18+.

**Confidence:** HIGH — Node.js `fs.promises` API confirmed stable; Route Handler streaming pattern confirmed in Next.js docs; `mime-types` package verified on npm.

---

### 5. Schema Additions (Prisma — No New Libraries)

Three new models needed. All use existing Prisma 6 + SQLite setup.

```prisma
model Note {
  id         String   @id @default(cuid())
  title      String
  content    String   @default("")
  category   String   @default("general")  // preset or custom string
  projectId  String
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
  @@index([category])
}

model Asset {
  id          String   @id @default(cuid())
  filename    String                         // original filename
  storedPath  String                         // relative to data/ dir
  mimeType    String?
  size        Int?                           // bytes
  projectId   String
  createdAt   DateTime @default(now())

  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
}

model TaskAttachment {
  id          String   @id @default(cuid())
  filename    String
  storedPath  String                         // relative to data/cache/{taskId}/
  mimeType    String?
  size        Int?
  taskId      String
  createdAt   DateTime @default(now())

  task        Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([taskId])
}
```

Apply with `prisma db push` (no migration files, consistent with existing strategy).

**FTS5 virtual table:** Created via a one-time setup function called from the app server startup (not via Prisma schema — Prisma cannot model virtual tables). Add to `src/lib/db.ts` or a dedicated `src/lib/fts-setup.ts`:

```typescript
export async function ensureFtsIndex(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS note_fts
      USING fts5(title, content, content='Note', content_rowid='id');
  `);
  // ... triggers (see Section 1 above)
}
```

Call this from Next.js server startup (e.g., in the DB singleton initialization), NOT in every request.

**Confidence:** HIGH — Prisma schema syntax verified; `$executeRawUnsafe` for DDL confirmed in Prisma docs.

---

## Recommended Stack Additions Summary

| Library | Version | Install As | Purpose |
|---------|---------|-----------|---------|
| `fuse.js` | `^7.1.0` | dependency | Fuzzy project matching in MCP tools |
| `@uiw/react-md-editor` | `^4.0.11` | dependency | Markdown editor for notes web UI |
| `mime-types` | `^2.1.35` | dependency | Content-Type headers in file serving route |

**Everything else uses existing Node.js built-ins, Prisma raw queries, and the existing Next.js Route Handler pattern.**

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `better-sqlite3` direct driver | Prisma already manages the SQLite connection; mixing drivers risks connection conflicts and WAL mode contention; adds complexity | Prisma `$queryRaw` / `$executeRaw` |
| `multer` or `formidable` for uploads | This is a local-only tool — file transfer via `mv` (path on local FS) is the intended design; base64 upload encoding is unnecessary overhead | `fs.promises.rename` + `copyFile` |
| `uploadthing` / `aws-sdk` | Cloud storage is explicitly out of scope for a localhost tool | Local `data/` directory + Route Handler |
| Full-text search via `pg_search` / Elasticsearch | PostgreSQL/Elasticsearch are out of scope; SQLite FTS5 is the right embedded solution | SQLite FTS5 via `$queryRaw` |
| `MDXEditor` (WYSIWYG) | ~851 kB gzipped — disproportionate for a notes feature in an already feature-rich app | `@uiw/react-md-editor` (~4.6 kB) |
| `Milkdown` | Heavy ProseMirror dependency; SSR complications; overkill for project notes | `@uiw/react-md-editor` |
| `react-query` / `swr` for note fetching | Notes are fetched via Server Actions (already the app pattern); adding a client cache layer would require refactoring consistent with existing approach | Server Actions + `useTransition` |
| Custom FTS implementation (JavaScript-side) | In-memory JS search loses ranking quality, misses tokenization; FTS5 in the DB engine is faster and more accurate | SQLite FTS5 |

---

## Integration Points and Gotchas

### MCP Tool: `find_project` (fuzzy matching)

The MCP server runs as a separate `tsx` process. Import `fuse.js` directly in `src/mcp/tools/project-tools.ts`. No browser bundle impact. Load all projects once per tool invocation (dataset is small — typically <100 projects).

**Threshold tuning:** `threshold: 0.4` works well for name/alias matching. If matching by description only, raise to `0.6`. Return the top result only when score < 0.3; otherwise return multiple candidates for disambiguation.

### FTS5 Trigger Maintenance

FTS5 uses a content table approach (`content='Note'`). This means the FTS index doesn't store full content redundantly — it reads back from the `Note` table. Triggers MUST be created for INSERT, UPDATE, and DELETE together. If any trigger is missing, the index diverges silently and search returns stale/missing results.

Run `ensureFtsIndex()` at server start, not per-request. The `IF NOT EXISTS` guard makes it idempotent.

### File Serving Route Security

The Route Handler at `/api/files/[...path]/route.ts` MUST validate that the resolved absolute path starts with `path.join(process.cwd(), 'data')`. Without this check, a crafted path like `../../etc/passwd` could escape the data directory. This is a localhost-only tool, but the check is one line and eliminates the class of vulnerability.

### `@uiw/react-md-editor` and Next.js App Router

Dynamic import with `ssr: false` is non-negotiable. The editor accesses `window`, `document`, and `navigator` during module initialization — these don't exist in the Node.js SSR environment. Failure mode: the build succeeds but the page crashes at runtime with `ReferenceError: window is not defined`.

The CSS imports must be in a client component or `globals.css` — Next.js App Router disallows importing CSS from node_modules in Server Components.

### Asset Directory Structure

The `data/` directory is at project root (same level as `src/`, `prisma/`). Add it to `.gitignore`:

```
data/assets/
data/cache/
```

Create `data/.gitkeep` to ensure the directory is tracked but contents are ignored. The Prisma `DATABASE_URL` points to `file:./dev.db` in `prisma/` — no conflict with `data/`.

### `mime-types` vs `mime`

The `mime` package v4 is ESM-only and requires `"type": "module"` or dynamic `import()`. This conflicts with Next.js's mixed CJS/ESM environment. Use `mime-types` v2 (CJS-compatible) instead.

---

## Installation

```bash
# New dependencies only
pnpm add fuse.js @uiw/react-md-editor mime-types
```

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|----------------|-------|
| `fuse.js@^7.1.0` | Node.js 18+, TypeScript 5 | Built-in types; no peer deps; works in both Next.js and MCP process |
| `@uiw/react-md-editor@^4.0.11` | React 18+, Next.js (with `ssr: false`) | Must use dynamic import; CSS requires explicit import |
| `mime-types@^2.1.35` | Node.js 18+, CJS + ESM | Use `mime-types`, not `mime@4` (ESM-only) |
| Prisma `$queryRaw` + FTS5 | Prisma ^6.x, SQLite | Virtual tables not in Prisma schema; manage via raw SQL setup script |

---

## Sources

- [Prisma Raw Queries docs](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries) — `$queryRaw`, `$executeRaw`, `$executeRawUnsafe` confirmed for Prisma 6
- [Prisma GitHub issue #8106](https://github.com/prisma/prisma/issues/8106) — FTS5 shadow table issue; raw SQL workaround confirmed MEDIUM confidence
- [SQLite FTS5 extension docs](https://www.sqlite.org/fts5.html) — FTS5 trigger pattern for content tables HIGH confidence
- [Fuse.js official site](https://www.fusejs.io/) — version 7.1.0, zero deps, built-in TS types confirmed HIGH confidence
- [uiwjs/react-md-editor npm](https://www.npmjs.com/package/@uiw/react-md-editor) — v4.0.11 latest (Nov 2025); SSR workaround confirmed in GitHub issues MEDIUM confidence
- [mime-types npm](https://www.npmjs.com/package/mime-types) — v2.1.35, CJS-compatible HIGH confidence
- [Next.js Route Handler file streaming](https://www.ericburel.tech/blog/nextjs-stream-files) — ReadableStream pattern confirmed MEDIUM confidence
- Codebase inspection of `package.json`, `prisma/schema.prisma`, `src/mcp/tools/search-tools.ts` — HIGH confidence

---

*Stack research for: ai-manager v0.2 — project knowledge base, notes system, asset management, enhanced MCP*
*Researched: 2026-03-27*
