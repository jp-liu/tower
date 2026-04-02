---
gsd_state_version: 1.0
milestone: v0.7
milestone_name: 终端交互体验
status: executing
stopped_at: Completed 25-01-PLAN.md
last_updated: "2026-04-02T13:19:08.850Z"
last_activity: 2026-04-02
progress:
  total_phases: 9
  completed_phases: 5
  total_plans: 15
  completed_plans: 14
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-02)

**Core value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base.
**Current focus:** Phase 25 — xterm-terminal-component

## Current Position

Phase: 25 (xterm-terminal-component) — EXECUTING
Plan: 2 of 2
Status: Ready to execute
Last activity: 2026-04-02

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 19 (across v0.1-v0.5) + 11 (v0.6) = 30
- Average duration: ~30 min
- Total execution time: ~15 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| v0.1 (1-3) | 6 | ~3h | ~30m |
| v0.2 (4-7) | 7 | ~3.5h | ~30m |
| v0.3 (8-10) | 4 | ~2h | ~30m |
| Phase 11 P01 | 4 min | 1 task | 4 files |
| Phase 11 P02 | 5 min | 2 tasks | 4 files |
| Phase 12 P01 | 4 | 2 tasks | 5 files |
| Phase 12 P02 | 4 | 2 tasks | 3 files |
| Phase 13 P01 | 458s | 2 tasks | 10 files |
| Phase 13 P02 | 420s | 2 tasks | 4 files |
| Phase 14 P01 | 15min | 2 tasks | 4 files |
| Phase 14 P02 | 5m | 2 tasks | 2 files |
| Phase 15 P01 | 344s | 2 tasks | 7 files |
| Phase 15 P02 | 480s | 2 tasks | 6 files |
| Phase 16-worktree-execution-engine P01 | 120s | 2 tasks | 3 files |
| Phase 17-review-merge-workflow P00 | 52s | 1 tasks | 4 files |
| Phase 17-review-merge-workflow P01 | 217s | 2 tasks | 4 files |
| Phase 17-review-merge-workflow P02 | 164s | 2 tasks | 4 files |
| Phase 17-review-merge-workflow P03 | 180s | 2 tasks | 3 files |
| Phase 18-worktree-lifecycle P02 | 246s | 1 task | 2 files |
| Phase 18-worktree-lifecycle P01 | 290 | 2 tasks | 5 files |
| Phase 19-workbench-entry-layout P01 | 31536248s | 2 tasks | 3 files |
| Phase 19-workbench-entry-layout P02 | 480 | 1 tasks | 1 files |
| Phase 20-file-tree-browser P01 | 180 | 2 tasks | 6 files |
| Phase 20 P02 | 180 | 2 tasks | 2 files |
| Phase 20-file-tree-browser P03 | 900 | 2 tasks | 7 files |
| Phase 21-code-editor P01 | 780 | 3 tasks | 4 files |
| Phase 21-code-editor P02 | 134 | 2 tasks | 2 files |
| Phase 21-code-editor P03 | 300 | 1 tasks | 1 files |
| Phase 23-preview-panel P01 | 720 | 2 tasks | 8 files |
| Phase 23-preview-panel P02 | 480 | 2 tasks | 3 files |
| Phase 23 P03 | 480 | 2 tasks | 3 files |

*Updated after each plan completion*
| Phase 24 P01 | 900 | 2 tasks | 3 files |
| Phase 24-pty-backend-websocket-server P02 | 182 | 2 tasks | 2 files |
| Phase 25-xterm-terminal-component P01 | 180 | 2 tasks | 3 files |

## Accumulated Context

### Decisions

