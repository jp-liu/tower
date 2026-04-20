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
- 🚧 **v0.94 Cache & File Management** — Phases 44-46 (in progress)

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

### v0.94 Cache & File Management (In Progress)

**Milestone Goal:** 重构缓存目录体系，文件名保留原始名，支持按时间清理和未来多文件类型扩展。

- [ ] **Phase 44: Cache Storage Refactor** - Year-month directory grouping, type subdirectories, original filename preservation with UUID suffix, filename sanitization
- [ ] **Phase 45: Route & Frontend Adaptation** - Catch-all cache serving route, frontend src path updates, multimodal prompt path updates
- [ ] **Phase 46: Asset Name Restoration** - Strip UUID suffix when copying cache files to project assets

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
- [x] 42-01-PLAN.md — ChatMessage type extension + UserBubble image rendering + broken-image fallback + i18n
- [x] 40-02-PLAN.md — Static file serving GET routes for cache and assets
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
- [x] 41-01-PLAN.md — useImageUpload hook + ImageThumbnailStrip + ImagePreviewModal + i18n keys
- [x] 41-02-PLAN.md — Wire into AssistantChat + update provider + API route + textarea height
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
- [x] 42-01-PLAN.md — ChatMessage type extension + UserBubble image rendering + broken-image fallback + i18n
- [x] 42-02-PLAN.md — Wire imageFilenames through provider + session history cache + preview modal
**UI hint**: yes

### Phase 43: Claude SDK Multimodal Integration
**Goal**: Images attached to a chat message are passed to Claude as absolute file paths in the prompt with Read tool enabled so the AI can view and reason about them
**Depends on**: Phase 42
**Requirements**: AI-01, AI-02, AI-03
**Success Criteria** (what must be TRUE):
  1. Sending a message with images causes Claude to receive and correctly describe the image content in its response (end-to-end smoke test passes)
  2. Image absolute paths are appended to the prompt text; Read tool is enabled so Claude can view the files
  3. Text-only messages continue to work exactly as before; the existing string-prompt code path is not modified
  4. The architecture accepts future MIME types by extending the whitelist in one place (the upload route validation)
**Plans**: 1 plan
Plans:
- [x] 43-01-PLAN.md — buildMultimodalPrompt helper + wire into chat route with Read tool
**UI hint**: no

### Phase 44: Cache Storage Refactor
**Goal**: Uploaded files are stored in structured year-month/type subdirectories with readable filenames that preserve the original name and include a UUID suffix for uniqueness
**Depends on**: Phase 43
**Requirements**: DIR-01, DIR-02, DIR-03, NAME-01, NAME-02, NAME-03
**Success Criteria** (what must be TRUE):
  1. Pasting an image named `设计稿.png` stores the file at `data/cache/assistant/2026-04/images/设计稿-a1b2c3d4.png` (original name retained, UUID appended)
  2. Pasting a screenshot with no meaningful name (e.g. `image.png` or `Screenshot 2026-04-20`) stores the file as `tower_image-{8-char-uuid}.png`
  3. Special characters and spaces in filenames are replaced with `_`; Chinese characters are preserved as-is
  4. `getAssistantCacheDir()` returns a path including the current year-month and type (e.g. `.../assistant/2026-04/images/`) and creates the directory if absent
  5. The directory structure reserves a `files/` sibling next to `images/` for future non-image file type support without code changes
**Plans**: 2 plans
Plans:
- [ ] 44-01-PLAN.md — TDD: getAssistantCacheDir(type) + buildCacheFilename() + unit tests
- [ ] 44-02-PLAN.md — Wire helpers into upload route + update chat route cache root
**UI hint**: no

### Phase 45: Route & Frontend Adaptation
**Goal**: The cache file serving route supports subpath access so the new year-month/type directory structure is reachable, and all frontend references use the correct full subpath
**Depends on**: Phase 44
**Requirements**: ROUTE-01, ROUTE-02, ROUTE-03
**Success Criteria** (what must be TRUE):
  1. A GET request to `/api/internal/cache/2026-04/images/设计稿-a1b2c3d4.png` returns the correct image bytes (catch-all route resolves the subpath)
  2. Chat message bubbles display images using the full subpath URL (e.g. `/cache/2026-04/images/xxx.png`), not a flat filename
  3. Sending a message with images causes `buildMultimodalPrompt` to resolve the correct absolute filesystem path including the year-month/type subdirectory
  4. Old flat-path cache files in `data/cache/assistant/` root are deleted during migration (no backward compatibility needed — dev stage, no users)
**Plans**: TBD
**UI hint**: yes

### Phase 46: Asset Name Restoration
**Goal**: When a task's reference files are copied from the cache into permanent project assets, the UUID suffix is stripped so the stored asset has a human-readable filename
**Depends on**: Phase 45
**Requirements**: ASSET-01
**Success Criteria** (what must be TRUE):
  1. Calling `create_task` with a reference pointing to `data/cache/assistant/2026-04/images/设计稿-a1b2c3d4.png` copies the file to assets with filename `设计稿.png` (UUID stripped)
  2. Calling `create_task` with a reference pointing to `tower_image-a1b2c3d4.png` copies the file with filename `tower_image.png` (UUID stripped, base prefix preserved)
  3. If two cache files would produce the same stripped name, the copy uses a safe non-colliding name (does not overwrite existing asset)
  4. Reference files that are not in the cache directory (e.g. already in assets) are copied unchanged
**Plans**: TBD
**UI hint**: no

## Progress

**Execution Order:**
Phases execute in numeric order: 44 -> 45 -> 46

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
| 40. Image Upload API | v0.93 | 1/2 | Complete | 2026-04-18 |
| 41. Paste UX & Thumbnail Strip | v0.93 | 2/2 | Complete | 2026-04-18 |
| 42. Message Image Display | v0.93 | 2/2 | Complete | 2026-04-18 |
| 43. Claude SDK Multimodal Integration | v0.93 | 0/1 | Complete | 2026-04-18 |
| 44. Cache Storage Refactor | v0.94 | 0/2 | Not started | - |
| 45. Route & Frontend Adaptation | v0.94 | 0/TBD | Not started | - |
| 46. Asset Name Restoration | v0.94 | 0/TBD | Not started | - |
