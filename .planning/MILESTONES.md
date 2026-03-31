# Milestones

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
