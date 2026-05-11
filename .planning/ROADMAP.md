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
- ✅ **v1.0 首次使用引导 & 任务完成通知** — Phases 65-68 (shipped 2026-04-23)
- ✅ **v1.1 Detail Page Reliability & Discovery** — Phases 69-70 (shipped 2026-05-08)
- ✅ **v1.2 Extensions & Slim Distribution** — Phases 71-73 (shipped 2026-05-09)
- ✅ **v1.3 Detail Page VSCode-like Git UX & Reliability** — 5 phases / 13 tasks (shipped 2026-05-11)

## Phases

<details>
<summary>✅ v1.3 Detail Page VSCode-like Git UX & Reliability (5 phases, 13 tasks) — SHIPPED 2026-05-11</summary>

Single-plan milestone via superpowers writing-plans + subagent-driven-development. ~60 new tests added. Plan: [docs/superpowers/plans/2026-05-11-detail-page-vscode-git.md](../docs/superpowers/plans/2026-05-11-detail-page-vscode-git.md).

- [x] **Phase 1: Critical Bug Fixes** — first-tab Monaco highlight race (P1-T1), Windows DiffEditor CRLF (P1-T2), large-diff page crash via 500-line truncation (P1-T3)
- [x] **Phase 2: Virtualized Diff Viewer** — `@git-diff-view/react` + `parse-diff` (P2-T4), `DiffView` component with per-hunk callbacks (P2-T5), `TaskDiffView` body swap (P2-T6)
- [x] **Phase 3: Hunk-level Stage / Discard** — server `diff-file` / `stage-hunk` / `discard-hunk` POST actions backed by `git apply --cached` and `git apply -R` (P3-T7), hunk menu in `EditorGitPanel` opens dialog with per-hunk Stage / Discard buttons (P3-T9)
- [x] **Phase 4: Monaco Gutter Decorations** — `monaco-gutter.ts` library with WeakMap-tracked idempotent `applyGutterDecorations` (P4-T10), wired into `CodeEditor` via 300ms-debounced effect keyed on `gutterTick` save signal (P4-T11)
- [x] **Phase 5: File History + Blame** — `log-file` POST + `FileHistoryPanel` dialog opened via Clock toolbar button (P5-T12), `blame` POST with porcelain parser + `BlameList` dialog opened via User toolbar button (P5-T13)

</details>

<details>
<summary>✅ v1.2 Extensions & Slim Distribution (Phases 71-73) — SHIPPED 2026-05-09</summary>

- [x] Phase 71: Extension Detection & Wiring (12 tasks) — completed 2026-05-09
- [x] Phase 72: Extensions Settings Tab (7 tasks) — completed 2026-05-09
- [x] Phase 73: Onboarding Integration (6 tasks) — completed 2026-05-09

See: [milestones/v1.2-ROADMAP.md](./milestones/v1.2-ROADMAP.md) for full details.

</details>

<details>
<summary>✅ v1.1 Detail Page Reliability & Discovery (Phases 69-70) — SHIPPED 2026-05-08</summary>

- [x] Phase 69: Detail Page Reliability (4/4 plans) — completed 2026-05-08
- [x] Phase 70: Task Discovery & Image Preview (3/3 plans) — completed 2026-05-08

See: [milestones/v1.1-ROADMAP.md](./milestones/v1.1-ROADMAP.md) for full details.

</details>

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

<details>
<summary>✅ v1.0 首次使用引导 & 任务完成通知 (Phases 65-68) — SHIPPED 2026-04-23</summary>

- [x] Phase 65: Onboarding Data Layer (2/2 plans) — completed 2026-04-23
- [x] Phase 66: Notification Infrastructure (3/3 plans) — completed 2026-04-23
- [x] Phase 67: Onboarding Wizard UI (2/2 plans) — completed 2026-04-23
- [x] Phase 68: Username Display & AI Context (1/1 plan) — completed 2026-04-23

See: [milestones/v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md) for full details.

</details>
