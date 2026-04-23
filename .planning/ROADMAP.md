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
- ✅ **v0.97 Workflow Enhancement & Developer Experience** — Phases 61-64 (shipped 2026-04-21)
- 🚧 **v1.0 首次使用引导 & 任务完成通知** — Phases 65-68 (in progress)

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

<details>
<summary>✅ v0.97 Workflow Enhancement & Developer Experience (Phases 61-64) — SHIPPED 2026-04-21</summary>

- [x] **Phase 61: Form UX & UI Polish** - Project path mode separation, textarea overflow fix, ~ path validation, assistant icon relocation (completed 2026-04-21)
- [x] **Phase 62: Project Analysis** - "生成描述" button invokes Claude CLI to analyze localPath and auto-fill project description (completed 2026-04-21)
- [x] **Phase 63: Mission Terminal Open** - "在终端打开" button on Mission card opens system terminal at project.localPath (completed 2026-04-21)
- [x] **Phase 64: Code Search** - Ripgrep-powered search tab in detail page left panel with Monaco editor integration (completed 2026-04-21)

</details>

---

## v1.0 首次使用引导 & 任务完成通知 (Phases 65-68)

**Milestone Goal:** 为新用户提供首次使用引导流程，并在 AI 任务完成时通过多种渠道通知用户。

### Summary Checklist

- [x] **Phase 65: Onboarding Data Layer** - SystemConfig onboarding keys + PTY onExit notification hook (completed 2026-04-23)
- [x] **Phase 66: Notification Infrastructure** - Browser Notification API wrapper + Toast fallback + Settings toggle + click-to-navigate (completed 2026-04-23)
- [x] **Phase 67: Onboarding Wizard UI** - Mandatory Dialog stepper (username + CLI test) + post-wizard redirect (completed 2026-04-23)
- [x] **Phase 68: Username Display & AI Context** - TopBar username chip + AI assistant context injection (completed 2026-04-23)

### Phase Details

#### Phase 65: Onboarding Data Layer
**Goal**: The system can detect first-run state, persist wizard progress across page reloads, and fire a task completion notification at the moment a PTY session exits
**Depends on**: Nothing (pure data layer, no UI)
**Requirements**: ONBD-01, ONBD-02, ONBD-08
**Success Criteria** (what must be TRUE):
  1. A fresh database (no SystemConfig rows) causes the app to recognize first-run state and expose it to the UI layer via a server-side prop
  2. After a wizard step completes, refreshing the page and re-checking onboarding status returns the last completed step number rather than step 1
  3. When a PTY session exits, the system records the task completion event and prepares the notification payload (taskId, taskTitle, status) for delivery to the browser — verifiable by inspecting the dispatch call in agent-actions.ts onExit
**Plans:** 2/2 plans complete
Plans:
- [x] 65-01-PLAN.md — Onboarding server actions (TDD: getOnboardingStatus, setOnboardingProgress, completeOnboarding, dispatchTaskCompletionEvent)
- [x] 65-02-PLAN.md — PTY onExit dispatch + layout isFirstRun prop

#### Phase 66: Notification Infrastructure
**Goal**: Users receive a desktop notification when a task finishes executing, and can control this behavior from Settings
**Depends on**: Phase 65
**Requirements**: NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04, NOTIF-05
**Success Criteria** (what must be TRUE):
  1. On first page load the browser shows a permission prompt for notifications; on subsequent loads with permission already granted, no prompt appears
  2. When a running task's PTY session exits, a desktop notification appears with the task title as the notification body — visible even when the Tower tab is in the background
  3. When notification permission is denied or the browser does not support the API, a Sonner Toast appears at the bottom of the screen instead, showing the same task title
  4. Clicking the desktop notification brings the Tower tab to focus and navigates to that task's detail page
  5. A toggle in Settings allows the user to disable all task completion notifications; when disabled, neither desktop notifications nor the Toast fallback fire
**Plans:** 3/3 plans complete
Plans:
- [x] 66-01-PLAN.md — Server-side event queue + API route + workspaceId payload extension
- [x] 66-02-PLAN.md — Settings notification toggle + i18n keys
- [x] 66-03-PLAN.md — Client notification listener + permission banner + layout wiring

#### Phase 67: Onboarding Wizard UI
**Goal**: A new user cannot access any part of the app until they have completed the two-step onboarding wizard, after which they land on the Kanban board with a prompt to create their first workspace
**Depends on**: Phase 65
**Requirements**: ONBD-03, ONBD-06, ONBD-07, ONBD-09
**Success Criteria** (what must be TRUE):
  1. On first launch a full-screen Dialog overlay appears and all underlying UI is inert (not clickable); there is no close button or skip mechanism
  2. Step 1 shows a username input field; submitting a non-empty username saves it to SystemConfig and advances to Step 2
  3. Step 2 embeds the existing CliAdapterTester component; the "Next" or "Complete" button is disabled until at least one CLI check passes
  4. If the CLI test fails entirely, an inline error message explains that a working Claude CLI is required and the button remains disabled — the user cannot complete the wizard without a working CLI
  5. After the wizard completes the overlay dismisses and the app navigates to the Kanban board where a highlighted empty-state CTA prompts creating the first workspace or project
**Plans:** 2/2 plans complete
Plans:
- [x] 67-01-PLAN.md — Onboarding wizard components (CLIAdapterTester onResult + wizard shell + steps + i18n)
- [x] 67-02-PLAN.md — Layout wiring + workspaces CTA
**UI hint**: yes

#### Phase 68: Username Display & AI Context
**Goal**: The username collected during onboarding is visible in the app header and known to the AI assistant so it can address the user by name
**Depends on**: Phase 67
**Requirements**: ONBD-04, ONBD-05
**Success Criteria** (what must be TRUE):
  1. After onboarding completes, the TopBar right section shows the configured username as a text chip or avatar label on every page of the app
  2. When the AI assistant responds in a chat session, it addresses the user by their configured username — verifiable by sending "what is my name?" and receiving a response containing the username
**Plans:** 1/1 plans complete
Plans:
- [x] 68-01-PLAN.md — TopBar username chip + AI assistant context injection
**UI hint**: yes

### Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 65. Onboarding Data Layer | 2/2 | Complete    | 2026-04-23 |
| 66. Notification Infrastructure | 3/3 | Complete    | 2026-04-23 |
| 67. Onboarding Wizard UI | 2/2 | Complete    | 2026-04-23 |
| 68. Username Display & AI Context | 1/1 | Complete   | 2026-04-23 |
