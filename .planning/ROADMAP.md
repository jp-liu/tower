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
- 🚧 **v0.92 Global Chat Assistant** — Phases 36-39 (in progress)

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

### v0.92 Global Chat Assistant (In Progress)

**Milestone Goal:** Add a global chat assistant accessible from any page, enabling users to manage tasks via natural language through Claude CLI with Tower MCP tools.

- [ ] **Phase 36: Assistant Backend** - PTY session for assistant (no taskId), system prompt injection, tool restrictions, WebSocket bridge
- [ ] **Phase 37: Terminal Mode UI** - Sidebar + dialog layouts with embedded xterm terminal, open/close lifecycle
- [ ] **Phase 38: Chat Mode** - Output stream parsing into structured messages, Markdown bubble rendering, input box
- [ ] **Phase 39: Polish & Settings** - Display mode switch in settings, keyboard shortcuts, i18n, responsive sizing

## Phase Details

### Phase 36: Assistant Backend
**Goal**: The system can spawn a dedicated Claude CLI PTY session for the global assistant with restricted tools and a predefined identity, independent of any task
**Depends on**: Phase 35.1 (existing PTY + WebSocket infrastructure)
**Requirements**: BE-01, BE-02, BE-03, BE-04, BE-05, BE-06, UX-01
**Success Criteria** (what must be TRUE):
  1. Opening the assistant spawns a new Claude CLI process with cwd set to the Tower project directory, not tied to any taskId
  2. The spawned process includes `--append-system-prompt` with a prompt defining the assistant as a Tower operator that can create/query/move tasks
  3. The spawned process includes `--allowedTools "mcp__tower__*"` so it can only call Tower MCP tools (no Read/Edit/Bash)
  4. The assistant PTY session connects to the browser via WebSocket and streams output in real time
  5. Closing the assistant destroys the PTY session completely; reopening starts a fresh session with no prior context
**Plans:** 1/2 plans executed

Plans:
- [x] 36-01-PLAN.md — Server actions + config defaults (startAssistantSession, stopAssistantSession, config keys)
- [ ] 36-02-PLAN.md — WS keepalive bypass + internal API route (/api/internal/assistant)

### Phase 37: Terminal Mode UI
**Goal**: Users can open a global assistant panel from any page and interact with Claude CLI via an embedded xterm terminal
**Depends on**: Phase 36
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-06, TM-01, TM-02, TM-03, UX-02
**Success Criteria** (what must be TRUE):
  1. An assistant icon appears in the top bar next to the search box; clicking it or pressing Cmd+L (Ctrl+L) opens the assistant panel
  2. The assistant panel can render as a left sidebar (push layout, does not block main content) or as a centered dialog modal
  3. The panel contains a title bar and an embedded xterm.js terminal where Claude CLI output streams with full ANSI formatting
  4. User can type directly in the terminal to interact with the assistant (no separate input box needed in terminal mode)
  5. Pressing Escape, clicking the close button, or pressing Cmd+L again closes the panel and destroys the session
**Plans:** 2 plans

Plans:
- [ ] 36-01-PLAN.md — Server actions + config defaults (startAssistantSession, stopAssistantSession, config keys)
- [ ] 36-02-PLAN.md — WS keepalive bypass + internal API route (/api/internal/assistant)
**UI hint**: yes

### Phase 38: Chat Mode
**Goal**: Users can interact with the assistant via a chat bubble interface with Markdown-rendered responses instead of raw terminal output
**Depends on**: Phase 37 (panel shell and session lifecycle already working)
**Requirements**: CM-01, CM-02, CM-03, CM-04
**Success Criteria** (what must be TRUE):
  1. The system parses the Claude CLI output stream into structured segments: user messages, assistant responses, thinking indicators, and tool-call blocks
  2. Assistant responses render as Markdown bubbles with proper tables, lists, code blocks, and inline formatting
  3. User can type in a text input box at the bottom and send via Enter (Shift+Enter for newline); the input is forwarded to the PTY
  4. While the assistant is processing, a thinking/loading indicator is visible; it disappears when the response completes
**Plans:** 2 plans

Plans:
- [ ] 36-01-PLAN.md — Server actions + config defaults (startAssistantSession, stopAssistantSession, config keys)
- [ ] 36-02-PLAN.md — WS keepalive bypass + internal API route (/api/internal/assistant)
**UI hint**: yes

### Phase 39: Polish & Settings
**Goal**: The assistant experience is configurable, fully bilingual, and works well at all viewport sizes
**Depends on**: Phase 38
**Requirements**: UI-05, UI-07, UX-03
**Success Criteria** (what must be TRUE):
  1. Users can switch between terminal mode and chat mode via a setting in Settings > General (persisted in SystemConfig)
  2. All assistant UI text (title bar, placeholders, tooltips, settings labels) is available in both Chinese and English
  3. Both sidebar and dialog modes render correctly on viewports from 1024px to 2560px wide without overflow or truncation
**Plans:** 2 plans

Plans:
- [ ] 36-01-PLAN.md — Server actions + config defaults (startAssistantSession, stopAssistantSession, config keys)
- [ ] 36-02-PLAN.md — WS keepalive bypass + internal API route (/api/internal/assistant)
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 36 -> 37 -> 38 -> 39

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
| 29. Adapter Dead Code Removal | v0.9 | 2/2 | Complete | 2026-04-10 |
| 30. Schema Foundation | v0.9 | 1/1 | Complete | 2026-04-11 |
| 31. PTY Primitives & Env Injection | v0.9 | 2/2 | Complete | 2026-04-11 |
| 32. Agent Actions & Feishu Wiring | v0.9 | 1/1 | Complete | 2026-04-11 |
| 33. Internal HTTP Bridge | v0.9 | 1/1 | Complete | 2026-04-11 |
| 34. MCP Terminal Tools | v0.9 | 1/1 | Complete | 2026-04-11 |
| 35. Settings UI for CLI Profile | v0.9 | 1/1 | Complete | 2026-04-11 |
| 35.1. Mission Control Dashboard | v0.9 | 3/3 | Complete | 2026-04-13 |
| 36. Assistant Backend | v0.92 | 1/2 | In Progress|  |
| 37. Terminal Mode UI | v0.92 | 0/TBD | Not started | - |
| 38. Chat Mode | v0.92 | 0/TBD | Not started | - |
| 39. Polish & Settings | v0.92 | 0/TBD | Not started | - |
