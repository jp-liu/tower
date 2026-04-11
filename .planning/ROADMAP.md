# Roadmap: ai-manager

## Milestones

- ✅ **v0.1 Settings** — Phases 1-3 (shipped 2026-03-27)
- ✅ **v0.2 项目知识库 & 智能 MCP** — Phases 4-7 (shipped 2026-03-30)
- ✅ **v0.3 全局搜索增强** — Phases 8-10 (shipped 2026-03-30)
- ✅ **v0.4 系统配置化** — Phases 11-14 (shipped 2026-03-30)
- ✅ **v0.5 Git Worktree 任务隔离** — Phases 15-18 (shipped 2026-03-31)
- ✅ **v0.6 任务开发工作台** — Phases 19-23 (shipped 2026-04-01)
- ✅ **v0.7 终端交互体验** — Phases 24-28 (shipped 2026-04-10)
- 🚧 **v0.9 架构清理 + 外部调度闭环** — Phases 29-35 (in progress)

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

<details>
<summary>✅ v0.7 终端交互体验 (Phases 24-28) — SHIPPED 2026-04-10</summary>

- [x] **Phase 24: PTY Backend & WebSocket Server** - node-pty 会话注册表 + 独立 WebSocket server (port 3001) 双向通信 + 安全防护 (completed 2026-04-02)
- [x] **Phase 25: xterm.js Terminal Component** - 浏览器终端组件（ANSI 渲染、键盘输入、resize 同步、主题跟随） (completed 2026-04-02)
- [x] **Phase 26: Workbench Integration** - 工作台左侧面板替换 SSE 聊天气泡为终端组件 + 执行生命周期对接 (completed 2026-04-03)
- [x] **Phase 27: Task Card Context Menu** - Kanban 卡片右键菜单（更改状态、启动任务、前往详情页） (completed 2026-04-03)
- [x] **Phase 28: v0.6 Bug Fixes** - Monaco 加载稳定性修复 + Diff 显示条件修复 (completed 2026-04-10)

See: [milestones/v0.7-ROADMAP.md](./milestones/v0.7-ROADMAP.md) for full details.

</details>

### v0.9 架构清理 + 外部调度闭环 (In Progress)

**Milestone Goal:** 清理废弃 adapter 架构，建立 CLI Profile 配置表，实现龙虾（Paperclip/OpenClaw）外部调度的完整闭环（派活 → 查进度 → 追加指令 → 完成通知）。

- [x] **Phase 29: Adapter Dead Code Removal** - 删除废弃 SSE/adapter 文件，迁移有用模块到 lib/ 目录，修复路由引用，通过 tsc 检查 (completed 2026-04-10)
- [x] **Phase 30: Schema Foundation** - CliProfile 数据模型 + TaskExecution.callbackUrl 字段 + Prisma 迁移 + 默认行种子 (completed 2026-04-11)
- [x] **Phase 31: PTY Primitives & Env Injection** - startPtyExecution/resumePtyExecution 读 CliProfile 构建参数 + envOverrides 传参 + idle 检测 (completed 2026-04-11)
- [ ] **Phase 32: Agent Actions & Feishu Wiring** - notify-agi.sh 更新（任务 ID 检查 + 结构化模板）+ Stop hook 挂接 + callbackUrl 注入
- [ ] **Phase 33: Internal HTTP Bridge** - /api/internal/terminal/[taskId]/buffer 和 /input 路由，供 MCP 进程跨进程读写 PTY
- [ ] **Phase 34: MCP Terminal Tools** - get_task_terminal_output + send_task_terminal_input + get_task_execution_status 三个 MCP 工具
- [ ] **Phase 35: Settings UI for CLI Profile** - Settings 页面 CLI Profile 查看/编辑卡片

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
- [x] 25-01-PLAN.md — Install xterm addons + i18n keys (TERM-01, TERM-02, TERM-03, TERM-04)
- [x] 25-02-PLAN.md — TaskTerminal component (TERM-01, TERM-02, TERM-03, TERM-04)
**UI hint**: yes

### Phase 26: Workbench Integration
**Goal**: Users can start task execution and see Claude CLI running live in the workbench terminal, with task status updating when done
**Depends on**: Phase 25
**Requirements**: INT-01, INT-02, INT-03
**Success Criteria** (what must be TRUE):
  1. Clicking "Execute" on a task opens a PTY session and the workbench left panel shows the live terminal output
  2. Claude CLI output appears with full ANSI formatting — no JSON parsing, no chat bubbles
  3. When Claude CLI exits successfully, the task status automatically transitions to IN_REVIEW; on failure the status stays unchanged
**Plans**: 2 plans
Plans:
- [x] 26-01-PLAN.md — Server action startPtyExecution + PtySession.setDataListener + ws-server onExit DB update (INT-01, INT-02, INT-03)
- [x] 26-02-PLAN.md — Replace left panel chat UI with TaskTerminal + Execute button; wire onSessionEnd (INT-01, INT-02, INT-03)
**UI hint**: yes

