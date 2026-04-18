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
- 🚧 **v0.93 Chat Media Support** — Phases 40-43 (in progress)

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

### v0.93 Chat Media Support (In Progress)

**Milestone Goal:** 助手聊天输入框支持粘贴图片，存储到缓存目录，预览并作为上下文发送给 AI。

- [ ] **Phase 40: Image Upload API** - Server-side cache endpoint, MIME validation, path traversal protection, and static serving for cached and asset images
- [ ] **Phase 41: Paste UX & Thumbnail Strip** - Paste intercept, immediate thumbnail preview, upload progress, per-image removal, multi-image accumulation
- [ ] **Phase 42: Message Image Display** - User message bubbles show images, click to preview, broken-image placeholder, session reload restores references
- [ ] **Phase 43: Claude SDK Multimodal Integration** - Images passed to Claude as base64 content blocks via AsyncIterable SDKUserMessage path

## Phase Details

### Phase 40: Image Upload API
**Goal**: A secure server-side endpoint accepts image uploads from paste events, stores them in the assistant cache directory, and serves them via short paths
**Depends on**: Phase 39 (existing assistant infrastructure)
**Requirements**: CACHE-01, CACHE-02, CACHE-03, CACHE-04, CACHE-05
**Success Criteria** (what must be TRUE):
  1. POSTing a valid image file to `/api/internal/assistant/images` returns `{ filename, mimeType }` and the file is written to `data/cache/assistant/<uuid>.<ext>`
  2. Uploading a non-image file (e.g. PDF, SVG) is rejected with a 400 error; MIME type is verified via magic bytes, not browser metadata
  3. A crafted filename containing `../` traversal sequences is rejected; the uploaded file is always confined to the cache directory
  4. A cached image is accessible at `/cache/<filename>` and returns the correct image bytes
  5. A project asset is accessible at `/assets/<filename>` using the same unified static serving pattern
**Plans**: 2 plans
Plans:
- [ ] 40-01-PLAN.md — Magic-byte MIME utility + file-utils helpers + upload POST endpoint
- [ ] 40-02-PLAN.md — Static file serving GET routes for cache and assets
**UI hint**: no

### Phase 41: Paste UX & Thumbnail Strip
**Goal**: Users can paste one or more images into the chat input and see thumbnails with progress indicators before sending
**Depends on**: Phase 40
**Requirements**: PASTE-01, PASTE-02, PASTE-03, PASTE-04, PASTE-05, PASTE-06, PASTE-07
**Success Criteria** (what must be TRUE):
  1. Pasting an image (Ctrl+V / Cmd+V) in the chat textarea triggers an upload and displays a 48px thumbnail above the input box; text paste is unaffected
  2. Each thumbnail shows an upload progress bar with percentage until the upload completes
  3. User can click a thumbnail to open a fullscreen preview modal with zoom support
  4. User can click the X button on a thumbnail to remove that image before sending; the upload is abandoned and the blob URL is revoked
  5. Pasting multiple times accumulates images as separate thumbnails; all thumbnails clear automatically after send
  6. Paste behavior uses `clipboardData.items` (not `.files`) so it works correctly in Firefox
  7. The chat textarea defaults to 3 rows and grows to a maximum of 5 rows with a scrollbar beyond that
**Plans**: 2 plans
Plans:
- [ ] 40-01-PLAN.md — Magic-byte MIME utility + file-utils helpers + upload POST endpoint
- [ ] 40-02-PLAN.md — Static file serving GET routes for cache and assets
**UI hint**: yes

### Phase 42: Message Image Display
**Goal**: Sent messages containing images render the images inline in the chat bubble, with graceful handling of missing images and session reload
**Depends on**: Phase 41
**Requirements**: MSG-01, MSG-02, MSG-03, MSG-04
**Success Criteria** (what must be TRUE):
  1. After sending, the user message bubble shows all attached images at the top in fixed size using the `/cache/` short path
  2. User can click any image in a sent message bubble to open the same preview modal (zoom in/out)
  3. When a cached image has been cleaned up or is missing, the bubble shows a broken-image placeholder rather than a broken img tag
  4. Reloading the page or switching sessions restores the chat history with image references rendering correctly (no blank slots)
**Plans**: 2 plans
Plans:
- [ ] 40-01-PLAN.md — Magic-byte MIME utility + file-utils helpers + upload POST endpoint
- [ ] 40-02-PLAN.md — Static file serving GET routes for cache and assets
**UI hint**: yes

### Phase 43: Claude SDK Multimodal Integration
**Goal**: Images attached to a chat message are passed to Claude as base64 content blocks so the AI can actually see and reason about them
**Depends on**: Phase 42
**Requirements**: AI-01, AI-02, AI-03
**Success Criteria** (what must be TRUE):
  1. Sending a message with images causes Claude to receive and correctly describe the image content in its response (end-to-end smoke test passes)
  2. Image bytes are base64-encoded server-side from disk using `buffer.toString("base64")` with no `data:` prefix; the Claude API accepts the request without error
  3. Text-only messages continue to work exactly as before; the existing string-prompt code path is not modified
  4. The architecture accepts future MIME types by extending the whitelist in one place (the upload route validation)
**Plans**: 2 plans
Plans:
- [ ] 40-01-PLAN.md — Magic-byte MIME utility + file-utils helpers + upload POST endpoint
- [ ] 40-02-PLAN.md — Static file serving GET routes for cache and assets
**UI hint**: no

## Progress

**Execution Order:**
Phases execute in numeric order: 40 -> 41 -> 42 -> 43

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
| 36. Assistant Backend | v0.92 | 2/2 | Complete | 2026-04-17 |
| 37. Terminal Mode UI | v0.92 | 2/2 | Complete | 2026-04-17 |
| 38. Chat Mode | v0.92 | 2/2 | Complete | 2026-04-17 |
| 39. Polish & Settings | v0.92 | 2/2 | Complete | 2026-04-17 |
| 40. Image Upload API | v0.93 | 0/2 | Not started | - |
| 41. Paste UX & Thumbnail Strip | v0.93 | 0/TBD | Not started | - |
| 42. Message Image Display | v0.93 | 0/TBD | Not started | - |
| 43. Claude SDK Multimodal Integration | v0.93 | 0/TBD | Not started | - |
