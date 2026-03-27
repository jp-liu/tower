# Project Research Summary

**Project:** ai-manager v0.2 — Project Knowledge Base & Enhanced MCP
**Domain:** Local AI task management platform — additive knowledge base and intelligent MCP layer
**Researched:** 2026-03-27
**Confidence:** HIGH

## Executive Summary

ai-manager v0.2 extends an existing Next.js 16 + SQLite + Prisma + MCP stack with a project-scoped knowledge base (notes, assets) and smarter AI agent tooling. The core addition is a `ProjectNote` model with SQLite FTS5 full-text search, a `ProjectAsset` model with local filesystem storage, and expanded MCP tools that let AI agents identify projects by name/alias (not just by ID) and CRUD notes and assets without opening the web UI. The design is deliberately local-first and single-user — no cloud sync, no external services, no binary upload over HTTP. Every new feature fits within the constraints already established in v0.1.

The recommended approach is to build in four ordered phases: data layer (schema + shared utilities) then MCP tools (server-side, no UI dependency) then file management then web UI. This ordering is mandated by technical dependencies: MCP tools can be built and tested independently of the UI, while both depend on the data layer being in place. The single biggest technical challenge is SQLite FTS5 integration — Prisma cannot manage FTS5 virtual tables in its schema, so the index must be created via raw SQL and maintained via triggers at the SQLite engine level, completely outside Prisma's migration system.

The primary risks are: (1) FTS5 shadow tables causing Prisma `db push` to prompt a destructive database reset — prevent by creating FTS5 tables after schema push, never before; (2) concurrent write lock contention between the Next.js process and the MCP stdio process sharing the same SQLite file — prevent by setting `PRAGMA busy_timeout=5000` on both PrismaClient instances; (3) MCP tool proliferation consuming excessive context tokens — prevent by designing action-dispatch tools (`manage_note`, `manage_asset`) rather than one tool per CRUD verb. All three risks are preventable with upfront discipline.

## Key Findings

### Recommended Stack

The existing stack (Next.js 16, React 19, Prisma 6, SQLite, Zustand, Tailwind, MCP SDK) requires only three new npm packages. `fuse.js` (^7.1.0) handles fuzzy project matching in the MCP layer — zero deps, built-in TypeScript types, field-weighted scoring. `@uiw/react-md-editor` (^4.0.11) provides the Markdown editing experience for the notes web UI — must be dynamically imported with `ssr: false` to avoid Next.js App Router SSR errors. `mime-types` (^2.1.35) maps file extensions to Content-Type headers in the file-serving route handler — use this over `mime@4` which is ESM-only and conflicts with Next.js's mixed CJS/ESM environment. Everything else — FTS5 queries, file system operations, file serving — uses existing Node.js built-ins, Prisma raw queries, and the established Route Handler pattern.

**Core technologies:**
- `fuse.js` ^7.1.0: fuzzy project matching in MCP process — zero deps, field-weighted scoring, built-in TS types
- `@uiw/react-md-editor` ^4.0.11: markdown editor for notes UI — lightweight (~4.6 kB gzipped), requires `dynamic({ ssr: false })` import
- `mime-types` ^2.1.35: Content-Type header resolution in file serving route — CJS-compatible (use instead of `mime@4`)
- SQLite FTS5 via `prisma.$queryRaw`: full-text note search — no additional library; requires raw SQL setup outside Prisma schema
- `fs.promises` (Node.js built-in): file move/copy operations — EXDEV cross-device fallback required

**Install command:** `pnpm add fuse.js @uiw/react-md-editor mime-types`

### Expected Features

The milestone goal is a "personal multi-project information hub accessible via MCP." Smart project identification is the keystone feature — without it, AI agents must know exact projectIDs, which defeats the purpose of intelligent tooling. All other MCP knowledge tools depend on it. Notes and assets are parallel subsystems with no mutual dependency and can be developed concurrently.