### Phase 27: Task Card Context Menu
**Goal**: Users can right-click any task card on the Kanban board to change status, launch execution, or navigate to the workbench
**Depends on**: Phase 23 (workbench page exists), Phase 26 (execution integrated)
**Requirements**: TASK-01, TASK-02, TASK-03
**Success Criteria** (what must be TRUE):
  1. Right-clicking a task card opens a context menu with options: change status, launch task, go to detail page
  2. "Launch task" in the context menu starts Claude CLI execution; the option is greyed out for tasks that have already been executed
  3. "Go to detail page" in the context menu navigates to `/workspaces/[id]/tasks/[taskId]`
**Plans**: 2 plans
Plans:
- [x] 27-01-PLAN.md — TaskCardContextMenu component + i18n keys (TASK-01, TASK-02, TASK-03)
- [x] 27-02-PLAN.md — Wire context menu into board stack + execution disable guard (TASK-01, TASK-02, TASK-03)
**UI hint**: yes

### Phase 28: v0.6 Bug Fixes
**Goal**: The Monaco editor loads reliably and the Diff tab works for all project types including NORMAL projects
**Depends on**: Phase 23 (v0.6 code exists to fix)
**Requirements**: FIX-01, FIX-02
**Success Criteria** (what must be TRUE):
  1. The Monaco editor initializes successfully on first load without requiring a page refresh
  2. The Changes tab displays a diff for NORMAL type projects (not just GIT type projects)
**Plans**: TBD

### Phase 29: Adapter Dead Code Removal
**Goal**: The codebase contains no dead SSE/adapter execution files; all live modules are relocated to their correct paths and the build passes with zero new type errors
**Depends on**: Phase 28 (v0.8 shipped, clean starting point)
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04, CLEAN-05
**Success Criteria** (what must be TRUE):
  1. `src/lib/adapters/execute.ts`, `parse.ts`, `process-utils.ts`, `registry.ts`, and `types.ts` no longer exist in the repository
  2. The Settings > AI Tools verify button still works — CLI verification now comes from `src/lib/cli-test.ts` via the updated `/api/adapters/test` route
  3. Preview process management now lives at `src/lib/preview-process.ts` with no broken imports in existing consumers
  4. The deprecated `/api/tasks/[taskId]/execute` route no longer exists and hitting it returns 404
  5. `tsc --noEmit` exits with code 0 (no new type errors introduced by the reorganization)
**Plans**: 2 plans
Plans:
- [x] 29-01-PLAN.md — Relocate cli-test.ts + preview-process.ts, update consumer imports (CLEAN-02, CLEAN-03)
- [x] 29-02-PLAN.md — Delete adapters/ directory + deprecated execute route, verify tsc (CLEAN-01, CLEAN-04, CLEAN-05)

### Phase 30: Schema Foundation
**Goal**: The database has a `CliProfile` table with a seeded default row and `TaskExecution` has a `callbackUrl` field; the Prisma client is regenerated and ready for application code
**Depends on**: Phase 29 (clean codebase before schema changes)
**Requirements**: DATA-01, DATA-02, CLIP-01
**Success Criteria** (what must be TRUE):
  1. `prisma studio` shows a `CliProfile` table with at least one row: `command: "claude"`, `baseArgs: ["--dangerously-skip-permissions"]`
  2. `TaskExecution` rows have an optional `callbackUrl` column visible in prisma studio
  3. `prisma db push` (or `prisma migrate deploy`) runs without errors on a fresh database
  4. TypeScript code can import `CliProfile` and `TaskExecution.callbackUrl` from `@prisma/client` without type errors
**Plans**: 1 plan
Plans:
- [x] 30-01-PLAN.md — CliProfile model + TaskExecution.callbackUrl + seed default row (DATA-01, DATA-02, CLIP-01)

### Phase 31: PTY Primitives & Env Injection
**Goal**: PTY sessions accept per-session environment overrides and detect idle state; `startPtyExecution` and `resumePtyExecution` read from `CliProfile` instead of hardcoded strings
**Depends on**: Phase 30 (CliProfile schema exists)
**Requirements**: CLIP-02, CLIP-03, NTFY-01, NTFY-02, NTFY-06, NTFY-07
**Success Criteria** (what must be TRUE):
  1. Starting a task execution reads `command` and `baseArgs` from the `CliProfile` default row — changing the DB row changes what CLI is spawned without any code change
  2. A `callbackUrl` passed to `startPtyExecution` appears as `CALLBACK_URL` in the spawned process's environment (verified via `env` command in terminal)
  3. `AI_MANAGER_TASK_ID` is injected into every PTY session environment automatically
  4. After 180 seconds of zero PTY output, the configured `onIdle` callback fires
  5. User typing in the terminal (via WebSocket) resets the idle timer; the callback does not fire if the user is actively interacting
**Plans**: 2 plans
Plans:
- [x] 31-01-PLAN.md — PtySession envOverrides support + idle detection timer (NTFY-01, NTFY-06, NTFY-07)
- [x] 31-02-PLAN.md — startPtyExecution/resumePtyExecution read CliProfile + inject env vars (CLIP-02, CLIP-03, NTFY-02)

