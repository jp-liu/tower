# Roadmap: ai-manager

## Milestones

- ✅ **v0.1 Settings** — Phases 1-3 (shipped 2026-03-27)
- ✅ **v0.2 项目知识库 & 智能 MCP** — Phases 4-7 (shipped 2026-03-30)
- ✅ **v0.3 全局搜索增强** — Phases 8-10 (shipped 2026-03-30)
- ✅ **v0.4 系统配置化** — Phases 11-14 (shipped 2026-03-30)
- ✅ **v0.5 Git Worktree 任务隔离** — Phases 15-18 (shipped 2026-03-31)
- ✅ **v0.6 任务开发工作台** — Phases 19-23 (shipped 2026-04-01)
- 🚧 **v0.7 终端交互体验** — Phases 24-28 (in progress)

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

<details>
<summary>✅ v0.6 任务开发工作台 (Phases 19-23) — SHIPPED 2026-04-01</summary>

- [x] **Phase 19: Workbench Entry & Layout** - "查看详情"入口 + 任务专属页面路由 + 三标签右侧面板骨架 (completed 2026-03-31)
- [x] **Phase 20: File Tree Browser** - Worktree 目录树浏览、gitignore 过滤、git 状态标记、右键菜单操作 (completed 2026-04-01)
- [x] **Phase 21: Code Editor** - Monaco 在线编辑器（语法高亮、多标签、Ctrl+S 保存、dirty 标记、主题同步） (completed 2026-04-01)
- [x] **Phase 22: Diff View Integration** - "变更"标签页复用现有 TaskDiffView 组件接入工作台布局 (completed 2026-04-01)
- [x] **Phase 23: Preview Panel** - 前端项目类型字段 + 预览面板（启动命令、iframe 嵌入、终端打开、自动刷新） (completed 2026-04-01)

See: [milestones/v0.6-ROADMAP.md](./milestones/v0.6-ROADMAP.md) for full details.

</details>

### 🚧 v0.7 终端交互体验 (In Progress)

**Milestone Goal:** 将任务执行界面从 SSE 聊天气泡替换为真正的浏览器内终端（node-pty + WebSocket + xterm.js），用户在网页上看到的和本地运行 Claude Code 完全一样。

- [x] **Phase 24: PTY Backend & WebSocket Server** - node-pty 会话注册表 + 独立 WebSocket server (port 3001) 双向通信 + 安全防护 (completed 2026-04-02)
- [ ] **Phase 25: xterm.js Terminal Component** - 浏览器终端组件（ANSI 渲染、键盘输入、resize 同步、主题跟随）
- [ ] **Phase 26: Workbench Integration** - 工作台左侧面板替换 SSE 聊天气泡为终端组件 + 执行生命周期对接
- [ ] **Phase 27: Task Card Context Menu** - Kanban 卡片右键菜单（更改状态、启动任务、前往详情页）
- [ ] **Phase 28: v0.6 Bug Fixes** - Monaco 加载稳定性修复 + Diff 显示条件修复

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
- [x] 19-01-PLAN.md — Install react-resizable-panels, add i18n keys, verify 查看详情 button (WB-01)
- [x] 19-02-PLAN.md — Refactor task-page-client.tsx: resizable panels + three-tab layout (WB-02)
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
**Plans**: 3 plans
Plans:
- [x] 20-01-PLAN.md — Install ignore dep, safeResolvePath utility, test scaffolds (FT-01, FT-02, FT-03, FT-05)
- [x] 20-02-PLAN.md — File CRUD server actions + getGitStatus (FT-01, FT-03, FT-05, FT-06)
- [x] 20-03-PLAN.md — FileTree/FileTreeNode/FileTreeContextMenu components + task page integration (FT-01-06)
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
**Plans**: 3 plans
Plans:
- [x] 21-01-PLAN.md — Install Monaco packages, readFileContent/writeFileContent server actions, editor i18n keys (ED-01, ED-02)
- [x] 21-02-PLAN.md — EditorTabs component + CodeEditor (Monaco, multi-tab, dirty dot, Ctrl+S, theme sync) (ED-01-05)
- [x] 21-03-PLAN.md — Wire CodeEditor into task-page-client.tsx Files tab split layout (ED-01-05)
**UI hint**: yes

### Phase 22: Diff View Integration
**Goal**: Users can review code changes for the current task in the workbench Changes tab
**Depends on**: Phase 19
**Requirements**: DF-01
**Success Criteria** (what must be TRUE):
  1. The "Changes" tab in the workbench right panel renders a diff of the task branch against its base branch
  2. The diff view is the same component used in the v0.5 task drawer (no duplication of diff logic)
  3. User can reload the diff to see the latest changes after Claude modifies files
**Plans**: 1 plan
Plans:
- [x] 22-01-PLAN.md — Wire TaskDiffView into workbench Changes tab (DF-01)
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
**Plans**: 3 plans
Plans:
- [x] 23-01-PLAN.md — Schema migration (projectType/previewCommand), preview process manager, server actions, config defaults, i18n (PV-01, PV-03, PV-04, PV-05)
- [x] 23-02-PLAN.md — PreviewPanel component, project type selector in TopBar dialog, Settings terminal input (PV-01, PV-02, PV-03, PV-04, PV-05)
- [x] 23-03-PLAN.md — CodeEditor onSave prop, task-page-client wiring, human-verify checkpoint (PV-01, PV-02, PV-03, PV-04, PV-06)
**UI hint**: yes