**Must have (table stakes):**
- Note CRUD (create/read/update/delete) scoped to project — foundation of the knowledge base
- Markdown rendering for note content — developers expect this; existing `react-markdown` stack already supports it
- Category taxonomy (preset: 账号/环境/需求/备忘 + custom) — users mentally organize notes by purpose
- Full-text search across notes (FTS5 BM25) — notes are useless without retrieval
- Project asset storage (`data/assets/{projectId}/`) + metadata in DB — file association with projects
- Notes web UI at `/projects/[projectId]/notes` — mandatory for a web app

**Should have (competitive differentiators):**
- Smart project identification MCP tool — AI agents can reference projects by name/alias, not just by ID
- MCP note tools (`list_notes`, `get_note`, `create_note`, `update_note`, `delete_note`, `search_notes`) — makes knowledge base accessible to agents without opening web UI
- MCP asset tools (`list_assets`, `move_to_assets`, `get_asset_path`) — closes the loop from "generated file" to "stored asset"
- Task cache directory (`data/cache/{taskId}/`) + image attachment rendering in message thread — agents can store and reference intermediate outputs
- Cross-note search with snippet highlighting — FTS5 `snippet()` function returns context around matches

**Defer (v2+):**
- Note versioning / history — overkill for single-user local tool; SQLite file backup is sufficient
- Semantic / embedding-based search — FTS5 BM25 is sufficient at expected scale (<10k notes)
- Hierarchical note folders — category tags + search achieves equivalent discoverability without tree complexity
- Assets web UI (download panel) — MCP access is the primary use case; web UI is secondary for v0.2

### Architecture Approach

The v0.2 architecture adds two parallel subsystems (notes, assets) that both depend on a shared data layer foundation, then surface through both the MCP server process and the Next.js web UI. Two shared pure-Node.js modules (`src/lib/file-utils.ts` and `src/lib/fts.ts`) bridge the process boundary — they must never import Next.js-specific modules (`next/cache`, `next/headers`) so they remain importable from the MCP stdio process. The file system storage uses a `data/` directory at project root, separated into `assets/{projectId}/` (persistent) and `cache/{taskId}/` (ephemeral), both gitignored. SQLite WAL mode is already configured on the MCP client and must be added to the Next.js client to prevent lock contention during concurrent operations.

**Major components:**
1. `src/lib/file-utils.ts` — path resolution, EXDEV-safe `fs.rename`/`copyFile` move, `mkdir` — shared between Next.js and MCP processes (no Next.js imports)
2. `src/lib/fts.ts` — FTS5 search and index queries via `$queryRaw` — accepts PrismaClient as parameter; works with both DB instances
3. `src/actions/note-actions.ts` + `src/actions/asset-actions.ts` — server actions for web UI; wrap Prisma + lib utilities
4. `src/mcp/tools/note-tools.ts` + `src/mcp/tools/asset-tools.ts` — MCP tools; use `src/mcp/db.ts` directly (never import server actions)
5. Notes UI components (`note-list.tsx`, `note-editor.tsx`, `note-detail.tsx`) — Client Components; category filter, markdown editor with dynamic import, read-only viewer
6. `findProjectByIdentifier` helper in `src/mcp/tools/project-tools.ts` — fuzzy project lookup with confidence scoring, used by all knowledge MCP tools

**Key architectural constraint:** MCP tools MUST NOT import from `src/actions/`. Server actions use Next.js-specific modules that crash in the MCP stdio process. Share only `src/lib/file-utils.ts` and `src/lib/fts.ts`.

### Critical Pitfalls

1. **FTS5 shadow tables break `prisma db push`** — Run `db push` for normal models first; create FTS5 virtual table and triggers afterward via `$executeRaw` in a startup setup function with `IF NOT EXISTS` guards. Never create FTS5 objects before `db push` or Prisma detects drift and may prompt a destructive database reset.

