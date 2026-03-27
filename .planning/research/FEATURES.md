# Feature Research

**Domain:** Project knowledge base & intelligent MCP for AI task management tool (localhost dev tool)
**Researched:** 2026-03-27
**Confidence:** HIGH — analysis based on existing codebase + research into knowledge base patterns, MCP tool design, SQLite FTS, and competitor analysis (Notion, Obsidian, Linear)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in any project knowledge base system. Missing these = the feature feels incomplete or unusable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Note CRUD (create/read/update/delete) | Every notes system allows basic management | LOW | New `ProjectNote` model in SQLite: `id, projectId, title, content (Markdown), category, createdAt, updatedAt`. Server actions wrap Prisma. |
| Markdown rendering for note content | Developers write in Markdown; plain text display is broken | LOW | `@tailwindcss/typography` + `react-markdown` already used for task messages. Reuse the same component. |
| Category / type taxonomy | Users mentally organize notes by purpose (accounts, env vars, requirements, memos) | LOW | Enum or free-text category field. Preset values: `账号` (accounts), `环境` (environment), `需求` (requirements), `备忘` (memo). Allow custom string beyond presets. |
| Notes scoped to project | A project's notes must not leak into other projects | LOW | `projectId` FK on `ProjectNote`, always filter by `projectId` in queries. Cascade delete when project is deleted. |
| Full-text search across notes | Users need to find notes without remembering exact title | MEDIUM | SQLite FTS5 virtual table with external-content triggers on `title + content`. Prisma doesn't support FTS5 natively — use `prisma.$queryRaw` with MATCH syntax. Sort by BM25 rank. |
| File asset storage per project | Users expect to store files (configs, screenshots, creds) alongside project | MEDIUM | `data/assets/{projectId}/` directory structure. File metadata tracked in `ProjectAsset` table (id, projectId, name, path, mimeType, size). |
| Asset list and download | Can't store files without being able to retrieve them | LOW | List assets by projectId. Serve files from `data/assets/` via a Next.js route handler. |
| Notes visible in Web UI | Notes must have a UI; API-only is not acceptable for a web app | MEDIUM | New route under `/projects/[projectId]/notes`. Notes list + markdown editor panel. Sidebar or tab navigation within project view. |

### Differentiators (Competitive Advantage)