- [Pre-v0.2]: FTS5 virtual tables must be created via raw SQL AFTER prisma db push
- [Pre-v0.2]: Both PrismaClient instances need PRAGMA busy_timeout=5000
- [Pre-v0.2]: MCP tools use action-dispatch pattern to keep tool count ≤30
- [Pre-v0.2]: file-utils.ts and fts.ts must never import Next.js modules
- [v0.3]: ProjectAsset.description as nullable String? @default("")
- [v0.3]: Promise.allSettled for "all" mode parallel queries
- [v0.3]: FTS5 try/catch with LIKE fallback for malformed queries
- [v0.3]: Inline raw SQL for global note search (fts.ts stays Next.js-free)
- [Phase 11]: JSON-serialized config values in SystemConfig.value — uniform storage for string/number/boolean/object
- [Phase 11]: getConfigValue<T> returns defaultValue on missing row or malformed JSON — never throws to caller
- [Phase 11]: CONFIG_DEFAULTS registry starts empty in Phase 11 — Phase 12-13 adds entries as parameters are wired
- [Phase 11]: Follow existing NAV_ITEMS hardcoded English string pattern for Config nav item label/description
- [Phase 11]: Use SlidersHorizontal lucide icon for Config nav item
- [Phase 12]: D-13 bridge pattern: resolveGitLocalPath server action wraps DB lookup + matchGitPathRule + gitUrlToLocalPath fallback — keeps git-url.ts free of Next.js/server imports
- [Phase 12]: matchGitPathRule sorts rules by priority using [...rules].sort() — avoids array mutation, respects immutability constraint
- [Phase 12]: handleGitUrlChange async migration: sync state updates fire first, only setLocalPath awaits resolveGitLocalPath — no input lag
- [Phase 12]: Inline table row editing (not Dialog) per D-10 — less modal overhead for tabular rule management
- [Phase 12]: RuleEditState type + EMPTY_FORM constant for SystemConfig form state management
- [Phase 13]: config-reader.ts (not config-actions.ts) used in process-manager to avoid use-server boundary issues
- [Phase 13]: canStartExecution promoted to async — all callers updated with await to prevent silent concurrency bypass
- [Phase 13]: search-actions uses getConfigValues batch for 3 keys in single DB query; SQL LIMIT parameterized
- [Phase 13]: getConfigValues batch call on mount loads all 8 config values in single DB query for settings UI
- [Phase 13]: debounceMs added to search useEffect dependency array to prevent stale closure capturing initial 250ms value
- [Phase 14]: search.ts framework-agnostic with SearchConfig dependency injection — safe for both Next.js and MCP stdio contexts
- [Phase 14]: 'all' branch in search.ts uses local recursive search() calls to avoid re-fetching config 5x
- [Phase 14]: search-tools.ts uses Promise.all for 3 parallel config reads via readConfigValue — no sequential await overhead
- [Phase 14]: Merged debounceMs config fetch into open effect so it reloads on each dialog open (CFG-02)
- [Phase 14]: cancelled flag at useEffect body level (outside setTimeout) prevents stale search results from overwriting newer results (SRCH-07)
- [v0.5]: Worktree stored at {localPath}/.worktrees/task-{taskId}/ — co-located with project, no separate config needed
- [v0.5]: Branch name is task/{taskId} — fixed format, no template interpolation required
- [v0.5]: Squash merge only (never revert on main) — squash keeps main history clean
- [v0.5]: Verification before merge — IN_REVIEW gate prevents merging unsatisfied work
- [v0.5]: adapter.execute() changes only cwd — ExecutionResult interface unchanged, minimal adapter impact
- [v0.5]: baseBranch on Task (not TaskExecution) — branch choice is per-task, not per-execution-run
- [Phase 15]: Mock next/cache (vi.mock) in unit tests — revalidatePath fails outside Next.js runtime
- [Phase 15]: baseBranch stored on Task (not TaskExecution) — branch choice is per-task, not per-execution-run
- [Phase 15]: Fixed branch format task/{taskId} passed directly to TaskMetadata — no interpolation needed
- [Phase 15]: getConfigValue import removed from task-detail-panel.tsx entirely — only branchTemplate used it there
- [Phase phase16]: createWorktree propagates original git error on failure — no wrapping, maintains diagnostic clarity
- [Phase phase16]: NORMAL projects and GIT without baseBranch: zero behavior change (cwd stays localPath)
- [Phase 17-review-merge-workflow]: Test stubs use it.todo() for all placeholder cases — runnable by vitest without errors, 16 todo tests total
- [Phase 17]: git merge-tree --write-tree used for conflict pre-check (dry-run, no index modification)
- [Phase 17]: status_changed SSE event emitted on exitCode 0 so client can refresh without polling
- [Phase 17]: send-back IN_REVIEW to IN_PROGRESS transition before TaskExecution creation in stream POST
- [Phase 17]: TaskPage serializes Date fields to ISO strings before passing to client component
- [Phase 17]: SSE status_changed event triggers both local taskStatus state update and router.refresh() for immediate UI + data sync
- [Phase 17]: workspaceId passed from BoardPageClient into TaskDetailPanel for navigation
- [Phase 18-02]: Dynamic imports inside instrumentation register() prevent Edge runtime import errors
- [Phase 18-02]: initDb() called before DB query in instrumentation.ts to ensure WAL/busy_timeout PRAGMAs
- [Phase 18-02]: src/instrumentation.ts chosen over root-level — consistent with project src/ convention
- [Phase 18-worktree-lifecycle]: removeWorktree guards git ops with existsSync/branch-list checks; best-effort cleanup never blocks DONE/CANCELLED transitions
- [v0.6 Roadmap]: Expand existing task-page-client.tsx — do NOT create new page from scratch
- [v0.6 Roadmap]: DF-01 (diff) reuses existing TaskDiffView component — Phase 22 is pure wiring, no new diff logic
- [v0.6 Roadmap]: File tree is a custom recursive component (~80 lines), no third-party library
- [v0.6 Roadmap]: Monaco Editor must use dynamic({ ssr: false }) — "use client" alone is insufficient in App Router
- [v0.6 Roadmap]: Preview uses child_process.spawn (not WebContainers) — Node.js is already on the host
- [v0.6 Roadmap]: PV-01 (project type frontend/backend) requires Prisma schema migration — plan this before Phase 23
- [v0.6 Roadmap]: Preview subprocess registry must exist from day one of Phase 23 — no retrofitting process leak mitigation
- [v0.6 Roadmap]: safeResolvePath() utility in src/lib/fs-security.ts must be created in Phase 20 and reused in Phase 21
- [v0.6 Roadmap]: File tree polling triggered by status_changed SSE events (2s interval during execution), not fs.watch — avoids inotify exhaustion
- [Phase 19-workbench-entry-layout]: react-resizable-panels v2.x pinned at ^2.1.9 — v4.x API breaks with different component names (ResizablePanel vs Panel)
- [Phase 19-workbench-entry-layout]: 查看详情 button in task-detail-panel.tsx already correctly wired from Phase 17 — no code change needed in Plan 01
- [Phase 19-workbench-entry-layout]: TabsList uses @base-ui/react/tabs — active state uses data-active, className overrides apply for visual tab bar styling
- [Phase 20-file-tree-browser]: normalizedBase strategy: strip trailing sep before check, re-add for prefix comparison — handles trailing-slash base cleanly
- [Phase 20-file-tree-browser]: it.todo() Wave 0 scaffold pattern: all describe blocks with it.todo stubs so runner exits 0, Plans 02/03 fill them
- [Phase 20]: .git guard in deleteEntry fires BEFORE safeResolvePath — unconditional protection
- [Phase 20]: getGitStatus returns empty {} on any error — UI degrades gracefully without surfacing git errors
- [Phase 20-03]: path module removed from client components — use string manipulation for browser-compatible path operations
- [Phase 21-code-editor]: @monaco-editor/react@next (4.8.0-rc.3) used — React 19 compatible, no webpack plugin (Turbopack incompatible)
- [Phase 21-code-editor]: readFileContent/writeFileContent named to avoid collision with readFile/writeFile fs/promises imports
- [Phase 21-code-editor]: activeTabRef pattern solves stale closure in Monaco addAction() — useRef kept in sync via useEffect([tabs, activeTabPath])
- [Phase 21-code-editor]: handleTabClose combines Monaco model disposal and setTabs in single call to avoid double-render on active tab close
- [Phase 21-03]: CodeEditor imported directly (no additional dynamic() wrapper) — CodeEditor already handles SSR internally
- [Phase 21-03]: latestExecution?.worktreePath null-guard: renders noWorktree fallback instead of CodeEditor when no worktree
- [Phase 23]: spawn with shell: false — command split by whitespace into args array (security requirement, overrides RESEARCH.md D-05 shell: true)
- [Phase 23]: execFileSync with args array for open -a terminal command — no shell interpolation (security constraint D-08)
- [Phase 23]: Preview subprocess registry: module-level Map<taskId, ChildProcess> in src/lib/adapters/preview-process-manager.ts
- [Phase 23-preview-panel]: PreviewPanel refreshKey is parent-controlled; iframe key={refreshKey} forces re-render; Plan 03 wires refresh trigger
- [Phase 23-preview-panel]: onBlur-persist for commandInput: updateProject called on blur, not on every keystroke — avoids excessive DB writes
- [Phase 23]: onSaveRef pattern: useRef + useEffect sync mirrors existing activeTabRef pattern — avoids stale closure in Monaco addAction
- [Phase 23]: projectType check (not .type) for Preview tab visibility — .type is GIT/NORMAL, .projectType is FRONTEND/BACKEND
- [Phase 23]: previewRefreshKey is parent-controlled in task-page-client — PreviewPanel receives it as prop, uses key={refreshKey} to force iframe re-render
- [v0.7 Roadmap]: WS server on port 3001 started from instrumentation.ts (not Route Handler — Next.js App Router does not support HTTP Upgrade)
- [v0.7 Roadmap]: node-pty requires --webpack flag; Turbopack cannot bundle native .node addon (Next.js issue #85449)
- [v0.7 Roadmap]: PTY sessions keyed by taskId (not WebSocket connection) — browser refresh reattaches without killing the process
- [v0.7 Roadmap]: TaskTerminal must use next/dynamic({ ssr: false }) — xterm.js accesses window at import time
- [v0.7 Roadmap]: Claude CLI spawn args must remove --output-format stream-json --print - for PTY mode (raw TTY output)
- [v0.7 Roadmap]: PTY session registry (Map<taskId, PtySession>) must be implemented before any UI work — no retrofitting
- [v0.7 Roadmap]: Double-kill guard: killed boolean flag + try-catch on all pty.kill() calls; pty.onExit sets killed=true but does NOT call kill()
- [v0.7 Roadmap]: CSWSH origin validation: reject non-localhost origins with 403 — non-negotiable security requirement
- [v0.7 Roadmap]: Phase 27 (Task Card Context Menu) is independent of terminal work — can proceed after Phase 23 exists
- [v0.7 Roadmap]: Phase 28 (Bug Fixes) is fully independent — can run in parallel with any other phase
- [Phase 24]: spawn-helper +x fix: pnpm strips execute permissions on native addon helpers; must chmod after rebuild
- [Phase 24]: dev script --webpack (not --turbopack): Turbopack cannot bundle node-pty native addon (Next.js #85449)
- [Phase 24]: onExit sets killed=true but does NOT call pty.kill() — prevents double-kill crash (D-07)
- [Phase 24-pty-backend-websocket-server]: noServer + HTTP upgrade handler for WS 403 rejection: correct path for standalone port 3001 server not attached to Next.js HTTP server
- [Phase 24-pty-backend-websocket-server]: makeBatchedSender closes over ws: onData callback captures WS reference from connection scope — no per-chunk Map lookup needed
- [Phase 25-01]: @xterm/addon-webgl resolved to 0.19.0 (latest at time of install) — plan specified 'latest'

### Pending Todos

None.

### Blockers/Concerns

- Phase 24: Verify `node -e "require('node-pty')"` passes after install — native addon compilation may require Xcode command line tools on macOS.
- Phase 24: Switch dev script from `next dev --turbo` to `next dev --webpack` before any node-pty work — Turbopack is incompatible.
- Phase 26: DB persistence decision for terminal sessions is unresolved (raw transcript as TaskMessage vs. no persistence). Must decide during Phase 26 planning.

## Session Continuity

Last session: 2026-04-02T13:19:08.847Z
Stopped at: Completed 25-01-PLAN.md
Resume file: None
