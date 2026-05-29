# [0.2.18](/compare/v0.2.17...v0.2.18) (2026-05-29)


### Chore

* **release:** version bump for a clean retry — no functional changes since 0.2.17



# [0.2.17](/compare/v0.2.16...v0.2.17) (2026-05-29)


### Bug Fixes

* **ripgrep detect:** fall back to well-known install paths (`/opt/homebrew/bin/rg`, `/usr/local/bin/rg`, scoop/winget/choco/ProgramFiles on Windows, `~/.cargo/bin/rg`, `~/.local/bin/rg`, `/snap/bin/rg`, MacPorts) when `which`/`where rg` returns nothing. Tower processes inherit a snapshot of PATH at launch — if the user installs ripgrep via brew after starting Tower, PATH lookup misses it even though the binary is right there
* **rg install tooltip:** restructure the manual-install tooltip into a proper line-by-line layout — three rows (macOS / Win / Linux) each with the package-manager command in monospace. Was previously one long sentence that rendered as a wall of text with parentheses



# [0.2.16](/compare/v0.2.15...v0.2.16) (2026-05-29)


### Bug Fixes

* **monaco:** drop the `npm install` install path entirely. We now download the `monaco-editor` tarball directly from npmmirror and extract it (with the existing `tar` dep) into `~/.tower/extensions/monaco/`. Removes the whole class of failures around `~/.npmrc prefix=` overrides, npm CLI absence, `npm.cmd` CVE-2024-27980 wrapping on Windows, and untrusted postinstall scripts. The Monaco API route (`/api/internal/monaco/[...path]`) now streams from the new path
* **ripgrep:** stop pretending we can auto-install a native Rust binary. The "Install" button is replaced with "Install from homepage" + a tooltip explaining why (GitHub releases unreliable in restricted networks, no domestic mirror), pointing users at `brew install ripgrep` / `winget install BurntSushi.ripgrep` / `apt install ripgrep`. `check()` keeps detecting the binary on PATH so installing it manually still flips the badge to ✓
* **search:** ripgrep resolution in code search now only looks at the user's PATH (with `where` on Windows + `which` on POSIX). The dead `@vscode/ripgrep` import path is gone, along with the dependency itself



# [0.2.15](/compare/v0.2.14...v0.2.15) (2026-05-28)


### Bug Fixes

* **monaco:** serve Monaco assets through `/api/internal/monaco/[...path]/` directly from `~/.tower/extensions/node_modules/monaco-editor/min/vs/` — no more copy-to-`public/vs` step. Next.js standalone bakes its static asset manifest at build time, so files we copied into `public/vs` at runtime weren't being served — `loader.config` got a 404 and the editor sat at "Loading editor…" forever
* **extensions:** `npm install --prefix=$EXT_ROOT` to force install into `~/.tower/extensions/` and ignore any user-level `~/.npmrc prefix=` override that would otherwise hoist the install elsewhere and leave the workspace empty (this is why "first install succeeded, refresh said not installed" — npm wasn't actually putting files where check() looked)
* **extensions:** install errors now surface npm's `stdout`/`stderr` so the next failure mode is diagnosable from the toast instead of needing to attach the server log



# [0.2.14](/compare/v0.2.13...v0.2.14) (2026-05-28)


### Refactor

* **assistant:** drop the inline `mcpServers` config in `/api/internal/assistant/chat/route.ts` — Tower MCP is already installed at user scope on every boot by `instrumentation.ts`, and the Claude SDK auto-discovers it. Keeping a second copy of the config inline meant `dist/mcp-server.cjs` path had to stay correct in two places. Now there's only one source of truth (the user-scope CLI install)
* **init-tower:** delete the now-unused `buildTowerMcpConfig()` helper; the legacy-cleanup path only needs the MCP name, which `getTowerMcpName()` already gives us



# [0.2.13](/compare/v0.2.12...v0.2.13) (2026-05-28)


### Bug Fixes

* **extensions:** install npm deps into `~/.tower/extensions/` (own workspace) instead of the global Tower package's own `node_modules` — system-managed install paths cause silent install failures and refresh shows "not installed" minutes after a successful install. Resolves "monaco-editor/min/vs not found after install" and ripgrep binary-missing failures on Windows + global-install macOS
* **extensions/monaco:** restore `process.cwd()/public/vs` for the public-asset destination so Next.js standalone actually serves the loader (the previous switch to `TOWER_PACKAGE_ROOT/public/vs` placed it outside the static dir Next.js reads at runtime)
* **assistant:** resolve `dist/mcp-server.cjs` from `TOWER_PACKAGE_ROOT`, not `process.cwd()` — the standalone server chdirs into `.next/standalone/` where `dist/` doesn't exist, so the embedded assistant was wired to a non-existent MCP entry. Mac "MCP 未安装" and Windows "Assistant encountered an error" both come from the same broken path
* **search:** ripgrep system fallback now also tries `where rg` on Windows (was POSIX-only `which`)



# [0.2.12](/compare/v0.2.11...v0.2.12) (2026-05-28)


### Bug Fixes

* **probe:** pass on any non-empty assistant text, not a literal "hello" — models that respond with "Hey!" / "Sure!" / "Hi there" no longer falsely fail Test Connection while the underlying CLI is fully working
* **extensions:** switch ripgrep + monaco installers from `pnpm` to `npm` and run from `TOWER_PACKAGE_ROOT` — end-user machines (especially Windows) rarely have pnpm on PATH, so `spawn pnpm ENOENT` was breaking optional extension install. Windows now spawns `npm.cmd` via `shell: true` to satisfy Node's CVE-2024-27980 mitigation



# [0.2.11](/compare/v0.2.10...v0.2.11) (2026-05-28)


### Bug Fixes

* **windows:** install skill via NTFS junction instead of a `dir` symlink — `fs.symlink(..., "dir")` requires Administrator / Developer Mode privilege on Windows and silently fails for normal users, leaving `skillsInstalled: false` and locking them out via the connection gate. Junctions are unprivileged and behave identically for the read-only directory scan Claude/Codex do over `~/.<provider>/skills/`
* **providers:** loosen the "connected" gate to require only `testOk` (hello probe passed). MCP/hooks/skill install flags are still recorded and shown in Settings, but they no longer block slot resolution — a working CLI is enough to launch a terminal. Stops the lockout when a non-essential integration trips up on an environmental issue



# [0.2.10](/compare/v0.2.9...v0.2.10) (2026-05-28)


### Bug Fixes

* **hooks:** auto-repair stale hook paths on app boot and before every Test Connection probe — `repairHookPaths()` rewrites command paths in `~/.claude/settings.json` / `~/.codex/hooks.toml` to the current `TOWER_PACKAGE_ROOT` for entries that already exist (never adds new ones). Fixes the chicken-and-egg case where the hello probe would hang on broken hook paths from 0.2.5/0.2.6 before the install step that would normally upsert them. Users no longer need to edit settings files by hand



# [0.2.9](/compare/v0.2.8...v0.2.9) (2026-05-28)


### Bug Fixes

* **hooks:** drain stdin in all three hook scripts (`session-start`, `post-tool`, `stop`) before any early exit — Claude Code writes its payload to the hook's stdin, and exiting before reading drops the write side mid-stream. On Windows libuv races on the orphaned pipe and Claude either crashes or hangs after the `hook_started` event without emitting `hook_completed`
* **cli-test:** parse stream-json output when the hello probe is missing the literal "hello" — surface hook failures, the assistant's actual response, or the last event instead of a 120-char raw-bytes preview that almost never contains anything useful



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
