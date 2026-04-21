# Roadmap: ai-manager

## Milestones

- ✅ **v0.1 Settings** — Phases 1-3 (shipped 2026-03-27)
- ✅ **v0.2 项目知识库 & 智能 MCP** — Phases 4-7 (shipped 2026-03-30)
- ✅ **v0.3 全局搜索增强** — Phases 8-10 (shipped 2026-03-30)
- ✅ **v0.4 系统配置化** — Phases 11-14 (shipped 2026-03-30)
- ✅ **v0.5 Git Worktree 任务隔离** — Phases 15-18 (shipped 2026-03-31)
- ✅ **v0.6 任务开发工作台** — Phases 19-23 (shipped 2026-04-01)
- ✅ **v0.7 终端交互体验** — Phases 24-28 (shipped 2026-04-10)
- ✅ **v0.9 架构清理 + 外部调度闭环** — Phases 29-35.1 (shipped 2026-04-13)
- ✅ **v0.92 Global Chat Assistant** — Phases 36-39 (shipped 2026-04-17)
- ✅ **v0.93 Chat Media Support** — Phases 40-43 (shipped 2026-04-18)
- ✅ **v0.94 Cache & File Management** — Phases 44-46 (shipped 2026-04-20)
- ✅ **v0.95 Pre-Release Hardening** — Phases 47-54 (shipped 2026-04-20)
- ✅ **v0.96 UX Polish & Knowledge Capture** — Phases 55-60 (shipped 2026-04-20)
- 🚧 **v0.97 Workflow Enhancement & Developer Experience** — Phases 61-64 (in progress)

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
- [x] **Phase 12: Git Path Mapping Rules** - Settings UI for adding/editing/deleting host+owner->localPath rules and auto-match on project creation (completed 2026-03-30)
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

<details>
<summary>✅ v0.7 终端交互体验 (Phases 24-28) — SHIPPED 2026-04-10</summary>

- [x] **Phase 24: PTY Backend & WebSocket Server** - node-pty 会话注册表 + 独立 WebSocket server (port 3001) 双向通信 + 安全防护 (completed 2026-04-02)
- [x] **Phase 25: xterm.js Terminal Component** - 浏览器终端组件（ANSI 渲染、键盘输入、resize 同步、主题跟随） (completed 2026-04-02)
- [x] **Phase 26: Workbench Integration** - 工作台左侧面板替换 SSE 聊天气泡为终端组件 + 执行生命周期对接 (completed 2026-04-03)
- [x] **Phase 27: Task Card Context Menu** - Kanban 卡片右键菜单（更改状态、启动任务、前往详情页） (completed 2026-04-03)
- [x] **Phase 28: v0.6 Bug Fixes** - Monaco 加载稳定性修复 + Diff 显示条件修复 (completed 2026-04-10)

See: [milestones/v0.7-ROADMAP.md](./milestones/v0.7-ROADMAP.md) for full details.

</details>

<details>
<summary>✅ v0.9 架构清理 + 外部调度闭环 (Phases 29-35.1) — SHIPPED 2026-04-13</summary>

- [x] **Phase 29: Adapter Dead Code Removal** - 删除废弃 SSE/adapter 文件，迁移有用模块到 lib/ 目录 (completed 2026-04-10)
- [x] **Phase 30: Schema Foundation** - CliProfile 数据模型 + TaskExecution.callbackUrl 字段 + seed (completed 2026-04-11)
- [x] **Phase 31: PTY Primitives & Env Injection** - CliProfile 驱动 PTY 参数 + envOverrides + idle 检测 (completed 2026-04-11)
- [x] **Phase 32: Agent Actions & Feishu Wiring** - notify-agi.sh 结构化模板 + Stop hook + 环境变量门控 (completed 2026-04-11)
- [x] **Phase 33: Internal HTTP Bridge** - /api/internal/terminal 路由供 MCP 跨进程读写 PTY (completed 2026-04-11)
- [x] **Phase 34: MCP Terminal Tools** - 3 个终端 MCP 工具 (completed 2026-04-11)
- [x] **Phase 35: Settings UI for CLI Profile** - CLI Profile 设置卡片 (completed 2026-04-11)
- [x] **Phase 35.1: Mission Control Dashboard** - 多任务监控面板 /missions (INSERTED) (completed 2026-04-13)

See phase details in [milestones/v0.9-ROADMAP.md](./milestones/v0.9-ROADMAP.md) for full details.

</details>

<details>
<summary>✅ v0.92 Global Chat Assistant (Phases 36-39) — SHIPPED 2026-04-17</summary>

