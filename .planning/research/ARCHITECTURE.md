# Architecture Research

**Domain:** AI task management platform — knowledge base extension (v0.2)
**Researched:** 2026-03-27
**Confidence:** HIGH (derived from direct codebase inspection)

## Existing Architecture Baseline

Before describing changes, the current system structure is documented from direct source inspection.

### Current System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     Browser (React 19)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  Board Page  │  │ Settings Page│  │  Task Detail Panel   │   │
│  │ (Kanban UI)  │  │ (AI Tools)   │  │  (messages+execute)  │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│  Zustand: board-store, task-execution-store                      │
└──────────────────────────────────────────────────────────────────┘
                  Server Actions / fetch
┌──────────────────────────────────────────────────────────────────┐
│                  Next.js 16 App Router (Node.js)                 │
│                                                                  │
│  src/actions/           src/app/api/                            │
│  workspace-actions      /tasks/[id]/stream    (SSE)             │
│  task-actions           /tasks/[id]/execute   (start)           │
│  label-actions          /adapters/test        (env check)       │
│  search-actions         /browse-fs            (file browser)    │
│  agent-actions          /git                  (git info)        │
│  prompt-actions                                                  │
│                                                                  │
│  src/lib/adapters/claude-local/   (executes Claude CLI)         │
│  src/lib/db.ts                    (Prisma singleton)            │
└──────────────────────────────────────────────────────────────────┘
                          │ Prisma ORM
┌──────────────────────────────────────────────────────────────────┐
│                    prisma/dev.db (SQLite)                        │
│  Workspace, Project, Task, Label, TaskLabel, TaskExecution,     │
│  TaskMessage, Repository, AgentConfig, AgentPrompt              │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│              MCP Server (separate stdio process)                 │
│              src/mcp/index.ts → server.ts → tools/              │
│  18 tools: workspace, project, task, label, search              │
│  Own PrismaClient (WAL mode) → same dev.db                      │
└──────────────────────────────────────────────────────────────────┘
```

### Key Architectural Facts (Confirmed from Source)

- **Two PrismaClient instances**: Next.js uses a singleton in `src/lib/db.ts`; MCP uses its own in `src/mcp/db.ts` with `PRAGMA journal_mode=WAL`. Both connect to the same `prisma/dev.db`.
- **Server Actions as mutation layer**: All data writes go through `src/actions/`. No REST endpoints for CRUD — API Routes are streaming/utility only.
- **MCP tools use db directly**: MCP tools call `src/mcp/db.ts` directly (not server actions) because they run in a separate process and cannot import Next.js-specific modules.
- **No file storage system yet**: The `data/` directory does not exist. All current state is in SQLite.
- **Adapter pattern is isolated**: `src/lib/adapters/` is a pure Node.js module with no Next.js coupling — importable from both the Next.js process and the MCP process.

---

## v0.2 Integration Architecture

### What Changes vs What Is New

**MODIFIED (existing files touched):**

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `ProjectNote` and `ProjectAsset` models with relations |
| `src/mcp/server.ts` | Register new tool modules: note-tools, asset-tools |
| `src/mcp/tools/search-tools.ts` | Extend with smart project identification (`find_project`) |
| `src/mcp/tools/project-tools.ts` | Add `findProjectByIdentifier` fuzzy lookup helper |
| `src/actions/search-actions.ts` | Extend `globalSearch` with notes FTS category |
| `src/app/workspaces/[workspaceId]/page.tsx` | Add Notes and Assets tabs to project detail view |

**NEW (net-new files):**

| File | Purpose |
|------|---------|
| `prisma/migrations/[ts]_add_knowledge_base/` | Prisma migration + raw FTS5 SQL |
| `src/lib/file-utils.ts` | Pure filesystem helpers: path resolution, mv, mkdir |
| `src/lib/fts.ts` | SQLite FTS5 query helpers using `$queryRaw` |
| `src/actions/note-actions.ts` | Server actions for ProjectNote CRUD + FTS maintenance |
| `src/actions/asset-actions.ts` | Server actions for ProjectAsset (file mv + metadata record) |
| `src/mcp/tools/note-tools.ts` | MCP note CRUD and search tools |
| `src/mcp/tools/asset-tools.ts` | MCP asset upload (mv) and listing tools |
| `src/components/notes/note-list.tsx` | Note list UI with category filter |
| `src/components/notes/note-editor.tsx` | Markdown note editor (create/edit) |
| `src/components/notes/note-detail.tsx` | Read-only markdown note viewer |
| `src/components/assets/asset-list.tsx` | Asset list with file type icons and metadata |
| `src/components/assets/asset-upload.tsx` | Move-to-assets form (path input, not binary upload) |

---

### System Overview After v0.2

```
┌──────────────────────────────────────────────────────────────────┐
│                     Browser (React 19)                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐  │
│  │Kanban Board│  │  Notes Tab │  │ Assets Tab │  │ Settings  │  │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬─────┘  │
│  Zustand board-store    │               │               │        │
└─────────────────────────┼───────────────┼───────────────┼────────┘
              Server Actions              │               │