Features that set this tool apart. Aligned with the milestone goal: "让 AI 助手通过 MCP 智能识别项目、管理项目知识库".

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Smart project identification via MCP | AI agents can say "update the notes for my-app" without knowing the exact projectId — fuzzy match by name, alias, or description resolves it | MEDIUM | Use SQLite LIKE + Levenshtein-style scoring or simple trigram match on `name`, `alias`, `description` fields. Existing schema already has `alias` and `description` on `Project`. Return top-N matches with confidence score. Implement in `search-tools.ts` or new `project-identify` tool. |
| Task cache directory (`data/cache/{taskId}/`) | AI agents can write intermediate outputs (generated files, screenshots) to a per-task cache that users can inspect or wipe manually | LOW | Directory created on first write. No DB tracking needed for cache — treat as ephemeral. MCP tool `move_file_to_cache(taskId, srcPath)` calls `fs.rename`. |
| Task message image attachments via MCP | AI agents can reference images in task conversations by moving files to cache and embedding path references | MEDIUM | MCP tool `attach_file_to_message(taskId, srcPath)` moves file to `data/cache/{taskId}/`, stores path in `TaskMessage.metadata` JSON field. Web UI renders `<img>` for image paths in metadata. |
| MCP note knowledge tools | AI agents can read/write project notes via MCP, making the knowledge base accessible without opening the web UI | MEDIUM | New `note-tools.ts` in `src/mcp/tools/`: `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note`, `search_notes`. Follow existing tool patterns from `task-tools.ts`. |
| MCP asset management tools | AI agents can register and retrieve project assets via MCP, closing the loop from "generated file" to "stored asset" | MEDIUM | New `asset-tools.ts`: `list_assets`, `move_to_assets(projectId, srcPath, name)` — uses `fs.rename` + DB insert. `get_asset_path(assetId)` returns absolute path. |
| Preset note categories with extensibility | `账号/环境/需求/备忘` covers 80% of developer use cases; custom categories handle the rest without forcing a taxonomy redesign | LOW | Store category as plain string. Preset values live in a shared constant (no DB enum). UI shows presets as quick-select chips + free-text input. |
| Cross-note search with snippet highlighting | FTS5 snippet() function returns context around matches — much more useful than "note X matches" | MEDIUM | SQLite FTS5 `snippet(fts_notes, 0, '<mark>', '</mark>', '...', 10)` returns highlighted excerpts. Return in search results to help users identify the right note quickly. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Note versioning / history | "Don't lose my notes" | Significant model complexity (new `NoteVersion` table, storage bloat) for a single-user localhost tool with no remote sync risk | SQLite is a single file — users can `cp dev.db dev.db.bak`. No versioning needed in v0.2. |
| Embedding-based semantic search | "Find notes by meaning, not just keywords" | Requires embedding model inference (local or API call), vector storage, significant complexity | SQLite FTS5 BM25 is sufficient for a personal knowledge base with hundreds of notes. Add semantic search in v1+ if users hit limits. |
| Hierarchical note folders | "Organize notes in trees like Obsidian" | Folder trees are complex to implement (parent/child FK, drag-and-drop, breadcrumbs) and overkill for project-scoped notes | Category tags + search achieves the same discoverability without tree complexity. |
| Real-time collaborative editing | "Multiple users editing notes" | Out of scope — this is a localhost single-user tool (PROJECT.md: "No real-time collaboration") | Not applicable. Keep SQLite writes simple. |
| Asset binary storage in SQLite (BLOB) | "Keep everything in one DB file" | Large blobs inflate SQLite file, slow backups, poor streaming | Store files in `data/assets/` filesystem. Store only metadata (path, name, size, mimeType) in DB. This is the standard pattern for SQLite-backed apps. |
| Auto-tagging notes with AI | "Automatically categorize notes" | Requires LLM inference on every save; adds latency, cost, and an async pipeline | Manual category selection with preset quick-picks covers the use case with zero complexity. |
| Note sharing / export to Notion/Confluence | "Share knowledge with team" | Adds external API integrations and auth; contradicts localhost-only constraint | Out of scope. Notes stay in local SQLite. Users can copy-paste Markdown if needed. |
| Drag-and-drop file upload to assets | "Upload from browser like Dropbox" | File I/O via browser upload adds streaming, temp file handling, and size limits | MCP `move_to_assets` and file picker in Web UI via `<input type="file">` are sufficient for a local tool. Direct path input also works since user is always local. |

---

## Feature Dependencies

```
[Smart Project Identification — MCP]
    └──uses──> [Project.name, Project.alias, Project.description]  (already in schema)
    └──enhances──> [All MCP note/asset tools]  (identify project before operating on it)

[Project Notes — Web UI]
    └──requires──> [ProjectNote model + Prisma migration]
    └──requires──> [note-actions.ts server actions]
    └──enhances──> [FTS5 full-text search]  (search only useful once notes exist)

[FTS5 Full-Text Search]
    └──requires──> [ProjectNote model]
    └──requires──> [FTS5 virtual table + triggers via raw SQL migration]
    └──note: Prisma does NOT generate FTS5 — must use prisma.$executeRaw in a custom migration

[MCP Note Tools]
    └──requires──> [ProjectNote model + note-actions.ts]
    └──requires──> [Smart Project Identification]  (to resolve project from name/alias)
    └──follows──> [existing MCP tool patterns in task-tools.ts]

[Project Asset Management — filesystem]
    └──requires──> [data/assets/{projectId}/ directory creation logic]
    └──requires──> [ProjectAsset model + Prisma migration]
    └──independent of──> [Notes system]  (can be built in parallel)

[Task Cache — filesystem]
    └──requires──> [data/cache/{taskId}/ directory creation logic]
    └──independent of──> [ProjectAsset model]  (no DB tracking, ephemeral)

[Task Message Image Attachments]
    └──requires──> [Task Cache directory]
    └──requires──> [TaskMessage.metadata JSON field]  (already in schema as String?)
    └──requires──> [Web UI image rendering in message thread]

[MCP Asset Tools]
    └──requires──> [ProjectAsset model]
    └──requires──> [data/assets/ filesystem layer]
    └──requires──> [Smart Project Identification]

[MCP note-tools.ts]
    └──follows──> [task-tools.ts pattern]
    └──new file──> [src/mcp/tools/note-tools.ts]

[MCP asset-tools.ts]
    └──follows──> [project-tools.ts pattern for project-scoped resources]
    └──new file──> [src/mcp/tools/asset-tools.ts]
```