2. **SQLite "database is locked" from concurrent Next.js + MCP writes** — Both `src/lib/db.ts` and `src/mcp/db.ts` must set `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` on connection open. Currently only the MCP client sets these pragmas. Fix in Phase 1 before any concurrent write paths are built.

3. **MCP tool proliferation degrades AI agent performance** — 18 existing tools + ~10 new tools = ~11,000-14,000 context tokens consumed before any conversation begins. Design action-dispatch tools: `manage_note(action: 'create'|'update'|...)` and `manage_asset(action: 'upload'|'list'|...)` rather than one tool per CRUD verb. Target total tool count at or below 30.

4. **`fs.rename()` fails across filesystem boundaries (EXDEV error)** — AI agents write output to `/tmp` which may be on a different filesystem than `data/`. Always wrap `fs.rename()` in try/catch with `copyFile + unlink` fallback on `EXDEV`. Implement this pattern in `file-utils.ts` before any file-move operation is exposed via MCP.

5. **Path traversal in file serve route and MCP source-path parameters** — The `GET /api/files/[...path]` route must use `path.resolve()` + `startsWith(DATA_ROOT + sep)` containment check. MCP tools accepting `sourcePath` must validate the path is under the project's `localPath`. One line of code prevents the entire class of vulnerability.

6. **Fuzzy project match returns wrong project silently** — Simple `LIKE`-based matching with no threshold returns the best match regardless of quality. Return `null` below 0.85 confidence on name/alias; return multiple candidates when scores are close instead of silently picking one. Always include `confidence` score and matched project name in MCP tool response so the agent can confirm aloud.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Data Layer Foundation
**Rationale:** All other phases depend on the schema and shared utilities. FTS5 setup must happen before MCP tools or UI are built, and WAL/timeout configuration must happen before any concurrent write path exists. This phase has no UI dependency and is fully verifiable in isolation.
**Delivers:** `ProjectNote` and `ProjectAsset` Prisma models with relations and indexes; FTS5 virtual table + triggers via raw SQL setup function; `src/lib/file-utils.ts` (EXDEV-safe move, path resolution, mkdir); `src/lib/fts.ts` (FTS5 query helpers); WAL + `busy_timeout` configured on both PrismaClient instances; `data/` directory structure and `.gitignore` configuration.
**Addresses:** Note CRUD data foundation, asset storage foundation, full-text search infrastructure
**Avoids:** FTS5 shadow table data loss (Pitfall 1), SQLite lock contention (Pitfall 2), schema migration data loss (Pitfall 7)
**Research flag:** Standard patterns — no additional research needed. Prisma raw SQL, FTS5 trigger setup, and WAL pragma patterns are fully documented in STACK.md and PITFALLS.md.

### Phase 2: MCP Knowledge Base Tools
**Rationale:** MCP tools have no UI dependency and can be built and tested immediately after the data layer. Smart project identification must be implemented first within this phase because all note and asset MCP tools depend on it for project resolution. Designing the tool surface (action-dispatch pattern) before coding prevents context window bloat.
**Delivers:** `find_project` MCP tool with confidence scoring and multi-candidate disambiguation; `manage_note` action-dispatch tool (list/get/create/update/delete/search); `manage_asset` action-dispatch tool (list/add/delete); all tools registered in `src/mcp/server.ts`.
**Uses:** `fuse.js` for fuzzy matching, `src/lib/fts.ts` for search, `src/lib/file-utils.ts` for asset moves
**Implements:** Smart project identification with 0.85 confidence threshold; action-dispatch tool pattern keeping total MCP tool count at or below 30
**Avoids:** MCP tool proliferation (Pitfall 5), fuzzy match false positives (Pitfall 6)
**Research flag:** Standard patterns. Tool design decisions are documented; implement per ARCHITECTURE.md build order steps 8-12.