┌─────────────────────────────────────────────────────────────────┐
│                  Next.js 16 App Router                          │
│                                                                 │
│  src/actions/                                                   │
│  workspace  task  label  agent  prompt  search (mod)           │
│  note (NEW)       asset (NEW)                                   │
│       │                  │                                      │
│  src/lib/fts.ts (NEW)    src/lib/file-utils.ts (NEW)           │
│  FTS5 via $queryRaw      mv / path resolution                   │
│       │                  │                                      │
│  Prisma ORM (src/lib/db.ts)                                     │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
┌─────────▼──────────────┐  ┌────────────▼─────────────────────┐
│    prisma/dev.db        │  │       data/ directory            │
│  + ProjectNote model    │  │  data/assets/{projectId}/        │
│  + ProjectAsset model   │  │  data/cache/{taskId}/            │
│  + note_fts virtual tbl │  │  (filesystem, not SQLite)        │
└─────────────────────────┘  └──────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              MCP Server (separate stdio process)                │
│  src/mcp/tools/                                                 │
│  workspace  project (mod)  task  label                         │
│  search (mod)  note (NEW)  asset (NEW)                         │
│       │              │                                          │
│  src/mcp/db.ts       src/lib/file-utils.ts (shared)            │
│  (own PrismaClient)  (pure Node.js, no Next.js deps)           │
│       │                                                         │
│  same dev.db via WAL                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## New Prisma Models

### ProjectNote

```prisma
model ProjectNote {
  id        String   @id @default(cuid())
  title     String
  content   String   // Markdown text stored as-is
  category  String   @default("general")
  projectId String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
  @@index([category])
}
```

**FTS5 virtual table** (raw SQL appended to Prisma migration, not schema-managed):

```sql
-- Appended to migration .sql file after Prisma-generated DDL
CREATE VIRTUAL TABLE note_fts USING fts5(
  title,
  content,
  content='ProjectNote',
  content_rowid='rowid'
);

-- Triggers to keep note_fts in sync
CREATE TRIGGER note_fts_insert AFTER INSERT ON ProjectNote BEGIN
  INSERT INTO note_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER note_fts_update AFTER UPDATE ON ProjectNote BEGIN
  INSERT INTO note_fts(note_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
  INSERT INTO note_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER note_fts_delete AFTER DELETE ON ProjectNote BEGIN
  INSERT INTO note_fts(note_fts, rowid, title, content) VALUES('delete', old.rowid, old.title, old.content);
END;
```

**Why FTS5 via raw SQL, not Prisma:** Prisma does not support virtual tables. FTS5 is a SQLite detail — isolate it in `src/lib/fts.ts` so Prisma models stay clean.

### ProjectAsset

```prisma
model ProjectAsset {
  id           String   @id @default(cuid())
  name         String   // stored filename
  originalName String   // filename before mv
  mimeType     String?
  size         Int      // bytes
  path         String   // relative: "assets/{projectId}/{name}" or "cache/{taskId}/{name}"
  projectId    String
  taskId       String?  // null for persistent assets
  isCache      Boolean  @default(false)
  createdAt    DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
  @@index([taskId])
  @@index([isCache])
}
```

**Path convention:**
- Permanent asset: `data/assets/{projectId}/{filename}` — `isCache: false`
- Task cache file: `data/cache/{taskId}/{filename}` — `isCache: true`, `taskId` set

The `path` field stores a path relative to the project root (e.g., `assets/clxxx/report.pdf`). `src/lib/file-utils.ts` resolves absolute paths using `process.cwd()`.

---

## Component Responsibilities

