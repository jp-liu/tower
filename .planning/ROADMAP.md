# Roadmap: ai-manager

## Milestones

- ✅ **v0.1 Settings** — Phases 1-3 (shipped 2026-03-27)
- ✅ **v0.2 项目知识库 & 智能 MCP** — Phases 4-7 (shipped 2026-03-30)
- ✅ **v0.3 全局搜索增强** — Phases 8-10 (shipped 2026-03-30)
- 🚧 **v0.4 系统配置化** — Phases 11-14 (in progress)

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

<details>
<summary>✅ v0.3 全局搜索增强 (Phases 8-10) — SHIPPED 2026-03-30</summary>

- [x] Phase 8: Asset Description Schema (1/1 plan) — completed 2026-03-30
- [x] Phase 9: Search Actions Expansion (1/1 plan) — completed 2026-03-30
- [x] Phase 10: Search UI Extension (2/2 plans) — completed 2026-03-30

See: [milestones/v0.3-ROADMAP.md](./milestones/v0.3-ROADMAP.md) for full details.

</details>

### 🚧 v0.4 系统配置化 (In Progress)

**Milestone Goal:** 将系统中的硬编码值提取为用户可配置项，通过设置页 UI 和数据库存储实现个性化配置。

- [x] **Phase 11: SystemConfig Foundation** - SystemConfig model, key-value read/write API, and settings page infrastructure (completed 2026-03-30)
- [ ] **Phase 12: Git Path Mapping Rules** - Settings UI for adding/editing/deleting host+owner→localPath rules and auto-match on project creation
- [ ] **Phase 13: Configurable System Parameters** - Wire upload limit, concurrency cap, git timeout, branch template, and search parameters to SystemConfig
- [ ] **Phase 14: Search Quality & Realtime Config** - Extract shared search logic, fix race condition, verify realtime config takes effect without restart

## Phase Details

### Phase 11: SystemConfig Foundation
**Goal**: Users have a persistent config store they can read from and write to, and the settings page has a Config section ready to host parameter controls
**Depends on**: Phase 10 (Phases 1-10 complete)
**Requirements**: CFG-01
**Success Criteria** (what must be TRUE):
  1. A `SystemConfig` table exists in the database with key, value, and updatedAt columns
  2. Server actions exist to get a config value by key (with typed default) and set a config value by key
  3. The settings page shows a new Config section (or equivalent navigation entry) — even if empty at this phase
  4. Reading a key that has no stored value returns the declared default without error
**Plans**: 2 plans
Plans:
- [x] 11-01-PLAN.md — SystemConfig model, server actions API, defaults registry, and unit tests
- [x] 11-02-PLAN.md — Settings page Config nav item, placeholder component, page wiring, i18n keys
**UI hint**: yes

### Phase 12: Git Path Mapping Rules
**Goal**: Users can manage Git path mapping rules from the settings page, and those rules auto-apply when a Git URL is entered during project creation
**Depends on**: Phase 11
**Requirements**: GIT-01, GIT-02
**Success Criteria** (what must be TRUE):
  1. User can add a Git path mapping rule specifying host, owner, and a localPath template
  2. User can edit an existing rule and delete a rule from the settings page
  3. When creating a project and entering a Git URL, the localPath field auto-populates by matching the URL against saved rules
  4. Rules are persisted across page reloads and app restarts
**Plans**: 2 plans
Plans:
- [x] 12-01-PLAN.md — GitPathRule type, matchGitPathRule logic, resolveGitLocalPath server action, top-bar async wiring, unit tests
- [ ] 12-02-PLAN.md — Settings UI CRUD for Git path mapping rules, i18n keys, visual verification
**UI hint**: yes

### Phase 13: Configurable System Parameters
**Goal**: Users can configure upload size limit, max concurrent executions, Git timeouts, branch naming template, and search parameters through the settings UI — replacing all hardcoded values
**Depends on**: Phase 11
**Requirements**: SYS-01, SYS-02, GIT-03, GIT-04, SRCH-05
**Success Criteria** (what must be TRUE):
  1. User can set the maximum upload file size (replacing the hardcoded 50 MB limit) and uploads beyond the new limit are rejected
  2. User can set the maximum concurrent execution count (replacing the hardcoded 3) and the execution manager respects the new value
  3. User can set the Git operation timeout (clone/status/other) and Git commands use the configured value
  4. User can set the branch naming template (replacing the hardcoded `vk/${taskId}-` prefix) and new task branches follow the template
  5. User can set search result count, All-mode cap, debounce delay, and snippet length, and the search UI applies the configured values
**Plans**: TBD
**UI hint**: yes

### Phase 14: Search Quality & Realtime Config
**Goal**: Search logic has no duplication between server actions and MCP tools, the search UI has no race condition, and config changes take effect immediately without restarting the app
**Depends on**: Phase 13
**Requirements**: SRCH-06, SRCH-07, CFG-02
**Success Criteria** (what must be TRUE):
  1. A shared `src/lib/search.ts` module exists and both `search-actions.ts` and `search-tools.ts` delegate to it — no duplicated search logic
  2. Rapidly typing in the search box (changing query before previous result returns) never shows stale results from an earlier query
  3. Changing a config value in settings takes effect in the running app without a server restart or page reload
**Plans**: TBD

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
| 8. Asset Description Schema | v0.3 | 1/1 | Complete | 2026-03-30 |
| 9. Search Actions Expansion | v0.3 | 1/1 | Complete | 2026-03-30 |
| 10. Search UI Extension | v0.3 | 2/2 | Complete | 2026-03-30 |
| 11. SystemConfig Foundation | v0.4 | 2/2 | Complete    | 2026-03-30 |
| 12. Git Path Mapping Rules | v0.4 | 1/2 | In Progress|  |
| 13. Configurable System Parameters | v0.4 | 0/TBD | Not started | - |
| 14. Search Quality & Realtime Config | v0.4 | 0/TBD | Not started | - |
