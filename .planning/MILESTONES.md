# Milestones

## v0.96 UX Polish & Knowledge Capture (Shipped: 2026-04-20)

**Phases completed:** 6 phases, 11 plans, 19 tasks

**Key accomplishments:**

- Image lightbox with zoom/pan, text/md/json preview dialog, and reveal-in-Finder API route with platform detection
- Wired ImageLightbox, TextPreviewDialog, and Reveal in Finder into asset list with unified preview state
- Split monolithic project creation dialog into two flows: git URL-first (create) and folder browse-first (import) with auto-detection
- Atomic directory migration via fs.rename with 3 pre-flight safety checks (running executions, PTY sessions, worktrees) and editable target path derived from git URL rules
- Fire-and-forget AI dreaming that extracts reusable insights from terminal sessions into ProjectNotes linked via insightNoteId FK
- Execution timeline insight row with Lightbulb icon + daily_summary MCP insights array for session-insight notes
- Full asset visibility with task attribution badges and reusable TaskOverviewDrawer component for quick task preview from asset context
- DONE/CANCELLED task clicks routed to lightweight TaskOverviewDrawer instead of full TaskDetailPanel

---

## v0.95 Pre-Release Hardening (Shipped: 2026-04-20)

**Phases completed:** 8 phases, 18 plans, 29 tasks

**Key accomplishments:**

- Fixed 11 test failures across 4 files by aligning tests with API changes: setExitListener, .on() mock, unref removal, and instrumentation module refactoring
- board-stats.test.tsx
- CUID format validation added to asset route rejecting path-traversal attacks, plus 20-test suite covering requireLocalhost (x-forwarded-for spoofing), validateTaskId, and new validateProjectId
- 37 unit tests across 3 server action modules — CRUD, builtin label protection, setTaskLabels full-replace, FTS sync order verification
- File:
- 25 unit tests across asset-actions (CRUD + uploadAsset path traversal/size/projectId validation) and report-actions (getDailySummary workspace grouping, getDailyTodo priority sorting + filter params)
- Unit tests for task-tools and project-tools MCP handlers: 20 tests covering CRUD, reference file copy with UUID stripping, worktree git detection, autoStart fetch, label transactions, and type derivation from gitUrl
- 28 unit tests covering workspace-tools CRUD with projectCount, label-tools set_task_labels full replacement via Prisma $transaction, and terminal-tools HTTP bridge endpoints with CUID validation and all terminalStatus branches
- 9 passing unit tests for daily_summary and daily_todo MCP handlers covering date filters, workspace/project grouping, filter parameters, and stats computation
- 102 unit tests across 3 pure-function modules: Zod schema boundary values, parseDiffOutput edge cases (binary/truncation/empty), and resolveAssetPath traversal blocking + MIME_MAP spot checks
- 27 unit tests across config-reader (8 tests) and logger (19 tests) — DB mock via vi.hoisted, console spy output verification, sensitive field behavior documented
- 42 unit tests covering localStorage session CRUD with MAX_SESSIONS cap, buildSessionTitle truncation, git data capture via mocked execFileSync, ANSI/OSC stripping, 10KB buffer trimming, and error resilience
- Pure SSE event reducer extracted from use-assistant-chat.ts into sse-event-reducer.ts with 13 unit tests covering all event types via `// @vitest-environment node`
- 22 unit tests for XHR-based image upload hook: upload initiation, progress tracking, 3 error paths, removeImage with abort+revoke, clearAll, hasUploading, and unmount cleanup
- 1. [Rule 1 - Bug] http_proxy blocks localhost — 502 on all Playwright requests
- Playwright serial test suite covering the global chat assistant: settings switch to chat mode, panel open via Bot button, message send + user bubble verification, response/thinking indicator wait, and image paste-to-thumbnail flow — all 5 tests pass
- i18n.tsx split from 1192 lines to 64 lines via zh.ts/en.ts language modules; silent diff-load catches replaced with user-visible toast.error notifications
- Removed 3 unnecessary `as any` casts in production UI components by using already-available Prisma and local type definitions directly

---

## v0.94 Cache & File Management (Shipped: 2026-04-20)

**Phases completed:** 7 phases, 11 plans, 11 tasks

**Key accomplishments:**

- `src/lib/mime-magic.ts`
- 1. [Rule 3 - Blocking] Added getAssistantCacheDir/ensureAssistantCacheDir to file-utils.ts
- One-liner:
- AssistantChat wired with paste-to-thumbnail flow: clipboardData.items → XHR upload → 48px strip → ImagePreviewModal → send with filenames; provider and API route extended for imageFilenames
- One-liner:
- imageFilenames wired through provider message creation and sessionStorage cache for reload persistence; click-to-preview modal connected for sent message images
- One-liner:
- `getAssistantCacheDir(type)` + `buildCacheFilename()` pure functions implementing year-month/type directory structure and Unicode-preserving filename sanitization with 8-char UUID suffix
- Upload route switched to `getAssistantCacheDir("images")` + `buildCacheFilename()` for structured paths and readable filenames; chat route switched to `getAssistantCacheRoot()` so sub-path filenames resolve correctly in multimodal prompts
- One-liner:
- One-liner:

---

## v0.93 Chat Media Support (Shipped: 2026-04-18)

**Phases completed:** 4 phases, 7 plans, 5 tasks

**Key accomplishments:**