| Component | Responsibility | Notes |
|-----------|----------------|-------|
| `src/lib/file-utils.ts` | Path resolution, `fs.rename` (mv), `fs.mkdir`, asset path helpers | No Prisma, no Next.js imports — importable from both processes |
| `src/lib/fts.ts` | FTS5 `note_fts` search and index maintenance via `$queryRaw` | Takes a PrismaClient param; works with both db instances |
| `src/actions/note-actions.ts` | Server actions: getProjectNotes, createNote, updateNote, deleteNote, searchNotes | Calls Prisma + fts.ts |
| `src/actions/asset-actions.ts` | Server actions: getProjectAssets, addAsset (mv+record), deleteAsset (rm+record) | Calls Prisma + file-utils.ts |
| `src/mcp/tools/note-tools.ts` | MCP tools: note_list, note_create, note_update, note_delete, note_search | Uses mcp/db.ts + fts.ts |
| `src/mcp/tools/asset-tools.ts` | MCP tools: asset_list, asset_add, asset_delete | Uses mcp/db.ts + file-utils.ts |
| `src/mcp/tools/project-tools.ts` | Adds `findProjectByIdentifier` helper for smart project lookup | Internal helper, not a new MCP tool |
| `src/mcp/tools/search-tools.ts` | Extended: add `find_project` tool using `findProjectByIdentifier` | Fuzzy match on name/alias/description |
| `src/components/notes/note-list.tsx` | Note list with category filter tabs; calls note-actions | Client Component |
| `src/components/notes/note-editor.tsx` | Textarea + markdown preview side-by-side; create/edit | Client Component |
| `src/components/notes/note-detail.tsx` | Read-only markdown rendering using @tailwindcss/typography | Client Component |
| `src/components/assets/asset-list.tsx` | File list with name, size, type, date; delete action | Client Component |
| `src/components/assets/asset-upload.tsx` | Path input form that calls asset-actions.addAsset | Client Component |

---

## Recommended Project Structure Changes

```
ai-manager/
├── data/                                    # NEW — gitignored runtime storage
│   ├── assets/
│   │   └── {projectId}/                     # permanent project assets
│   └── cache/
│       └── {taskId}/                        # ephemeral task files
├── prisma/
│   ├── schema.prisma                        # MODIFIED — ProjectNote, ProjectAsset
│   └── migrations/
│       └── [ts]_add_knowledge_base/
│           └── migration.sql               # NEW — Prisma DDL + FTS5 raw SQL
└── src/
    ├── actions/
    │   ├── note-actions.ts                  # NEW
    │   ├── asset-actions.ts                 # NEW
    │   └── search-actions.ts               # MODIFIED — notes category
    ├── lib/
    │   ├── file-utils.ts                    # NEW — filesystem ops
    │   ├── fts.ts                           # NEW — FTS5 query helpers
    │   └── db.ts                            # unchanged
    ├── mcp/
    │   ├── server.ts                        # MODIFIED — register new tools
    │   └── tools/
    │       ├── note-tools.ts                # NEW
    │       ├── asset-tools.ts               # NEW
    │       ├── project-tools.ts             # MODIFIED — findProjectByIdentifier
    │       └── search-tools.ts             # MODIFIED — find_project tool
    ├── components/
    │   ├── notes/
    │   │   ├── note-list.tsx               # NEW
    │   │   ├── note-editor.tsx             # NEW
    │   │   └── note-detail.tsx             # NEW
    │   └── assets/
    │       ├── asset-list.tsx              # NEW
    │       └── asset-upload.tsx            # NEW
    └── app/
        └── workspaces/
            └── [workspaceId]/
                └── page.tsx                # MODIFIED — Notes/Assets tabs
```

---

## Architectural Patterns

### Pattern 1: File Transfer via `fs.rename` (mv)

**What:** Assets enter the system by being renamed from an external path into `data/assets/{projectId}/`. No binary upload, no base64 — the local filesystem is the transfer channel.

**When to use:** Any time an AI agent (via MCP) or the web UI needs to associate an existing local file with a project or task.

**Trade-offs:** Zero encoding overhead. Atomic on same filesystem. Only works for local files — acceptable given localhost-only constraint.

