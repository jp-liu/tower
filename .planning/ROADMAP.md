# Roadmap: ai-manager

## Milestones

- ✅ **v0.1 Settings** — Phases 1-3 (shipped 2026-03-27)
- ✅ **v0.2 项目知识库 & 智能 MCP** — Phases 4-7 (shipped 2026-03-30)
- ✅ **v0.3 全局搜索增强** — Phases 8-10 (shipped 2026-03-30)
- ✅ **v0.4 系统配置化** — Phases 11-14 (shipped 2026-03-30)
- ✅ **v0.5 Git Worktree 任务隔离** — Phases 15-18 (shipped 2026-03-31)
- 🚧 **v0.6 任务开发工作台** — Phases 19-23 (in progress)

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

<details>
<summary>✅ v0.4 系统配置化 (Phases 11-14) — SHIPPED 2026-03-30</summary>

- [x] **Phase 11: SystemConfig Foundation** - SystemConfig model, key-value read/write API, and settings page infrastructure (completed 2026-03-30)
- [x] **Phase 12: Git Path Mapping Rules** - Settings UI for adding/editing/deleting host+owner→localPath rules and auto-match on project creation (completed 2026-03-30)
- [x] **Phase 13: Configurable System Parameters** - Wire upload limit, concurrency cap, git timeout, branch template, and search parameters to SystemConfig (completed 2026-03-30)
- [x] **Phase 14: Search Quality & Realtime Config** - Extract shared search logic, fix race condition, verify realtime config takes effect without restart (completed 2026-03-30)

See: [milestones/v0.4-ROADMAP.md](./milestones/v0.4-ROADMAP.md) for full details.

</details>

<details>
<summary>✅ v0.5 Git Worktree 任务隔离 (Phases 15-18) — SHIPPED 2026-03-31</summary>

- [x] Phase 15: Schema & Cleanup (2/2 plans) — completed 2026-03-31
- [x] Phase 16: Worktree Execution Engine (2/2 plans) — completed 2026-03-31
- [x] Phase 17: Review & Merge Workflow (4/4 plans) — completed 2026-03-31
- [x] Phase 18: Worktree Lifecycle (2/2 plans) — completed 2026-03-31

See: [milestones/v0.5-ROADMAP.md](./milestones/v0.5-ROADMAP.md) for full details.

</details>

### 🚧 v0.6 任务开发工作台 (In Progress)

**Milestone Goal:** 为每个任务提供专属的全功能开发工作台页面，集成 AI 聊天、代码浏览编辑、diff 查看和实时预览。

- [ ] **Phase 19: Workbench Entry & Layout** - "查看详情"入口 + 任务专属页面路由 + 三标签右侧面板骨架
- [ ] **Phase 20: File Tree Browser** - Worktree 目录树浏览、gitignore 过滤、git 状态标记、右键菜单操作
- [ ] **Phase 21: Code Editor** - Monaco 在线编辑器（语法高亮、多标签、Ctrl+S 保存、dirty 标记、主题同步）
- [ ] **Phase 22: Diff View Integration** - "变更"标签页复用现有 TaskDiffView 组件接入工作台布局
- [ ] **Phase 23: Preview Panel** - 前端项目类型字段 + 预览面板（启动命令、iframe 嵌入、终端打开、自动刷新）

## Phase Details

### Phase 19: Workbench Entry & Layout
**Goal**: Users can navigate from the task drawer to a dedicated full-page workbench for any task
**Depends on**: Phase 18 (existing task page infrastructure)
**Requirements**: WB-01, WB-02
**Success Criteria** (what must be TRUE):
  1. User can click "查看详情" in the task drawer and navigate to `/workspaces/[id]/tasks/[taskId]`
  2. The task workbench page shows a left AI chat panel and a right panel with three tabs: Files, Changes, Preview
  3. Switching between the three tabs does not lose AI chat state or scroll position
  4. The three right-panel tabs render placeholder content (not blank or crashing) before later phases fill them
**Plans**: 2 plans
Plans:
- [ ] 19-01-PLAN.md — Install react-resizable-panels, add i18n keys, verify 查看详情 button (WB-01)
- [ ] 19-02-PLAN.md — Refactor task-page-client.tsx: resizable panels + three-tab layout (WB-02)
**UI hint**: yes