- [x] **Phase 36: Assistant Backend** - PTY session for assistant (no taskId), system prompt injection, tool restrictions, WebSocket bridge (completed 2026-04-17)
- [x] **Phase 37: Terminal Mode UI** - Sidebar + dialog layouts with embedded xterm terminal, open/close lifecycle (completed 2026-04-17)
- [x] **Phase 38: Chat Mode** - Output stream parsing into structured messages, Markdown bubble rendering, input box (completed 2026-04-17)
- [x] **Phase 39: Polish & Settings** - Display mode switch in settings, keyboard shortcuts, i18n, responsive sizing (completed 2026-04-17)

</details>

<details>
<summary>✅ v0.93 Chat Media Support (Phases 40-43) — SHIPPED 2026-04-18</summary>

- [x] **Phase 40: Image Upload API** - Server-side cache endpoint, MIME validation, path traversal protection, and static serving for cached and asset images (completed 2026-04-18)
- [x] **Phase 41: Paste UX & Thumbnail Strip** - Paste intercept, immediate thumbnail preview, upload progress, per-image removal, multi-image accumulation (completed 2026-04-18)
- [x] **Phase 42: Message Image Display** - Sent message bubbles show images inline with broken-image fallback and session reload persistence (completed 2026-04-18)
- [x] **Phase 43: Claude SDK Multimodal Integration** - Images passed to Claude as absolute file paths in prompt with Read tool enabled (completed 2026-04-18)

</details>

<details>
<summary>✅ v0.94 Cache & File Management (Phases 44-46) — SHIPPED 2026-04-20</summary>

- [x] **Phase 44: Cache Storage Refactor** (2/2 plans) — completed 2026-04-20
- [x] **Phase 45: Route & Frontend Adaptation** (1/1 plan) — completed 2026-04-20
- [x] **Phase 46: Asset Name Restoration** (1/1 plan) — completed 2026-04-20

See: [milestones/v0.94-ROADMAP.md](./milestones/v0.94-ROADMAP.md) for full details.

</details>

<details>
<summary>✅ v0.95 Pre-Release Hardening (Phases 47-54) — SHIPPED 2026-04-20</summary>

- [x] **Phase 47: Failing Test Fixes** (2/2 plans) — completed 2026-04-20
- [x] **Phase 48: Security Hardening & Guard Tests** (1/1 plan) — completed 2026-04-20
- [x] **Phase 49: Server Actions Test Coverage** (3/3 plans) — completed 2026-04-20
- [x] **Phase 50: MCP Tools Test Coverage** (3/3 plans) — completed 2026-04-20
- [x] **Phase 51: Core Lib Test Coverage** (3/3 plans) — completed 2026-04-20
- [x] **Phase 52: Hooks & Logic Extraction** (2/2 plans) — completed 2026-04-20
- [x] **Phase 53: E2E Tests** (2/2 plans) — completed 2026-04-20
- [x] **Phase 54: Error Handling & Refactoring** (2/2 plans) — completed 2026-04-20

See: [milestones/v0.95-ROADMAP.md](./milestones/v0.95-ROADMAP.md) for full details.

</details>

<details>
<summary>✅ v0.96 UX Polish & Knowledge Capture (Phases 55-60) — SHIPPED 2026-04-20</summary>

- [x] **Phase 55: UI Fixes** - Delete task stops propagation, shared EmptyState component, icon button hover consistency (completed 2026-04-20)
- [x] **Phase 56: Asset Preview** - Image lightbox, text/md preview dialog, reveal in Finder, reorganized action buttons (completed 2026-04-20)
- [x] **Phase 57: Project Import & Migration** - Separate create vs import flows, optional fs.rename migration with pre-checks (completed 2026-04-20)
- [x] **Phase 58: Session Dreaming** - Deep AI analysis on session end, auto-create insight notes, timeline UI, daily summary integration (completed 2026-04-20)
- [x] **Phase 59: Auto-Upload Hook** - PostToolUse hook script, file type config, upload API, env var rename, settings install button (completed 2026-04-20)
- [x] **Phase 60: Resource Attribution & Task Drawer** - Show task-bound assets in project view, TaskOverviewDrawer shared component (completed 2026-04-20)

</details>

---

## v0.97 Workflow Enhancement & Developer Experience (Phases 61-64)

**Milestone Goal:** 优化项目管理工作流，增强 Mission Control，新增项目智能分析和全局代码搜索，减少对外部编辑器的依赖。

### Summary Checklist