### Phase 24: PTY Backend & WebSocket Server
**Goal**: A working, leak-proof WebSocket server that spawns Claude CLI in a PTY, streams output, handles input and resize, and cleans up correctly
**Depends on**: Phase 23 (instrumentation.ts already exists for worktree pruning)
**Requirements**: PTY-01, PTY-02, PTY-03, WS-01, WS-02, WS-03, WS-04
**Success Criteria** (what must be TRUE):
  1. `wscat -c ws://localhost:3001` can connect and receive raw Claude CLI output including ANSI escape sequences
  2. Typing input through the WebSocket connection is forwarded to the PTY and accepted by Claude CLI interactively
  3. A cross-origin connection attempt (non-localhost origin) is rejected with 403
  4. Closing the WebSocket does not kill the PTY session; reconnecting within 30 seconds reattaches to the same running process
  5. Running 5 open/close cycles produces zero zombie processes (verified via `ps aux | grep pty`)
**Plans**: 2 plans
Plans:
- [x] 24-01-PLAN.md — Install node-pty + ws, switch to --webpack, PTY session registry (PTY-01, PTY-02, PTY-03)
- [x] 24-02-PLAN.md — WebSocket server with bidirectional I/O, origin validation, keepalive (WS-01, WS-02, WS-03, WS-04)

### Phase 25: xterm.js Terminal Component
**Goal**: Users see a fully functional browser terminal that renders PTY output with ANSI colors, accepts keyboard input, and resizes with the panel
**Depends on**: Phase 24
**Requirements**: TERM-01, TERM-02, TERM-03, TERM-04
**Success Criteria** (what must be TRUE):
  1. The terminal renders ANSI color sequences from Claude CLI output (progress bars, colored text, cursor movement)
  2. User can type in the terminal and the input is forwarded to Claude CLI (interactive prompts work)
  3. Resizing the workbench panel causes the terminal to refit and PTY columns/rows to update within 100ms
  4. The terminal background and text colors switch automatically when user toggles dark/light mode
**Plans**: 2 plans
Plans:
- [ ] 25-01-PLAN.md — Install xterm addons + i18n keys (TERM-01, TERM-02, TERM-03, TERM-04)
- [ ] 25-02-PLAN.md — TaskTerminal component (TERM-01, TERM-02, TERM-03, TERM-04)
**UI hint**: yes

### Phase 26: Workbench Integration
**Goal**: Users can start task execution and see Claude CLI running live in the workbench terminal, with task status updating when done
**Depends on**: Phase 25
**Requirements**: INT-01, INT-02, INT-03
**Success Criteria** (what must be TRUE):
  1. Clicking "Execute" on a task opens a PTY session and the workbench left panel shows the live terminal output
  2. Claude CLI output appears with full ANSI formatting — no JSON parsing, no chat bubbles
  3. When Claude CLI exits successfully, the task status automatically transitions to IN_REVIEW; on failure the status stays unchanged
**Plans**: TBD
**UI hint**: yes

### Phase 27: Task Card Context Menu
**Goal**: Users can right-click any task card on the Kanban board to change status, launch execution, or navigate to the workbench
**Depends on**: Phase 23 (workbench page exists), Phase 26 (execution integrated)
**Requirements**: TASK-01, TASK-02, TASK-03
**Success Criteria** (what must be TRUE):
  1. Right-clicking a task card opens a context menu with options: change status, launch task, go to detail page
  2. "Launch task" in the context menu starts Claude CLI execution; the option is greyed out for tasks that have already been executed
  3. "Go to detail page" in the context menu navigates to `/workspaces/[id]/tasks/[taskId]`
**Plans**: TBD
**UI hint**: yes

### Phase 28: v0.6 Bug Fixes
**Goal**: The Monaco editor loads reliably and the Diff tab works for all project types including NORMAL projects
**Depends on**: Phase 23 (v0.6 code exists to fix)
**Requirements**: FIX-01, FIX-02
**Success Criteria** (what must be TRUE):
  1. The Monaco editor initializes successfully on first load without requiring a page refresh
  2. The Changes tab displays a diff for NORMAL type projects (not just GIT type projects)
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
| 11. SystemConfig Foundation | v0.4 | 2/2 | Complete | 2026-03-30 |
| 12. Git Path Mapping Rules | v0.4 | 2/2 | Complete | 2026-03-30 |
| 13. Configurable System Parameters | v0.4 | 2/2 | Complete | 2026-03-30 |
| 14. Search Quality & Realtime Config | v0.4 | 2/2 | Complete | 2026-03-30 |
| 15. Schema & Cleanup | v0.5 | 2/2 | Complete | 2026-03-31 |
| 16. Worktree Execution Engine | v0.5 | 1/2 | Complete | 2026-03-31 |
| 17. Review & Merge Workflow | v0.5 | 4/4 | Complete | 2026-03-31 |
| 18. Worktree Lifecycle | v0.5 | 2/2 | Complete | 2026-03-31 |
| 19. Workbench Entry & Layout | v0.6 | 2/2 | Complete | 2026-03-31 |
| 20. File Tree Browser | v0.6 | 3/3 | Complete | 2026-04-01 |
| 21. Code Editor | v0.6 | 3/3 | Complete | 2026-04-01 |
| 22. Diff View Integration | v0.6 | 0/TBD | Complete | 2026-04-01 |
| 23. Preview Panel | v0.6 | 3/3 | Complete | 2026-04-01 |
| 24. PTY Backend & WebSocket Server | v0.7 | 2/2 | Complete    | 2026-04-02 |
| 25. xterm.js Terminal Component | v0.7 | 0/TBD | Not started | - |
| 26. Workbench Integration | v0.7 | 0/TBD | Not started | - |
| 27. Task Card Context Menu | v0.7 | 0/TBD | Not started | - |
| 28. v0.6 Bug Fixes | v0.7 | 0/TBD | Not started | - |