### Dependency Notes

- **FTS5 requires raw SQL migration:** Prisma schema cannot define FTS5 virtual tables. The migration must use `prisma.$executeRaw` or a custom SQL migration file. This is the single biggest technical gotcha in this milestone.
- **Smart Project Identification is a prerequisite for useful MCP knowledge tools:** Without it, MCP callers must know exact projectId — which removes the "smart" value. Build identification first.
- **Notes and Assets are independent subsystems:** They share the same project scope but have no mutual dependency. They can be developed in parallel phases.
- **Task cache is simpler than project assets:** No DB model needed. Create directory on first write via `fs.mkdirSync(path, { recursive: true })`. This removes a blocker for image attachment feature.
- **`TaskMessage.metadata` is already `String?`:** Store as JSON string. No schema migration needed for the metadata field itself. Only the Web UI rendering and MCP tool are new work.

---

## MVP Definition

### Launch With (v0.2)

Minimum set to deliver the milestone goal: "个人多项目信息中枢" (personal multi-project information hub accessible via MCP).

- [ ] **Smart project identification** — `identify_project(query)` MCP tool that fuzzy-matches by name/alias/description, returns top matches with project IDs. Unblocks all other MCP knowledge tools.
- [ ] **ProjectNote model + Prisma migration** — `id, projectId, title, content, category, createdAt, updatedAt`. Cascade delete with project. This is the data foundation.
- [ ] **Note CRUD server actions** — `createNote`, `updateNote`, `deleteNote`, `getNotesByProject`, `getNoteById` in `src/actions/note-actions.ts`.
- [ ] **FTS5 search** — virtual table + triggers via custom SQL migration. `searchNotes(projectId, query)` returns results ranked by BM25 with snippet highlights.
- [ ] **MCP note tools** — `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note`, `search_notes` in `src/mcp/tools/note-tools.ts`. Register in MCP index.
- [ ] **Notes Web UI** — Route `/projects/[projectId]/notes`. Notes list (sidebar) + markdown editor/viewer panel. Category filter. Search input.
- [ ] **ProjectAsset model + filesystem layer** — `id, projectId, name, path, mimeType, size`. `data/assets/{projectId}/` directory. `move_to_assets` logic.
- [ ] **MCP asset tools** — `list_assets`, `move_to_assets`, `get_asset_path` in `src/mcp/tools/asset-tools.ts`.
- [ ] **Task cache + image attachments** — `data/cache/{taskId}/` directory. MCP `attach_file_to_message(taskId, srcPath)`. Web UI renders images in message thread from metadata.
- [ ] **i18n** — all new user-facing strings in both zh/en translation maps.

### Add After Validation (v0.2.x)

- [ ] **Assets Web UI** — Asset list view under project, with file download. Deferred because MCP access is the primary use case; Web UI is secondary for assets.
- [ ] **Note snippet highlighting in search UI** — FTS5 snippet() is implemented server-side; surface it in the Web UI search results.
- [ ] **Category management** — UI to add/rename custom categories beyond the presets. Low priority since free-text category input already works.

### Future Consideration (v1+)

