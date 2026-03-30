# Roadmap: ai-manager

## Milestones

- ✅ **v0.1 Settings** — Phases 1-3 (shipped 2026-03-27)
- 🚧 **v0.2 项目知识库 & 智能 MCP** — Phases 4-7 (in progress)

## Phases

<details>
<summary>✅ v0.1 Settings (Phases 1-3) — SHIPPED 2026-03-27</summary>

- [x] Phase 1: Theme + General Settings (2/2 plans) — completed 2026-03-26
- [x] Phase 2: CLI Adapter Verification (2/2 plans) — completed 2026-03-26
- [x] Phase 3: Agent Prompt Management (2/2 plans) — completed 2026-03-27

See: [milestones/v0.1-ROADMAP.md](./milestones/v0.1-ROADMAP.md) for full details.

</details>

### 🚧 v0.2 项目知识库 & 智能 MCP (In Progress)

**Milestone Goal:** AI agents can identify projects by name, manage a per-project knowledge base (notes, assets), and users have a web UI for notes and assets.

- [x] **Phase 4: Data Layer Foundation** — Schema, FTS5 setup, shared utilities, WAL pragma (completed 2026-03-27)
- [x] **Phase 5: MCP Knowledge Tools** — identify_project, manage_notes, manage_assets MCP tools (completed 2026-03-27)
- [ ] **Phase 6: File Serving & Image Rendering** — Secure file serve route, task message image attachments
- [ ] **Phase 7: Notes & Assets Web UI** — Notes page with Markdown editor, assets page

## Phase Details

### Phase 4: Data Layer Foundation
**Goal**: The data layer for notes and assets is in place and both PrismaClient instances are safe for concurrent use
**Depends on**: Phase 3
**Requirements**: NOTE-01, NOTE-02, NOTE-03, ASST-01, ASST-02
**Success Criteria** (what must be TRUE):
  1. A ProjectNote record can be created, read, updated, and deleted via Prisma
  2. NoteCategory preset values (账号/环境/需求/备忘) and custom categories are queryable per project
  3. FTS5 full-text search returns note results for a Chinese or English keyword without error
  4. A ProjectAsset record can be saved pointing to a file under data/assets/{projectId}/
  5. data/cache/{taskId}/ directory can be created programmatically without error
**Plans**: 2 plans
Plans:
- [x] 04-01-PLAN.md — Schema extension, DB pragmas, FTS5 init, file-utils, constants
- [x] 04-02-PLAN.md — FTS5 search helper, note/asset server actions with tests

### Phase 5: MCP Knowledge Tools
**Goal**: AI agents can find projects by name/alias, and create/read/update/delete notes and assets through MCP tools without knowing project IDs
**Depends on**: Phase 4
**Requirements**: PROJ-01, PROJ-02, PROJ-03, NOTE-04, ASST-03
**Success Criteria** (what must be TRUE):
  1. Calling identify_project with a partial project name returns the correct project with a confidence score
  2. A name-match ranks higher than an alias-match which ranks higher than a description-match
  3. Calling manage_notes with action=create stores a note; action=search returns results matching a keyword
  4. Calling manage_assets with action=add moves a file from a source path into data/assets/{projectId}/
  5. Total MCP tool count remains at or below 30 after all new tools are registered
**Plans**: 2 plans
Plans:
- [x] 05-01-PLAN.md — identify_project tool with scored fuzzy matching and tests
- [x] 05-02-PLAN.md — manage_notes and manage_assets action-dispatch tools, server registration, tests

### Phase 6: File Serving & Image Rendering
**Goal**: Files under data/ are securely accessible via HTTP and image paths in task messages are rendered as visible images
**Depends on**: Phase 5
**Requirements**: ASST-04, UI-03
**Success Criteria** (what must be TRUE):
  1. GET /api/files/assets/{projectId}/{filename} returns the file with correct Content-Type header
  2. A path traversal attempt (e.g., ../../etc/passwd) returns 400 and never reads outside data/
  3. An image path stored in a task message renders as an inline image in the task conversation view
**Plans**: 1 plan
Plans:
- [x] 06-01-PLAN.md — File serving route with path traversal guard, image rendering in task conversation

### Phase 7: Notes & Assets Web UI
**Goal**: Users can manage project notes and browse project assets through the web interface
**Depends on**: Phase 6
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. User can open a notes page for a project, see existing notes filtered by category, and create a new note
  2. User can edit a note in a Markdown editor and the rendered output shows formatted text
  3. User can open an assets page for a project and see a list of uploaded asset files
  4. All new UI strings appear correctly in both Chinese and English
**Plans**: 2 plans
Plans:
- [x] 07-01-PLAN.md — i18n strings, sidebar navigation, Notes page with Markdown editor and category filter
- [x] 07-02-PLAN.md — Assets page with file list, image preview, upload, and download

## Progress

**Execution Order:**
Phases execute in numeric order: 4 → 5 → 6 → 7

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Theme + General Settings | v0.1 | 2/2 | Complete | 2026-03-26 |
| 2. CLI Adapter Verification | v0.1 | 2/2 | Complete | 2026-03-26 |
| 3. Agent Prompt Management | v0.1 | 2/2 | Complete | 2026-03-27 |
| 4. Data Layer Foundation | v0.2 | 2/2 | Complete   | 2026-03-27 |
| 5. MCP Knowledge Tools | v0.2 | 2/2 | Complete   | 2026-03-27 |
| 6. File Serving & Image Rendering | v0.2 | 0/1 | Not started | - |
| 7. Notes & Assets Web UI | v0.2 | 1/2 | In Progress|  |