```typescript
// src/lib/file-utils.ts
import fs from "fs/promises";
import path from "path";

export function resolveAssetPath(projectId: string, filename: string): string {
  return path.join(process.cwd(), "data", "assets", projectId, filename);
}

export async function moveToAssets(
  sourcePath: string,
  projectId: string,
  filename: string
): Promise<{ relativePath: string; size: number }> {
  const dest = resolveAssetPath(projectId, filename);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(sourcePath, dest);
  const stat = await fs.stat(dest);
  return { relativePath: `assets/${projectId}/${filename}`, size: stat.size };
}
```

### Pattern 2: FTS5 via Isolated Raw SQL Module

**What:** SQLite FTS5 virtual tables are created in raw SQL migrations (not Prisma schema). A thin `src/lib/fts.ts` module owns all FTS queries using `db.$queryRaw`. Server actions and MCP tools call `fts.ts` for full-text search; they use Prisma for everything else.

**When to use:** Full-text search on `ProjectNote.title` and `ProjectNote.content`. The FTS virtual table is kept in sync via SQLite triggers defined in the migration.

**Trade-offs:** Raw SQL is a maintenance surface. Isolated in one file, so the blast radius is small. Triggers fire at the SQLite level regardless of which PrismaClient issued the write — consistent behavior across both processes.

```typescript
// src/lib/fts.ts
import type { PrismaClient } from "@prisma/client";

type FtsRow = { rowid: number; rank: number };

export async function searchNotes(
  db: PrismaClient,
  query: string,
  projectId?: string
): Promise<string[]> {
  const rows = await db.$queryRaw<FtsRow[]>`
    SELECT rowid, rank FROM note_fts WHERE note_fts MATCH ${query} ORDER BY rank LIMIT 20
  `;
  return rows.map((r) => String(r.rowid));
}
```

### Pattern 3: Smart Project Identification in MCP

**What:** MCP tools receive a project identifier as free text (name, alias, or description fragment). A shared `findProjectByIdentifier` helper in `project-tools.ts` runs a multi-field `contains` query. If exactly one match is found it is returned; zero matches throws a clear error; multiple matches throws with the list of candidates.

**When to use:** Any MCP tool that operates on a project without the caller knowing its ID. Allows AI agents to reference projects naturally ("my auth-service project").

**Trade-offs:** Simple `contains` is sufficient for single-user local data (typically <100 projects). No vector search or edit-distance needed. Error messages are descriptive enough for an AI agent to self-correct.

```typescript
// src/mcp/tools/project-tools.ts (added helper)
import type { PrismaClient, Project } from "@prisma/client";

export async function findProjectByIdentifier(
  db: PrismaClient,
  identifier: string
): Promise<Project> {
  const results = await db.project.findMany({
    where: {
      OR: [
        { name: { contains: identifier } },
        { alias: { contains: identifier } },
        { description: { contains: identifier } },
      ],
    },
    take: 5,
    orderBy: { updatedAt: "desc" },
  });
  if (results.length === 0) {
    throw new Error(`No project found matching "${identifier}". Use list_projects to see available projects.`);
  }
  if (results.length > 1) {
    const names = results.map((p) => p.alias ?? p.name).join(", ");
    throw new Error(`"${identifier}" is ambiguous — matches: ${names}. Be more specific.`);
  }
  return results[0];
}
```

---

## Data Flow

### Note Creation (MCP)

```
AI agent calls: note_create(projectIdentifier, title, content, category)
    ↓
note-tools.ts
    findProjectByIdentifier(db, projectIdentifier)  → Project
    db.projectNote.create({ title, content, category, projectId })
    fts.ts: db.$queryRaw INSERT INTO note_fts (fires trigger anyway, but explicit for safety)
    ↓
dev.db: ProjectNote row + note_fts row updated via trigger
```

### Asset Upload (MCP)

```
AI agent calls: asset_add(projectIdentifier, sourcePath, filename?)
    ↓
asset-tools.ts
    findProjectByIdentifier(db, projectIdentifier)  → Project
    file-utils.moveToAssets(sourcePath, projectId, filename)
        → fs.mkdir data/assets/{projectId}/ (recursive, idempotent)
        → fs.rename(sourcePath, dest)          ← atomic on same filesystem
    db.projectAsset.create({ name, originalName, path, size, projectId })
    ↓
dev.db: ProjectAsset row  +  data/assets/{projectId}/{filename}
```

### Full-Text Note Search