- `src/lib/mime-magic.ts`
- 1. [Rule 3 - Blocking] Added getAssistantCacheDir/ensureAssistantCacheDir to file-utils.ts
- One-liner:
- AssistantChat wired with paste-to-thumbnail flow: clipboardData.items → XHR upload → 48px strip → ImagePreviewModal → send with filenames; provider and API route extended for imageFilenames
- One-liner:
- imageFilenames wired through provider message creation and sessionStorage cache for reload persistence; click-to-preview modal connected for sent message images
- One-liner:

---

## v0.92 Global Chat Assistant (Shipped: 2026-04-17)

**Phases completed:** 4 phases, 8 plans, 9 tasks

**Key accomplishments:**

- 1. [Rule 3 - Blocking] Extended vitest include pattern to discover src/__tests__ files
- WebSocket immediate-destroy for __assistant__ sessions and POST/DELETE/GET internal API at /api/internal/assistant, all localhost-guarded
- 1. [Rule 1 - Bug] Fixed OSC regex pattern for ANSI stripping
- One-liner:
- Assistant panel sidebar and dialog use viewport-relative widths (30vw clamped 320-480px sidebar; 90vw capped at 600px dialog) replacing hardcoded fixed pixel values

---

## v0.6 任务开发工作台 (Shipped: 2026-04-01)

**Phases completed:** 5 phases, 11 plans, 15 tasks

**Key accomplishments:**

- react-resizable-panels v2.1.9 installed and 12 workbench i18n entries added; 查看详情 navigation confirmed correct
- safeResolvePath path-traversal security utility (src/lib/fs-security.ts) with 6 passing tests, ignore@7.0.5 installed, and Wave 0 it.todo test scaffolds for file-actions and FileTree
- One-liner:
- One-liner:
- Monaco-powered EditorTabs + CodeEditor with CDN loader, multi-tab state, Ctrl+S save via server action, dirty tracking, and theme sync
- FileTree (240px left) + CodeEditor (flex-1 right) split layout wired into task-page-client.tsx Files tab via selectedFilePath state bridge
- Prisma ProjectCategory enum + previewCommand field migrated, subprocess registry with SIGTERM kill, 3 server actions (startPreview/stopPreview/openInTerminal), terminal.app config default, and 24 i18n keys
- PreviewPanel client component with server controls, address bar, and iframe; project type selector in create dialog; terminal app config in General Settings
- CodeEditor onSave prop with ref-based stale closure fix wires into PreviewPanel iframe auto-refresh, completing the end-to-end Ctrl+S → preview reload flow (PV-06) and hiding Preview tab for BACKEND projects (PV-01)

---

## v0.5 Git Worktree 任务隔离 (Shipped: 2026-03-31)

**Phases completed:** 8 phases, 18 plans, 19 tasks

**Key accomplishments:**

- Prisma SystemConfig table + typed getConfigValue/setConfigValue/getConfigValues server actions with JSON round-trip, upsert, and CONFIG_DEFAULTS registry
- Config nav item (SlidersHorizontal icon) and SystemConfig placeholder component with bilingual i18n wired into the settings page
- GitPathRule type, matchGitPathRule pure function, resolveGitLocalPath server action, and async top-bar integration wiring DB-stored rules into project-creation auto-path logic
- Inline CRUD table UI for GitPathRule in Settings > Config with bilingual i18n, input validation, persistence via setConfigValue, and a smoke test
- One-liner:
- One-liner:
- Extracted shared search SQL into framework-agnostic src/lib/search.ts with dependency-injected SearchConfig, making both search-actions.ts (24 lines) and search-tools.ts (32 lines) thin wrappers that delegate to it — MCP search now respects user-configured limits
- 1. [Rule 1 - Bug] Fixed spinner stuck state on empty query clear
- One-liner:
- One-liner:
- One-liner:
- One-liner:
- One-liner:
- One-liner:
- One-liner:
- One-liner:

---

## v0.2 项目知识库 & 智能 MCP (Shipped: 2026-03-30)

**Phases completed:** 4 phases, 7 plans, 10 tasks

**Key accomplishments:**

- ProjectNote and ProjectAsset Prisma models with FTS5 notes_fts virtual table, busy_timeout=5000 on both PrismaClient instances, and file-utils.ts for data/assets/ and data/cache/ directory management
- FTS5 search helper with dependency injection, Note CRUD server actions with Zod validation and FTS sync, Asset CRUD server actions with Zod validation and ensureAssetsDir — 33 integration tests all green
- One-liner:
- One-liner:
- One-liner:
- Notes management UI at /workspaces/[id]/notes with Markdown editor (textarea+preview), category filter (4 presets + All), full CRUD (create/edit/delete), bilingual i18n, sidebar navigation links for Notes and Assets
- Assets management UI at /workspaces/[id]/assets with image thumbnail preview, file upload (overwrite-safe), download links, delete confirmation, project selector, and bilingual i18n

---

## v0.1 Settings (Shipped: 2026-03-27)

**Phases completed:** 3 phases, 6 plans, 11 tasks

**Key accomplishments:**

- One-liner:
- General settings panel with theme segmented control (Light/Dark/System via next-themes) and language toggle (zh/en via useI18n), settings nav restructured to General/AI Tools/Prompts with full theme-aware styling
- One-liner:
- adapterLabel made optional with default undefined
- One-liner:
- Full-CRUD PromptsConfig client component with list, create/edit dialog, delete confirmation, and set-default star button wired into settings/page.tsx replacing the Phase 3 placeholder.

---