### Phase 32: Agent Actions & Feishu Wiring
**Goal**: Claude completions trigger a Feishu notification with structured task metadata; the notification only fires for ai-manager-dispatched sessions, not manual Claude runs
**Depends on**: Phase 31 (PTY primitives + env injection in place)
**Requirements**: NTFY-03, NTFY-04, NTFY-05
**Success Criteria** (what must be TRUE):
  1. When a task execution completes (Claude exits 0), a Feishu message arrives containing: task title, final status, elapsed time, and a brief summary
  2. Running Claude manually (outside ai-manager) does not produce a Feishu notification — the `AI_MANAGER_TASK_ID` environment variable controls the gate
  3. The `~/.claude/settings.json` Stop hook entry points to `notify-agi.sh` and is present after setup
  4. A failed execution (exit code non-zero) sends a Feishu notification tagged as failed, not completed
**Plans**: TBD

### Phase 33: Internal HTTP Bridge
**Goal**: The Next.js server exposes two localhost-only HTTP routes that allow any process (including the MCP stdio process) to read PTY buffer contents and send input to a running PTY session
**Depends on**: Phase 31 (PTY sessions have buffer and write APIs)
**Requirements**: TERM-01, TERM-02
**Success Criteria** (what must be TRUE):
  1. `curl http://localhost:3000/api/internal/terminal/{taskId}/buffer` returns the last N lines of PTY output as JSON for a running session
  2. `curl -X POST http://localhost:3000/api/internal/terminal/{taskId}/input -d '{"text":"y\n"}'` sends the text to the running PTY and it appears in the terminal
  3. Both routes return 404 when no active PTY session exists for the given taskId
  4. Both routes reject requests from non-localhost origins (loopback-only guard enforced)
**Plans**: TBD

### Phase 34: MCP Terminal Tools
**Goal**: External orchestrators (Paperclip/OpenClaw) can poll PTY terminal output and inject input into running task sessions via MCP tools
**Depends on**: Phase 33 (HTTP bridge routes exist and are tested)
**Requirements**: TERM-03, TERM-04, TERM-05
**Success Criteria** (what must be TRUE):
  1. Calling `get_task_terminal_output` from an MCP client returns recent terminal output lines for a running task
  2. Calling `send_task_terminal_input` from an MCP client sends text to the running PTY — Claude receives and acts on it
  3. Calling `get_task_execution_status` returns whether the execution is running, idle, or exited, plus the last output snippet
  4. MCP tool count does not exceed 30 (currently 21 → target 24 after adding 3 new tools)
**Plans**: TBD

### Phase 35: Settings UI for CLI Profile
**Goal**: Users can view and edit the active CLI Profile directly in the Settings UI without touching the database
**Depends on**: Phase 30 (CliProfile schema), Phase 31 (server actions for profile CRUD)
**Requirements**: CLIP-04
**Success Criteria** (what must be TRUE):
  1. Settings page has a CLI Profile card showing the current command, base args, and any env vars
  2. User can edit the command and base args inline and save; the next task execution uses the updated values
  3. The CLI Profile card is bilingual (zh/en) and follows existing settings card visual patterns
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
| 19. Workbench Entry & Layout | v0.6 | 2/2 | Complete | 2026-03-31 |
| 20. File Tree Browser | v0.6 | 3/3 | Complete | 2026-04-01 |
| 21. Code Editor | v0.6 | 3/3 | Complete | 2026-04-01 |
| 22. Diff View Integration | v0.6 | 0/TBD | Complete | 2026-04-01 |
| 23. Preview Panel | v0.6 | 3/3 | Complete | 2026-04-01 |
| 24. PTY Backend & WebSocket Server | v0.7 | 2/2 | Complete | 2026-04-02 |
| 25. xterm.js Terminal Component | v0.7 | 2/2 | Complete | 2026-04-03 |
| 26. Workbench Integration | v0.7 | 2/2 | Complete | 2026-04-03 |
| 27. Task Card Context Menu | v0.7 | 2/2 | Complete | 2026-04-03 |
| 28. v0.6 Bug Fixes | v0.7 | 0/TBD | Complete | 2026-04-10 |
| 29. Adapter Dead Code Removal | v0.9 | 2/2 | Complete    | 2026-04-10 |
| 30. Schema Foundation | v0.9 | 1/1 | Complete    | 2026-04-11 |
| 31. PTY Primitives & Env Injection | v0.9 | 2/2 | Complete   | 2026-04-11 |
| 32. Agent Actions & Feishu Wiring | v0.9 | 0/TBD | Not started | - |
| 33. Internal HTTP Bridge | v0.9 | 0/TBD | Not started | - |
| 34. MCP Terminal Tools | v0.9 | 0/TBD | Not started | - |
| 35. Settings UI for CLI Profile | v0.9 | 0/TBD | Not started | - |