```
User or agent searches: "OAuth credentials"
    ↓
note-actions.ts (or note-tools.ts in MCP)
    fts.ts: db.$queryRaw`SELECT rowid, rank FROM note_fts WHERE note_fts MATCH ?`
        → returns sorted rowids
    db.projectNote.findMany({ where: { id: { in: matchedIds } } })
    ↓
Ranked note results with title, category, projectId
```

### Web UI Notes Tab Flow

```
User opens project → clicks "Notes" tab
    ↓
note-list.tsx (Client Component)
    calls note-actions.getProjectNotes(projectId)
    renders list grouped by category
User clicks note → note-detail.tsx (markdown rendered via @tailwindcss/typography)
User clicks edit → note-editor.tsx (textarea + live preview)
    onSave → note-actions.updateNote(id, { title, content, category })
    → revalidatePath triggers re-fetch
```

---

## Integration Points

### Shared Modules Between Processes

`src/lib/file-utils.ts` and `src/lib/fts.ts` are the only modules intentionally shared between the Next.js process and the MCP stdio process. Both must remain free of Next.js-specific imports (no `next/cache`, no `next/headers`, no server action directives).

**Rule:** If a module is needed in `src/mcp/`, it must not import from `src/actions/`, `src/app/`, or any Next.js built-in module.

### SQLite Concurrency

The MCP server already enables WAL mode (`PRAGMA journal_mode=WAL`) on connect. WAL allows concurrent readers and one writer. For single-user local use this is sufficient — no additional locking or coordination is needed between the two PrismaClient instances.

FTS5 triggers fire at the SQLite engine level, so they execute regardless of which process writes to `ProjectNote`. Both processes see consistent full-text search results.

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Next.js server actions ↔ file-utils | Direct import (same process) | No Next.js in file-utils |
| MCP tools ↔ file-utils | Direct import (separate process, same host) | Same `process.cwd()` path |
| Next.js server actions ↔ fts.ts | Direct import, pass `src/lib/db.ts` singleton | fts.ts is db-agnostic |
| MCP tools ↔ fts.ts | Direct import, pass `src/mcp/db.ts` client | Same interface |
| Next.js ↔ MCP | Independent; share dev.db via SQLite WAL | No direct IPC |
| Prisma ↔ FTS5 triggers | SQLite engine level; automatic | No application code needed |

---

## Build Order (Dependency-Ordered)

Build in this sequence — each step satisfies all dependencies before the next step begins.

### Step 1: Data Layer Foundation (no UI or action dependencies)

1. **`prisma/schema.prisma`** — Add `ProjectNote` and `ProjectAsset` models, relations, indexes. Update `Project` model to add `notes` and `assets` relation fields.
2. **Migration** — Run `pnpm prisma migrate dev --name add_knowledge_base`. Edit the generated `migration.sql` to append FTS5 virtual table DDL and triggers.
3. **`src/lib/file-utils.ts`** — Pure filesystem helpers (no Prisma, no Next.js). Implement `resolveAssetPath`, `resolveCachePath`, `moveToAssets`, `moveToCache`, `deleteAssetFile`, `ensureDataDirs`.
4. **`src/lib/fts.ts`** — FTS5 search and insert helpers using `$queryRaw`. Accept `PrismaClient` as parameter (db-agnostic).

### Step 2: Server Actions (depends on Step 1)

5. **`src/actions/note-actions.ts`** — `getProjectNotes`, `getNoteById`, `createNote`, `updateNote`, `deleteNote`, `searchNotes` (calls fts.ts).
6. **`src/actions/asset-actions.ts`** — `getProjectAssets`, `addAsset` (mv + record), `deleteAsset` (rm + record), `getCacheFiles`.
7. **`src/actions/search-actions.ts`** — Extend `globalSearch` to include notes via fts.ts when `category === "note"`.

### Step 3: MCP Tools (depends on Step 1; parallel to Step 2)

8. **`src/mcp/tools/project-tools.ts`** — Add `findProjectByIdentifier` helper (MODIFIED).
9. **`src/mcp/tools/note-tools.ts`** — `note_list`, `note_create`, `note_update`, `note_delete`, `note_search`.
10. **`src/mcp/tools/asset-tools.ts`** — `asset_list`, `asset_add`, `asset_delete`.
11. **`src/mcp/tools/search-tools.ts`** — Add `find_project` tool using `findProjectByIdentifier` (MODIFIED).
12. **`src/mcp/server.ts`** — Import and spread `noteTools` and `assetTools` into `allTools` (MODIFIED).