### Phase 3: File Management & Asset Serving
**Rationale:** File operations and the asset-serving Route Handler form a cohesive, security-critical subsystem. Path traversal prevention and EXDEV-safe move logic are independently testable. Isolating this phase ensures security checks are not omitted under feature delivery pressure.
**Delivers:** `GET /api/files/[...path]` route handler with `path.resolve()` + containment check; source path validation in file-accepting MCP tools; task cache directory support (`data/cache/{taskId}/`); task message image attachment rendering in web UI message thread.
**Avoids:** Path traversal vulnerability (Pitfalls 4 and 8), EXDEV cross-device move error (Pitfall 3), unvalidated source paths (security table)
**Research flag:** Standard patterns. Node.js `fs.promises` API and Next.js Route Handler streaming are confirmed. Security checks are single-line implementations documented in PITFALLS.md.

### Phase 4: Notes Web UI
**Rationale:** UI depends on server actions from Phase 1 and is the last piece. The Markdown editor has a specific Next.js SSR gotcha (`ssr: false` dynamic import) and XSS sanitization requirements that must be handled correctly. Placing UI last keeps earlier phases testable without browser dependency.
**Delivers:** Notes route under the project detail view; note list with category filter tabs; `note-editor.tsx` with `@uiw/react-md-editor` (dynamic import, `ssr: false`); `note-detail.tsx` with `@tailwindcss/typography` prose rendering; debounced autosave or unsaved-changes navigation guard; i18n coverage for all new strings in both zh and en.
**Uses:** `@uiw/react-md-editor` with `dynamic({ ssr: false })`, `react-markdown` + `remarkGfm` for read-only rendering (no `rehypeRaw` unless paired with `rehypeSanitize`)
**Avoids:** `react-markdown` XSS via missing sanitization (Pitfall 9), note editor unsaved-changes loss (UX pitfalls table)
**Research flag:** `@uiw/react-md-editor` React 19 compatibility is MEDIUM confidence (backward compat inferred, not explicitly tested). Test `dynamic({ ssr: false })` as the first implementation step. If hydration errors appear, fall back to plain `<textarea>` + side-by-side `react-markdown` preview with no bundle cost.

### Phase Ordering Rationale

- **Data layer first** because both MCP tools and the web UI have hard dependencies on Prisma models, FTS5 index, and shared utilities. Building either without this foundation produces incomplete features.
- **MCP tools before web UI** because MCP tools have no UI dependency and provide immediate testable value. AI agents can use the knowledge base as soon as Phase 2 is done, even without any web UI.
- **File management as its own phase** because the security-critical path validation and cross-device move handling form a cohesive, independently testable unit. Mixing it into Phase 2 or 4 risks security checks being cut under feature pressure.
- **Web UI last** because it is the most dependent layer (needs all server actions) and has the only MEDIUM confidence item (React 19 + md-editor compatibility).

### Research Flags

Phases needing specific caution during implementation:
- **Phase 1:** FTS5 setup order is non-negotiable — run `db push` first, FTS5 raw SQL second. Back up `prisma/dev.db` before any schema push.
- **Phase 2:** Fuzzy match confidence thresholds (0.85 for name/alias, 0.70 for description) should be tuned against real project name data before Phase 2 is marked done.
- **Phase 4:** `@uiw/react-md-editor` React 19 compatibility is MEDIUM confidence. Have the fallback plan (plain textarea + react-markdown) ready before starting the component.

Phases with standard patterns (no additional research needed):
- **Phase 1:** Prisma schema additions, FTS5 triggers, WAL pragma — all confirmed patterns with official sources.
- **Phase 3:** Node.js file operations, path containment check, Route Handler streaming — standard Node.js/Next.js patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All additions verified via official docs and npm; only `@uiw/react-md-editor` React 19 compat is MEDIUM (backward compat inferred, not explicitly confirmed) |
| Features | HIGH | Derived from codebase analysis + competitor analysis (Notion/Obsidian/Linear); MVP scope is clearly bounded and validated against PROJECT.md constraints |
| Architecture | HIGH | Derived from direct codebase inspection of all relevant source files; component boundaries and process separation are confirmed facts, not assumptions |
| Pitfalls | HIGH | 9 critical pitfalls with prevention code; sourced from Prisma issue tracker, SQLite official docs, Node.js issue tracker, and community benchmarks |

