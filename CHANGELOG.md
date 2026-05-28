# [0.2.8](/compare/v0.2.7...v0.2.8) (2026-05-28)


### Bug Fixes

* **hooks:** upsert (not just insert) — rewrite stale Claude/Codex hook paths in `~/.claude/settings.json` and `~/.codex/hooks.toml` when their command embeds an old `.next/standalone/scripts/...` path. Self-heals upgraders whose hooks were written by 0.2.5/0.2.6 before `TOWER_PACKAGE_ROOT` landed
* **package:** drop `src/mcp/` from `files` — the runtime uses `dist/mcp-server.cjs` (bundled by esbuild), so the source tree was dead weight and accidentally shipped `__tests__/` too



# [0.2.7](/compare/v0.2.6...v0.2.7) (2026-05-28)


### Bug Fixes

* **windows:** drop stdin from the hello probe — pass the prompt inline via `--print <text>` / `codex exec <text>` instead of `--print -`. Windows libuv crashes (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) ... async.c:76`) when a cmd.exe-wrapped child with a piped stdin exits quickly
* **windows:** wrap `.cmd`/`.bat` shims via `cmd.exe` for the version probe too — Node refuses to `execFile` them directly since CVE-2024-27980, which was silently turning every Test Connection on Windows into "Version: unknown"



# [0.2.6](/compare/v0.2.5...v0.2.6) (2026-05-28)


### Bug Fixes

* **ai-providers:** ship `skills/` in the npm package and resolve skill/hook/MCP paths from `TOWER_PACKAGE_ROOT` instead of `process.cwd()` — Test Connection now produces a usable connection (Settings → Test Connection no longer reports installed but the slot resolver throws `CLI_NOT_FOUND` because `skillsInstalled` was silently false)



# [0.2.5](/compare/v0.2.4...v0.2.5) (2026-05-28)


### Bug Fixes

* **boot:** drop FTS5 shadow tables and checkpoint WAL before `db push` — fixes "no such table: notes_fts_config" mid-migration crash on upgrade



# [0.2.4](/compare/v0.2.3...v0.2.4) (2026-05-28)


### Bug Fixes

* **boot:** auto-migrate database schema on upgrade — gated by `prisma/schema.prisma` hash, so existing users no longer have to run `prisma db push` manually after `tower-studio` updates (issue #6)
* **fts:** repopulate the notes search index from `ProjectNote` when it's empty — avoids broken note search after schema migrations drop the FTS5 shadow tables



# [0.2.0](/compare/v0.1.21...v0.2.0) (2026-05-28)


### Features

* **preview:** live frontend preview module — preset detection, dev-server session lifecycle, WS log streaming, embedded panel
* **preview:** 3-level (task/project/preset) config with source indicators + presets for uni-app, Vue CLI, CRA
* **version:** 版本时间线 — 版本管理 + 按版本归纳任务
* **mcp:** auto-install Tower MCP to each CLI user scope at boot
* **settings:** folder picker and {path} toggle for git path rules


### Bug Fixes

* **worktree:** symlink node_modules for task subPath; skip stray root node_modules without package.json
* **task:** keep Monaco mounted to avoid "InstantiationService has been disposed"
* **task:** skip detail drawer when returning from studio (tower) task
* **preview:** graceful stop with lifecycle logs and SIGKILL fallback


### CI

* run test suite on pull requests to main; skip environment-coupled smoke tests in CI



# [0.1.0](/compare/v1.0.0...v0.1.0) (2026-03-26)


### Bug Fixes

* address code review CRITICAL and HIGH issues 0cd6ac9
* address remaining code review issues (H-4, M-2/4/6/7) a8fcb92


### Features

* add adapter execution engine with Claude Code support 0d1e66e
* add MCP Server with 18 CRUD tools, AGENTS.md, and SKILL.md 93dd85e
# [0.1.0](/compare/v1.0.0...v0.1.0) (2026-03-26)

# [1.0.0](/compare/9e77b515af277ff8d2b82bba73b491b7e79cdaa2...v1.0.0) (2026-03-26)


### Bug Fixes

* add router.refresh after all server actions, fix task detail messages ca00627
* board height, project tabs, priority buttons, repo sidebar styling abf4a73
* improve contrast and readability across dark theme 8ef2182
* make all buttons functional with toast feedback and proper state 8a85ef0
* move language toggle from sidebar footer to top-bar header 69b84c6
* position search dialog at 10vh from top 437cf51
* prevent unicode escaping of Chinese text, use dialog for workspace edit 5dcce57
* project creation working, search dialog with Cmd+K, sidebar clip 7a0e0dd
* project creation, sidebar clip, search dialog with multi-type 82d1299
* project tab border-b-2 on all states to prevent layout shift 8f63e16
* replace branch lists with searchable dropdown selectors d4beebc
* separate sidebar navigation from dropdown menu, add E2E tests ed485bf
* unify button colors to amber, fix kanban top border clipping 455fff6
* wire message sending, task editing, and board interactions 62c6211
* wire sidebar navigation, settings link, and new project dialog 1717334


### Features

* 6 UI improvements 9083dd7
* add agent runner, SSE streaming, and execution server actions b775e4f
* add app layout with purple sidebar and top bar ab49cb3
* add kanban board components with drag-and-drop cb7c0d2
* add seed data and utility helpers with tests e8e557c
* add settings page with AI Tools configuration 5779870
* add task detail panel with conversation UI c849d9e
* apply Midnight Studio theme to right panels 2de04fb
* collapsible sidebar with icon selection and dialog creation 0a5c8b5, closes #1
* complete kanban board page with filters, actions, and task creation b53a996
* create branch dialog with name, base branch selector, and description 013409e
* define database schema with Prisma models and types 4de5025
* full git integration in right sidebar f2435c7
* full label system - create/assign/display labels on tasks with workspace management c440527
* full workspace CRUD with create/rename/delete in sidebar 98dbdd0
* i18n zh/en support with language toggle, tooltips on collapsed sidebar 894c243
* initial commit 9e77b51
* labels + project edit + UI improvements d5a8633
* local folder browser for project path selection 0b3f7c8
* project CRUD, task edit dialog, and search functionality 92ccbc6
* project details sidebar, enhanced creation dialog, remove ws tabs, fix collapsed clipping 3e0b3bb
* project details, enhanced creation, labels schema, sidebar cleanup 3a2a360
* unified project creation with git URL auto-mapping and clone support d395bf2
* visual redesign — Midnight Studio dark theme 71a6444