- [x] **Phase 61: Form UX & UI Polish** - Project path mode separation, textarea overflow fix, ~ path validation, assistant icon relocation (completed 2026-04-21)
- [x] **Phase 62: Project Analysis** - "生成描述" button invokes Claude CLI to analyze localPath and auto-fill project description (completed 2026-04-21)
- [x] **Phase 63: Mission Terminal Open** - "在终端打开" button on Mission card opens system terminal at project.localPath (completed 2026-04-21)
- [ ] **Phase 64: Code Search** - Ripgrep-powered search tab in detail page left panel with Monaco editor integration

### Phase Details

#### Phase 61: Form UX & UI Polish
**Goal**: Users interact with project forms without confusion between path modes, and the assistant icon is discoverable in its new location next to the search box
**Depends on**: Nothing (self-contained UI fixes)
**Requirements**: FORM-01, FORM-02, FORM-03, FORM-04, FORM-05, UI-01
**Success Criteria** (what must be TRUE):
  1. The "新建项目" form presents a plain editable text input for localPath; the "导入项目" form presents a browse button and shows the selected path as read-only
  2. The "迁移" form shows an editable target path field
  3. All project description and task description textareas cap at a max-height and show a scrollbar when content exceeds it — the parent dialog does not grow beyond the viewport
  4. Submitting a clone directory path that starts with ~ shows a warning label and the backend returns a validation error
  5. The assistant chat icon appears to the right of the global search box in the header, not near the language toggle
**Plans**: 3 plans
Plans:
- [x] 61-01-PLAN.md — Remove browse button from create dialog, add tilde warning (FORM-01, FORM-05 frontend)
- [x] 61-02-PLAN.md — Textarea max-height for import/task dialogs, Bot icon tooltip (FORM-04, UI-01)
- [x] 61-03-PLAN.md — Backend tilde rejection, create dialog textarea, verify FORM-02/03 (FORM-02, FORM-03, FORM-05 backend)
**UI hint**: yes

#### Phase 62: Project Analysis
**Goal**: Users can generate a structured project description in one click by letting Claude CLI analyze the local directory, eliminating manual description writing
**Depends on**: Phase 61
**Requirements**: ANALYZE-01, ANALYZE-02, ANALYZE-03, ANALYZE-04
**Success Criteria** (what must be TRUE):
  1. A "生成描述" button is visible next to the clone button in the create form and below the localPath field in the import form
  2. When no localPath is selected, the button is visually disabled and shows a tooltip "请先选择路径" on hover
  3. Clicking the enabled button triggers a Claude CLI analysis of the selected directory (package.json, README, src/, monorepo detection) and shows a loading indicator during analysis
  4. After analysis completes, the project description textarea is auto-filled with structured Markdown covering tech stack, module breakdown, and MCP subPath guidance
**Plans**: 2 plans
Plans:
- [x] 62-01-PLAN.md — Server action + i18n keys (ANALYZE-01~04 foundation)
- [x] 62-02-PLAN.md — UI buttons in both project dialogs (ANALYZE-01~04)
**UI hint**: yes

#### Phase 63: Mission Terminal Open
**Goal**: Users can jump from a Mission Control card directly into a system terminal at the project directory without switching apps manually
**Depends on**: Phase 61
**Requirements**: MISSION-01
**Success Criteria** (what must be TRUE):
  1. Each Mission card (or its toolbar) shows an "在终端打开" button when the task's project has a non-empty localPath
  2. Clicking the button opens the configured system terminal application with its working directory set to the project's localPath
**Plans**: 1 plan
Plans:
- [x] 63-01-PLAN.md — Add terminal open button to mission card (MISSION-01)
**UI hint**: yes

#### Phase 64: Code Search
**Goal**: Users can search across all source files in a project from within the detail page using regex patterns, without leaving Tower or opening an external editor
**Depends on**: Phase 62
**Requirements**: SEARCH-01, SEARCH-02, SEARCH-03, SEARCH-04, SEARCH-05
**Success Criteria** (what must be TRUE):
  1. The detail page left panel has a "搜索" tab alongside the existing "文件树" tab; switching between them preserves the file tree state
  2. Typing in the search input runs a ripgrep search scoped to the project's localPath and displays results within one second for typical codebases
  3. The search input accepts regex patterns and an optional glob/file-type filter, both applied to the ripgrep command
  4. Each result row shows the file path, line number, and the matching line content with the keyword highlighted
  5. Clicking any result row opens the file in the Monaco editor and scrolls to the matched line number
**Plans**: TBD
**UI hint**: yes

### Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 61. Form UX & UI Polish | 3/3 | Complete    | 2026-04-21 |
| 62. Project Analysis | 2/2 | Complete    | 2026-04-21 |
| 63. Mission Terminal Open | 1/1 | Complete   | 2026-04-21 |
| 64. Code Search | 0/TBD | Not started | - |