**Overall confidence:** HIGH

### Gaps to Address

- **`@uiw/react-md-editor` React 19 runtime compatibility:** No explicit React 19 test case found. During Phase 4, test `dynamic({ ssr: false })` first; fall back to plain textarea + `react-markdown` preview if hydration errors occur.
- **Fuzzy match threshold tuning:** The 0.85 name/alias threshold is a recommendation derived from general fuzzy matching literature. Validate against real project name data during Phase 2 implementation and adjust if short project names ("app", "api", "web") produce false positives.
- **MCP tool count budget:** With action-dispatch design, v0.2 adds 3 tools (find_project + manage_note + manage_asset) to the existing 18, for a total of 21. Confirm the action-dispatch approach is maintained throughout Phase 2 implementation to stay within the 30-tool budget.
- **Light theme for Notes UI:** If a light theme is introduced in parallel work, verify `@uiw/react-md-editor` and `@tailwindcss/typography` prose styles are compatible with the light color scheme.

## Sources

### Primary (HIGH confidence)
- Codebase inspection (`prisma/schema.prisma`, `src/mcp/server.ts`, `src/lib/db.ts`, `src/mcp/db.ts`, `src/actions/search-actions.ts`, `src/mcp/tools/search-tools.ts`, `.planning/PROJECT.md`) — architecture facts and existing patterns
- [SQLite FTS5 extension official docs](https://www.sqlite.org/fts5.html) — trigger patterns, content table approach, BM25 ranking, `snippet()` function
- [Prisma raw database access docs](https://www.prisma.io/docs/orm/prisma-client/queries/raw-database-access) — `$queryRaw`, `$executeRaw`, `$executeRawUnsafe` confirmed for Prisma 6
- [Fuse.js official site](https://www.fusejs.io/) — version 7.1.0, field-weighted scoring, threshold semantics, zero deps
- [mime-types npm](https://www.npmjs.com/package/mime-types) — v2.1.35, CJS compatibility confirmed
- [SQLite WAL mode official docs](https://www.sqlite.org/wal.html) — WAL + busy_timeout configuration

### Secondary (MEDIUM confidence)
- [Prisma issue #8106](https://github.com/prisma/prisma/issues/8106) — FTS5 shadow table drift detection; raw SQL workaround confirmed
- [uiwjs/react-md-editor npm](https://www.npmjs.com/package/@uiw/react-md-editor) — v4.0.11; SSR workaround confirmed via GitHub issues
- [Next.js Route Handler file streaming](https://www.ericburel.tech/blog/nextjs-stream-files) — ReadableStream pattern confirmed
- [MCP tool context bloat — demiliani.com](https://demiliani.com/2025/09/04/model-context-protocol-and-the-too-many-tools-problem/) — tool count performance impact at scale
- [SQLite concurrent writes and lock errors](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) — WAL + busy_timeout approach validated
- [react-markdown XSS pitfall — Medium](https://medium.com/@brian3814/pitfall-of-potential-xss-in-markdown-editors-1d9e0d2df93a) — rehypeRaw + sanitize requirement

### Tertiary (LOW confidence)
- [Next.js path traversal CVE-2020-5284 — Snyk](https://security.snyk.io/vuln/SNYK-JS-NEXT-561584) — path traversal pattern; prevention approach is standard
- [Redis Fuzzy Matching Guide](https://redis.io/blog/what-is-fuzzy-matching/) — confidence threshold recommendations extrapolated to local use case
- [Node.js issue #19077 — fs.rename() cross-device EXDEV](https://github.com/nodejs/node/issues/19077) — EXDEV error behavior confirmed

---
*Research completed: 2026-03-27*
*Ready for roadmap: yes*
