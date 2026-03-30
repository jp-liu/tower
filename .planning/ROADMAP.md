# Roadmap: ai-manager

## Milestones

- ✅ **v0.1 Settings** — Phases 1-3 (shipped 2026-03-27)
- ✅ **v0.2 项目知识库 & 智能 MCP** — Phases 4-7 (shipped 2026-03-30)
- 🔄 **v0.3 全局搜索增强** — Phases 8-10 (in progress)

## Phases

<details>
<summary>✅ v0.1 Settings (Phases 1-3) — SHIPPED 2026-03-27</summary>

- [x] Phase 1: Theme + General Settings (2/2 plans) — completed 2026-03-26
- [x] Phase 2: CLI Adapter Verification (2/2 plans) — completed 2026-03-26
- [x] Phase 3: Agent Prompt Management (2/2 plans) — completed 2026-03-27

See: [milestones/v0.1-ROADMAP.md](./milestones/v0.1-ROADMAP.md) for full details.

</details>

<details>
<summary>✅ v0.2 项目知识库 & 智能 MCP (Phases 4-7) — SHIPPED 2026-03-30</summary>

- [x] Phase 4: Data Layer Foundation (2/2 plans) — completed 2026-03-27
- [x] Phase 5: MCP Knowledge Tools (2/2 plans) — completed 2026-03-27
- [x] Phase 6: File Serving & Image Rendering (1/1 plan) — completed 2026-03-27
- [x] Phase 7: Notes & Assets Web UI (2/2 plans) — completed 2026-03-27

See: [milestones/v0.2-ROADMAP.md](./milestones/v0.2-ROADMAP.md) for full details.

</details>

### v0.3 全局搜索增强 (Phases 8-10)

- [ ] **Phase 8: Asset Description Schema** — Add description field to ProjectAsset model and upload dialog
- [x] **Phase 9: Search Actions Expansion** — Extend globalSearch with note/asset/all categories; sync MCP tool (completed 2026-03-30)
- [ ] **Phase 10: Search UI Extension** — Six-tab search dialog with grouped All rendering, snippets, and i18n

## Phase Details

### Phase 8: Asset Description Schema
**Goal**: Assets carry a description that users can populate at upload time and that search can match against
**Depends on**: Nothing (schema-first phase)
**Requirements**: ASSET-01, ASSET-02
**Success Criteria** (what must be TRUE):
  1. User can type a description in the upload dialog before submitting an asset
  2. The submitted description is persisted to the database and visible after page reload
  3. Pre-existing assets without a description are not broken (they show an empty description, not an error)
  4. The upload dialog form rejects submission when the description field is missing
**Plans:** 1 plan
Plans:
- [x] 08-01-PLAN.md — Schema + data layer + UI for asset description field

### Phase 9: Search Actions Expansion
**Goal**: Server-side search logic covers notes and assets across all projects, and MCP tool reflects the same capabilities
**Depends on**: Phase 8
**Requirements**: SRCH-01, SRCH-02, SRCH-03, SRCH-04
**Success Criteria** (what must be TRUE):
  1. Calling globalSearch with category "note" returns notes whose title or content matches the query via FTS5
  2. Calling globalSearch with category "asset" returns assets whose filename or description matches the query
  3. Calling globalSearch with category "all" returns results from all five types (task, project, repository, note, asset) grouped and capped per type
  4. MCP search tool accepts "note", "asset", and "all" as valid categories and returns the same results as the server action
  5. A malformed FTS5 query (e.g., unmatched quotes) does not crash the server — it falls back to LIKE search
**Plans:** 1/1 plans complete
Plans:
- [x] 09-01-PLAN.md — Note/asset/all search branches + MCP parity + test coverage

### Phase 10: Search UI Extension
**Goal**: Users can run a single search and see all matching content across every type in one unified view, or narrow to a specific type via tabs
**Depends on**: Phase 9
**Requirements**: SUI-01, SUI-02, SUI-03, ASSET-03
**Success Criteria** (what must be TRUE):
  1. Search dialog shows six tabs: All, Task, Project, Repository, Note, Asset
  2. In "All" tab, results are displayed in named sections (one per type) rather than a flat undifferentiated list
  3. Note search results display a content snippet (first ~80 characters of note content) beneath the title
  4. Asset search results display the asset description beneath the filename
  5. All tab labels, section headers, and result metadata are displayed in both Chinese and English according to the active language setting
**Plans:** 1/2 plans executed
Plans:
- [x] 10-01-PLAN.md — Data layer: snippet field on SearchResult + i18n key additions
- [ ] 10-02-PLAN.md — UI: six-tab search dialog with grouped All rendering + snippets + component tests

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Theme + General Settings | v0.1 | 2/2 | Complete | 2026-03-26 |
| 2. CLI Adapter Verification | v0.1 | 2/2 | Complete | 2026-03-26 |
| 3. Agent Prompt Management | v0.1 | 2/2 | Complete | 2026-03-27 |
| 4. Data Layer Foundation | v0.2 | 2/2 | Complete | 2026-03-27 |
| 5. MCP Knowledge Tools | v0.2 | 2/2 | Complete | 2026-03-27 |
| 6. File Serving & Image Rendering | v0.2 | 1/1 | Complete | 2026-03-27 |
| 7. Notes & Assets Web UI | v0.2 | 2/2 | Complete | 2026-03-27 |
| 8. Asset Description Schema | v0.3 | 0/1 | Not started | - |
| 9. Search Actions Expansion | v0.3 | 1/1 | Complete   | 2026-03-30 |
| 10. Search UI Extension | v0.3 | 1/2 | In Progress|  |