- [ ] **Semantic / embedding-based search** — Only if FTS5 proves insufficient at scale. Requires local embedding model or API.
- [ ] **Note export (Markdown files)** — Bulk export project notes as `.md` files. Useful for portability but not needed for v0.2 use cases.
- [ ] **Asset type filtering in MCP** — Filter `list_assets` by MIME type. Add when asset counts grow large enough to need filtering.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Smart project identification | HIGH | MEDIUM | P1 |
| ProjectNote model + migration | HIGH | LOW | P1 |
| Note CRUD server actions | HIGH | LOW | P1 |
| FTS5 full-text search | HIGH | MEDIUM | P1 |
| MCP note tools | HIGH | MEDIUM | P1 |
| Notes Web UI | HIGH | MEDIUM | P1 |
| ProjectAsset model + filesystem | MEDIUM | LOW | P1 |
| MCP asset tools | MEDIUM | MEDIUM | P1 |
| Task cache + image attachments | MEDIUM | LOW | P1 |
| Assets Web UI | LOW | MEDIUM | P2 |
| Snippet highlighting in UI | MEDIUM | LOW | P2 |
| Custom category management UI | LOW | LOW | P2 |
| Semantic search | LOW | HIGH | P3 |
| Note export | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for milestone v0.2
- P2: Should have, add when core is validated
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

| Feature | Notion (project docs) | Obsidian (personal notes) | Linear (project mgmt) | Our Approach (v0.2) |
|---------|----------------------|--------------------------|----------------------|---------------------|
| Note storage | Notion cloud DB | Local `.md` files | Attached to issues | SQLite rows (`ProjectNote`) |
| Note organization | Databases + folders + tags | Folders + tags + links | Issue descriptions | Project-scoped + category field |
| Full-text search | Built-in, fast | Built-in (local index) | Global issue search | SQLite FTS5 (BM25) |
| Asset storage | Notion CDN | Local filesystem | GitHub-linked | `data/assets/{projectId}/` |
| AI access | Notion AI (cloud) | Community plugins | Linear AI | MCP tools (local) |
| Offline access | No (cloud) | Yes (local .md) | No (cloud) | Yes (local SQLite) |
| Categories/taxonomy | Flexible databases | Free tags | Labels + status | Preset + custom string |
| API / programmatic access | REST API | Obsidian API + plugins | GraphQL API | MCP tools (18 → 28+) |

**Key insight:** Obsidian's model (local files + search index) is closest to our use case, but storing notes in SQLite (vs `.md` files) is the right tradeoff here because MCP can CRUD directly without filesystem access, and notes tie to the project lifecycle with cascade delete. Linear's pattern of keeping tasks and notes as separate but linked entities validates our approach of `ProjectNote` as a first-class model distinct from `Task`.

---

## Implementation Notes by Feature

### FTS5 — The Critical Technical Detail

Prisma 6 does NOT support FTS5 virtual tables in schema.prisma. The correct approach:

1. Create a normal Prisma migration for `ProjectNote` table.
2. After migration, append raw SQL to create FTS5 virtual table and sync triggers:

```sql
-- Add to migration file after ProjectNote table creation
CREATE VIRTUAL TABLE IF NOT EXISTS project_notes_fts
USING fts5(title, content, content=ProjectNote, content_rowid=rowid);

CREATE TRIGGER IF NOT EXISTS project_notes_fts_insert
AFTER INSERT ON ProjectNote BEGIN
  INSERT INTO project_notes_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS project_notes_fts_update
AFTER UPDATE ON ProjectNote BEGIN
  INSERT INTO project_notes_fts(project_notes_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
  INSERT INTO project_notes_fts(rowid, title, content)
  VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS project_notes_fts_delete
AFTER DELETE ON ProjectNote BEGIN
  INSERT INTO project_notes_fts(project_notes_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
END;
```