### Step 4: Web UI Components (depends on Step 2)

13. **`src/components/notes/note-list.tsx`** — List notes with category filter; delete button.
14. **`src/components/notes/note-editor.tsx`** — Create/edit form: title input, category select, markdown textarea, live preview pane.
15. **`src/components/notes/note-detail.tsx`** — Read-only view with markdown prose rendering.
16. **`src/components/assets/asset-list.tsx`** — Asset table: name, size, type, date, delete action.
17. **`src/components/assets/asset-upload.tsx`** — Path input + submit to `addAsset` server action.

### Step 5: Page Integration (depends on Steps 3 and 4)

18. **`src/app/workspaces/[workspaceId]/page.tsx`** — Add Notes and Assets tabs to the project detail view. Tabs are client-side toggled; data is fetched per-tab via server actions (MODIFIED).

---

## Anti-Patterns

### Anti-Pattern 1: Binary File Upload via HTTP

**What people do:** Build a multipart `<input type="file">` form with a Next.js API Route that writes bytes to disk.

**Why it's wrong:** Unnecessary for a local tool. Adds encoding/decoding overhead. The user and AI agent already have filesystem access — the source file is on the same machine.

**Do this instead:** Accept a source filesystem path. Call `file-utils.moveToAssets(sourcePath, projectId, filename)` which uses `fs.rename`. Atomic on the same filesystem and requires zero encoding.

### Anti-Pattern 2: Managing FTS5 in Prisma Schema

**What people do:** Try to model `note_fts` as a Prisma model, or bring in an external search service (MeiliSearch, Algolia).

**Why it's wrong:** Prisma does not support SQLite virtual tables. An external search service is massive overkill for single-user local search over <10k notes.

**Do this instead:** Create the FTS5 virtual table and triggers in a raw SQL migration file. Wrap all FTS queries in `src/lib/fts.ts`. Keep Prisma models clean and let SQLite handle indexing natively.

### Anti-Pattern 3: Duplicating Path Logic Across Modules

**What people do:** Hardcode `data/assets/` path strings in server actions, MCP tools, and components independently.

**Why it's wrong:** Any path convention change requires finding and updating multiple files. Path bugs (missing `mkdir`, wrong separator on Windows) appear in multiple locations.

**Do this instead:** All filesystem path resolution flows through `src/lib/file-utils.ts`. Server actions, MCP tools, and any future code import from this single module.

### Anti-Pattern 4: Importing Server Actions from the MCP Process

**What people do:** Import `src/actions/note-actions.ts` from `src/mcp/tools/note-tools.ts` to avoid duplicating logic.

**Why it's wrong:** Server actions import Next.js-specific modules (`next/cache`, `next/headers`, possibly `server-only`). Importing them into the MCP stdio process will cause import errors or unpredictable behavior.

**Do this instead:** MCP tools use `src/mcp/db.ts` directly — the same pattern already used by all 18 existing MCP tools. Share only pure Node.js modules: `src/lib/file-utils.ts` and `src/lib/fts.ts`.

---

## Scaling Considerations

This is a localhost single-user tool. These are practical operational limits, not design targets.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| <1k notes, <1k assets | Current architecture with no changes needed |
| 1k-10k notes | Add pagination to note-list; FTS5 handles this well natively |
| >10k assets | Add asset cleanup tooling; consider partitioning `data/assets/` by month |

The first practical bottleneck will be the note editor rendering very large markdown documents, not the database or filesystem layer.

---

## Sources

- Direct codebase inspection (HIGH confidence):
  - `prisma/schema.prisma`
  - `src/mcp/server.ts`, `src/mcp/db.ts`, `src/mcp/tools/search-tools.ts`
  - `src/lib/db.ts`, `src/lib/adapters/registry.ts`
  - `src/actions/search-actions.ts`
  - `.planning/PROJECT.md`
- SQLite FTS5 documentation: https://www.sqlite.org/fts5.html
- Prisma raw database access: https://www.prisma.io/docs/orm/prisma-client/queries/raw-database-access

---
*Architecture research for: ai-manager v0.2 knowledge base and enhanced MCP*
*Researched: 2026-03-27*