### Phase 20: File Tree Browser
**Goal**: Users can browse and operate on the task worktree's directory structure from the workbench
**Depends on**: Phase 19
**Requirements**: FT-01, FT-02, FT-03, FT-04, FT-05, FT-06
**Success Criteria** (what must be TRUE):
  1. User can expand and collapse directories in the file tree; folders and files show appropriate icons
  2. Clicking a file in the tree opens it in the editor panel (or passes selection to Phase 21)
  3. Files and directories matching `.gitignore` patterns are hidden from the tree
  4. While Claude is executing, the file tree automatically refreshes every 2 seconds to reflect new or modified files
  5. User can right-click a node to create a file/folder, rename, or delete; changes take effect immediately on disk
  6. File tree nodes display M/A/D badges indicating their git change status relative to the base branch
**Plans**: TBD
**UI hint**: yes

### Phase 21: Code Editor
**Goal**: Users can view and edit any file in the worktree with a full-featured code editor
**Depends on**: Phase 20
**Requirements**: ED-01, ED-02, ED-03, ED-04, ED-05
**Success Criteria** (what must be TRUE):
  1. Clicking a file in the tree opens it in Monaco Editor with correct syntax highlighting for its language
  2. User can press Ctrl+S to save the file; a toast confirms the save and the file is written to disk
  3. Unsaved files display a dot indicator on their editor tab
  4. User can have multiple files open simultaneously as tabs and switch between them without losing edits
  5. The editor color scheme switches automatically when the user toggles between dark and light mode in ai-manager
**Plans**: TBD
**UI hint**: yes

### Phase 22: Diff View Integration
**Goal**: Users can review code changes for the current task in the workbench Changes tab
**Depends on**: Phase 19
**Requirements**: DF-01
**Success Criteria** (what must be TRUE):
  1. The "Changes" tab in the workbench right panel renders a diff of the task branch against its base branch
  2. The diff view is the same component used in the v0.5 task drawer (no duplication of diff logic)
  3. User can reload the diff to see the latest changes after Claude modifies files
**Plans**: TBD
**UI hint**: yes

### Phase 23: Preview Panel
**Goal**: Users can run and preview their frontend project directly inside the workbench
**Depends on**: Phase 21
**Requirements**: PV-01, PV-02, PV-03, PV-04, PV-05, PV-06
**Success Criteria** (what must be TRUE):
  1. When creating or editing a project, user can select project type (Frontend/Backend); frontend projects show the Preview tab in the workbench
  2. User can configure a preview start command per project and click "Run" to launch the dev server; the iframe loads the local URL once the server is ready
  3. User can type a local URL into the preview address bar to navigate the embedded iframe to a different path
  4. User can click "Open in Terminal" to open the worktree directory in their configured terminal app (iTerm2/Terminal.app/Warp)
  5. User can configure the default terminal application in Settings
  6. After saving a file with Ctrl+S, the preview iframe automatically refreshes to reflect the change
**Plans**: TBD
**UI hint**: yes

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
| 11. SystemConfig Foundation | v0.4 | 2/2 | Complete | 2026-03-30 |
| 12. Git Path Mapping Rules | v0.4 | 2/2 | Complete | 2026-03-30 |
| 13. Configurable System Parameters | v0.4 | 2/2 | Complete | 2026-03-30 |
| 14. Search Quality & Realtime Config | v0.4 | 2/2 | Complete | 2026-03-30 |
| 15. Schema & Cleanup | v0.5 | 2/2 | Complete | 2026-03-31 |
| 16. Worktree Execution Engine | v0.5 | 1/2 | Complete | 2026-03-31 |
| 17. Review & Merge Workflow | v0.5 | 4/4 | Complete | 2026-03-31 |
| 18. Worktree Lifecycle | v0.5 | 2/2 | Complete | 2026-03-31 |
| 19. Workbench Entry & Layout | v0.6 | 0/2 | Not started | - |
| 20. File Tree Browser | v0.6 | 0/TBD | Not started | - |
| 21. Code Editor | v0.6 | 0/TBD | Not started | - |
| 22. Diff View Integration | v0.6 | 0/TBD | Not started | - |
| 23. Preview Panel | v0.6 | 0/TBD | Not started | - |
