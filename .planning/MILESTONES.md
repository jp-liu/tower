# Milestones

## v1.2 Extensions & Slim Distribution (Shipped: 2026-05-09)

**Phases completed:** 3 phases (71-73), 25 tasks
**Methodology:** First milestone via superpowers TDD (writing-plans + subagent-driven-development); 60 tests added

**Key accomplishments:**

- Built unified `Extension` abstraction (`src/lib/extensions/`) — registry + types + check/install/uninstall + React Provider/hook + concurrent install guard. Adding a new extension is mostly registry-only (1 definition file + ExtensionId union).
- ripgrep extension: dual-track detection (`@vscode/ripgrep` package binary first, then `which rg` system fallback) + `pnpm add @vscode/ripgrep` install (no sudo, no system pollution); cache invalidation via exported `clearRgPathCache()`.
- Monaco extension: fs-based check (`node_modules/monaco-editor/package.json` + `public/vs/loader.js`) + `pnpm add monaco-editor` + `node scripts/copy-monaco.js` install/uninstall flow.
- Detail page conditionally renders 搜索 / 文件 tabs — when extension missing, tab is hidden entirely (not "install prompt inline"). `code-search.tsx` migrated to `useExtension('rg')`; inline rg install panel removed.
- `package.json` postinstall no longer auto-runs `copy-monaco.js` — Monaco asset copy now triggered exclusively by `installExtension('monaco')` (Phase 71 EXT-09).
- Settings page gains new "Extensions" tab (indigo accent, Package icon) — registry-driven cards show installed version + path or 未安装 status, with Install / Reinstall / Uninstall / Recheck / Visit homepage actions and inline progress + toast feedback.
- Onboarding wizard expanded to 4 steps — new "Enable extensions (optional)" step 4 with default-checked checkboxes per extension, parallel install via `Promise.all` + try/catch, persists `onboarding.extensions.{requested,completed}` lists, then completes onboarding and redirects.
- `completeOnboarding` parametrized: `(username?, lastStep: number = 4)` — default reflects post-Phase-73 wizard total.

**Notes:**

- Plans live at `docs/superpowers/plans/2026-05-09-extensions-phase-{71,72,73}.md` (NOT in `.planning/phases/`).
- Spec delta: ONBD-EXT-04 `onboarding.extensions.failed` flag + deferred toast NOT built — failure list derivable from `requested - completed` set difference and visible in Settings → Extensions immediately.
- Phase 74 (Build & Distribution slimming — `monaco-editor` → optionalDeps, npm pack削减) deferred to a separate later milestone (provisional v1.3).

---

## v1.1 Detail Page Reliability & Discovery (Shipped: 2026-05-08)

**Phases completed:** 2 phases, 7 plans, 22 tasks

**Key accomplishments:**

- Server-side file read guard returns FileReadResult union (text/oversized/binary) gated by new system.maxReadableFileBytes config; readFileContentForce bypass companion + 8 i18n keys ready for 69-02 placeholder card.
- Replaced every silent `.catch(() => {})` in code-editor.tsx and file-tree.tsx with Sonner toast.error (with retry action where safe), wired the FileReadResult union to a placeholder card with force-open, and shipped a focused vitest case covering the listDirectory failure path.
- Code search panel becomes observable, configurable, and cancellable — `search.codeTimeoutSec` config (30s default) replaces hard-coded 10s, real ripgrep stderr surfaces through 5-kind error categorization with toast + banner, and an AbortController-driven Cancel button kills in-flight rg subprocesses.
- Settings → System Parameters card now hosts a "Max Readable File Size" numeric input (1–50 MB) and Search Parameters card now hosts a "Code Search Timeout" input (5–300 s step 5), both backed by `system.maxReadableFileBytes` and `search.codeTimeoutSec` SystemConfig keys; saving persists, reloading hydrates, and the next file read / search picks up the new values live.
- Archive cards become clickable and open `TaskOverviewDrawer` with file-changes summary + a primary "Rerun task" button that fires `startPtyExecution` and toasts.
- Quick popover bumps recent count 3→5; FullTaskDialog gains a Fuse.js-powered cross-workspace task title search that replaces the workspace/project Selects view when active.
- ImageLightbox replaces the broken zoom-then-overflow-auto behavior with a proper viewer: fit/100% toggle (centered), pointer-event drag-to-pan, and prev/next navigation between project images via on-screen chevrons + ←/→ keys.

---

## v1.0 首次使用引导 & 任务完成通知 (Shipped: 2026-04-23, Archived: 2026-05-08)

**Phases completed:** 4 phases (65-68), 8 plans

**Key accomplishments:**

- Onboarding Data Layer — system_config table, onboarding state, default workspace seeding (Phase 65)
- Notification Infrastructure — task completion queue, drain endpoint, audio + system notifications (Phase 66)
- Onboarding Wizard UI — non-dismissible first-launch wizard, CLI adapter tester, theme/language selection (Phase 67)
- Username Display & AI Context — TopBar avatar/name chip, username injection into AI assistant + PTY sessions (Phase 68)

**Notes:**

- Audit performed in simplified mode — phase artifacts (PLAN.md / SUMMARY.md / VERIFICATION.md) had been cleaned locally before archival ceremony, so verification relied on ROADMAP.md + git log.
- No formal `/gsd:complete-milestone` commit was made when shipping (2026-04-23); this archive is retroactive.
- Archive files (`MILESTONES.md`, `milestones/v1.0-*.md`) are kept local-only following the gitignore convention adopted in commit `dbaf04d`.

---