Search query via `prisma.$queryRaw`:
```typescript
const results = await prisma.$queryRaw`
  SELECT n.*, snippet(project_notes_fts, 1, '<mark>', '</mark>', '...', 10) as excerpt
  FROM ProjectNote n
  JOIN project_notes_fts fts ON fts.rowid = n.rowid
  WHERE n.projectId = ${projectId}
    AND project_notes_fts MATCH ${query}
  ORDER BY rank
  LIMIT 20
`;
```

### Smart Project Identification

Use SQLite LIKE for substring match + score by field priority (name > alias > description):

```typescript
// Pseudo-implementation
const results = await prisma.$queryRaw`
  SELECT id, name, alias, description,
    CASE
      WHEN lower(name) = lower(${query}) THEN 100
      WHEN lower(name) LIKE lower('%' || ${query} || '%') THEN 80
      WHEN lower(alias) LIKE lower('%' || ${query} || '%') THEN 60
      WHEN lower(description) LIKE lower('%' || ${query} || '%') THEN 40
      ELSE 0
    END as score
  FROM Project
  WHERE score > 0
  ORDER BY score DESC
  LIMIT 5
`;
```

Return top matches with score to let the MCP caller decide whether to confirm or proceed with highest-confidence match.

### MCP Tool Naming Conventions

Follow existing patterns in `task-tools.ts`. For note tools:
- `list_notes` — `projectId` required, optional `category` filter
- `get_note` — `noteId` required
- `create_note` — `projectId`, `title`, `content`, `category?`
- `update_note` — `noteId`, `title?`, `content?`, `category?`
- `delete_note` — `noteId`
- `search_notes` — `projectId`, `query` — returns title + excerpt, not full content

For asset tools:
- `list_assets` — `projectId`
- `move_to_assets` — `projectId`, `srcPath`, `name?` (derive from filename if not given)
- `get_asset_path` — `assetId` — returns absolute path for downstream tool use

Keep descriptions explicit and concise. Return semantically meaningful fields (name, category, excerpt) rather than raw IDs where possible, following MCP tool design best practices.

### Data Directory Layout

```
data/
  assets/
    {projectId}/
      logo.png
      credentials.json
  cache/
    {taskId}/
      screenshot.png
      generated-file.ts
```

Both directories created via `fs.mkdirSync(path, { recursive: true })` on first write. `data/` should be in `.gitignore`. No cleanup automation for `cache/` — manual deletion by user is the stated design decision (PROJECT.md: "手动清理").

---

## Sources

- Codebase analysis: `prisma/schema.prisma`, `src/mcp/tools/task-tools.ts`, `src/mcp/tools/search-tools.ts`, `.planning/PROJECT.md`
- SQLite FTS5: [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html), [SQLite FTS5 in Practice](https://thelinuxcode.com/sqlite-full-text-search-fts5-in-practice-fast-search-ranking-and-real-world-patterns/)
- MCP tool design: [Writing Effective Tools for Agents](https://modelcontextprotocol.info/docs/tutorials/writing-effective-tools/), [Best MCP Servers for Knowledge Bases 2026](https://desktopcommander.app/blog/2026/02/06/best-mcp-servers-for-knowledge-bases-in-2026/)
- Knowledge base patterns: [Top Knowledge Management System Features 2026](https://context-clue.com/blog/top-10-knowledge-management-system-features-in-2026/), [Private KB with MCP](https://pub.towardsai.net/building-a-private-knowledge-base-with-mcp-how-i-made-claude-search-my-own-articles-06c591bb300a)
- Project notes organization: [Linear + Notion integration patterns](https://alaniswright.com/blog/how-we-are-using-linear-and-notion-to-manage-our-product-backlog-and-project-work/), [Obsidian notes organization](https://forum.obsidian.md/t/tips-for-organizing-project-notes-in-obsidian/105860)
- Fuzzy matching: [Redis Fuzzy Matching Guide](https://redis.io/blog/what-is-fuzzy-matching/)

---
*Feature research for: Project knowledge base & intelligent MCP — ai-manager v0.2*
*Researched: 2026-03-27*
