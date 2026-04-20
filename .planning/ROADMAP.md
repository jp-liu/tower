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
- **v0.96 UX Polish & Knowledge Capture** — Phases 55-60 (in progress)

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


---

## v0.96 UX Polish & Knowledge Capture (Phases 55-60)

### Summary Checklist

- [x] **Phase 55: UI Fixes** - Delete task stops propagation, shared EmptyState component, icon button hover consistency (completed 2026-04-20)
- [x] **Phase 56: Asset Preview** - Image lightbox, text/md preview dialog, reveal in Finder, reorganized action buttons (completed 2026-04-20)
- [ ] **Phase 57: Project Import & Migration** - Separate create vs import flows, optional fs.rename migration with pre-checks
- [ ] **Phase 58: Session Dreaming** - Deep AI analysis on session end, auto-create insight notes, timeline UI, daily summary integration
- [ ] **Phase 59: Auto-Upload Hook** - PostToolUse hook script, file type config, upload API, env var rename, settings install button
- [ ] **Phase 60: Resource Attribution & Task Drawer** - Show task-bound assets in project view, TaskOverviewDrawer shared component

### Phase Details

#### Phase 55: UI Fixes
**Goal**: Users interact with the Kanban board and chat UI without friction from inconsistent interaction patterns
**Depends on**: Nothing (self-contained UI fixes)
**Requirements**: UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. Clicking the delete button on a task card deletes the task without opening the detail drawer
  2. Empty states across asset list and assistant chat use the same visual component and copy pattern
  3. All clickable icon buttons show a background highlight on hover with consistent transition (no bare text highlight)
**Plans**: 1 plan
Plans:
- [x] 55-01-PLAN.md — Fix delete propagation, shared EmptyState, icon button hover
**UI hint**: yes

#### Phase 56: Asset Preview
**Goal**: Users can inspect any asset directly in the browser without downloading it first
**Depends on**: Phase 55
**Requirements**: ASSET-01, ASSET-02, ASSET-03, ASSET-04
**Success Criteria** (what must be TRUE):
  1. Clicking an image asset opens a fullscreen lightbox with zoom/pan controls; Escape closes it
  2. Clicking a .txt, .md, or .json asset opens a preview dialog — .md renders as Markdown, others as monospace text
  3. The "在文件夹中显示" button opens the system file manager with the file highlighted
  4. Each asset row shows exactly three action buttons in order: Preview, Reveal in Finder, Delete
**Plans**: 2 plans
Plans:
- [x] 56-01-PLAN.md — Image lightbox, text preview dialog, reveal API, i18n keys
- [x] 56-02-PLAN.md — Wire preview components into asset list UI
**UI hint**: yes

#### Phase 57: Project Import & Migration
**Goal**: Users can onboard projects cleanly — creating from git URL or importing an existing folder — with an optional atomic migration to a canonical path
**Depends on**: Phase 55
**Requirements**: PROJ-01, PROJ-02, PROJ-03, PROJ-04, PROJ-05, PROJ-06
**Success Criteria** (what must be TRUE):
  1. "新建项目" accepts a git URL, auto-resolves the local path via git rules, and clones if the path does not exist
  2. "导入项目" lets the user browse to an existing folder, auto-detects git remote, and auto-fills project name
  3. When the migration toggle is on, the target path is derived from git URL rules and is editable before confirming
  4. Confirmation is blocked (with a clear error message) if there are running executions, active PTY sessions, or existing worktrees
  5. A successful migration atomically moves the project directory and updates `localPath` in the database; the source path is gone and the target contains the `.git` directory
  6. A failed migration leaves the source directory intact and displays the specific error to the user
**Plans**: 2 plans
Plans:
- [x] 57-01-PLAN.md — Split create/import dialogs with auto-fill logic
- [ ] 57-02-PLAN.md — Migration toggle with pre-checks and atomic rename
**UI hint**: yes

#### Phase 58: Session Dreaming
**Goal**: When a task session ends, the system automatically extracts and persists reusable insights as project notes, visible in the execution timeline and daily reports
**Depends on**: Phase 57
**Requirements**: DREAM-01, DREAM-02, DREAM-03, DREAM-04
**Success Criteria** (what must be TRUE):
  1. After a task execution ends, a second AI analysis runs in the background and produces structured JSON with summary, typed insights, and a shouldCreateNote decision
  2. When shouldCreateNote is true, a ProjectNote with category "session-insight" is created and linked to the execution via insightNoteId
  3. The execution timeline card shows a "归纳" row with the note title when an insight note exists; clicking it expands the note content inline with a link to the full notes tab
  4. The daily_summary MCP report includes an "insights" array listing all session-insight notes created that day with workspace/project/task context
**Plans**: TBD

#### Phase 59: Auto-Upload Hook
**Goal**: Files produced by Claude Code during task execution are automatically captured as task assets without any manual action from the user
**Depends on**: Phase 57
**Requirements**: HOOK-01, HOOK-02, HOOK-03, HOOK-04, HOOK-05, HOOK-06
**Success Criteria** (what must be TRUE):
  1. When running outside a Tower session (no TOWER_TASK_ID), the hook exits immediately with no side effects
  2. When Claude Code writes a file matching the configured type whitelist during a Tower session, the file appears in the task's asset list within seconds
  3. The allowed file types are configurable in Settings and stored in SystemConfig under hooks.autoUploadTypes
  4. The Settings page has an "安装 Hook" button that writes the PostToolUse hook entry into ~/.claude/settings.json; the button reflects installation state
  5. All code references to AI_MANAGER_TASK_ID are replaced with TOWER_TASK_ID; the PTY spawn environment injects TOWER_TASK_ID and TOWER_API_URL
**Plans**: TBD

#### Phase 60: Resource Attribution & Task Drawer
**Goal**: Users can see all assets associated with a project (including those created by task executions) and quickly preview any task from wherever its assets or completions are referenced
**Depends on**: Phase 56, Phase 58
**Requirements**: RES-01, RES-02, RES-03, RES-04, RES-05
**Success Criteria** (what must be TRUE):
  1. The project assets page shows all assets for the project regardless of whether they are task-bound or project-level
  2. Task-bound assets display a "[任务: <title>]" label (truncated to 20 characters) beside the asset name
  3. Clicking a task label badge in the asset list opens the TaskOverviewDrawer showing that task's title, status, priority, description, labels, last execution summary, resource count, and creation date
  4. Clicking a completed or archived task in the task list opens the TaskOverviewDrawer instead of navigating away
**Plans**: TBD
**UI hint**: yes

### Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 55. UI Fixes | 1/1 | Complete    | 2026-04-20 |
| 56. Asset Preview | 2/2 | Complete    | 2026-04-20 |
| 57. Project Import & Migration | 1/2 | In Progress|  |
| 58. Session Dreaming | 0/? | Not started | - |
| 59. Auto-Upload Hook | 0/? | Not started | - |
| 60. Resource Attribution & Task Drawer | 0/? | Not started | - |
