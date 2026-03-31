# Project Research Summary

**Project:** ai-manager v0.6 — Task Development Workbench
**Domain:** Agentic IDE workbench (online code editor, file tree, diff view, live preview) integrated into an existing AI task management platform
**Researched:** 2026-03-31
**Confidence:** HIGH

## Executive Summary

ai-manager v0.6 extends the existing task page with a four-panel developer workbench: an online code editor (Monaco), a file tree browser scoped to the task worktree, a diff view panel (reusing v0.5 git infrastructure), and a live preview panel that spawns a child process and embeds localhost output in an iframe. The pattern is well-established — bolt.new, v0.dev, and Cursor have converged on the same layout — and the v0.5 codebase already provides the key foundations: worktree path storage in `TaskExecution`, git diff plumbing, SSE streaming, and a process singleton pattern. The new work is wiring these existing pieces together with three new libraries and a handful of new API routes.

The recommended approach keeps the architecture close to existing patterns: Monaco loads via `@monaco-editor/react` with `ssr: false` dynamic import (mandatory for Next.js App Router), file reads and writes go through typed API routes with path-anchor validation (already the project's convention), preview subprocesses are tracked in a server-side module-level Map singleton (mirrors `process-manager.ts`), and the file tree is a custom recursive component over Server Actions (no third-party library needed). New external dependencies are minimal: `@monaco-editor/react@next`, `@git-diff-view/react`, and `react-resizable-panels@^2.1.7`.

The dominant risks are all implementation-level, not architectural: Monaco's SSR incompatibility with Next.js App Router causes a hard build failure if the `dynamic({ ssr: false })` wrapper is skipped; preview subprocesses leak and accumulate orphaned dev servers if a process registry is not in place from day one; and file API routes without path-traversal guards expose arbitrary filesystem reads on the host. All three risks have straightforward, well-documented mitigations and must be addressed at the start of their respective phases, not retrofitted.

---

## Key Findings

### Recommended Stack

The base stack (Next.js 16, React 19, Prisma 6, SQLite, Tailwind CSS v4, shadcn/ui, Zustand) is unchanged and validated. The v0.6 additions are three new libraries:

**New dependencies:**
- `@monaco-editor/react@4.7.0-rc.0` (code editor) — the standard Monaco wrapper for Next.js; handles CDN worker loading without webpack plugin configuration; the `@next` release explicitly targets React 19
- `@git-diff-view/react@^0.1.3` (diff rendering) — SSR/RSC-ready, zero dependencies, accepts unified diff strings that the existing `git diff` plumbing already produces
- `react-resizable-panels@^2.1.7` (panel splitter) — pinned to v2.x because v4.x has unresolved export renames that break shadcn/ui's Resizable component

The file tree, dev server proxy, and preview process management require no new libraries: they use Node.js `fs`, `child_process`, Next.js 16's built-in `proxy.ts` convention, and existing SSE infrastructure. See `.planning/research/STACK.md` for full rationale and installation commands.

### Expected Features

**Must have for v0.6 launch (P1):**
- Monaco Editor with syntax highlighting, line numbers, Ctrl+S save — core editor value
- Tab-based multi-file editing with unsaved-changes indicator — prevents data loss
- File tree with lazy expansion, gitignore-aware filtering, click-to-open — navigation foundation
- Auto-refresh file tree on `status_changed` SSE event — Claude modifies files during execution
- Unified/split diff view against base branch with reload button — core review workflow
- Preview panel: configurable start command + port, start/stop lifecycle, iframe embed, error output display

**Should have for v0.6.x patches (P2):**
- Git diff status badges on file tree nodes (M/A/D indicators)
- Auto-reload preview iframe on editor save
- SSE-streamed preview process stdout (line-by-line output)
- New file / rename / delete from file tree context menu
- Whitespace-ignore toggle in diff view
- Auto-format on save (Prettier via Server Action)

**Defer to v0.7+ (P3):**
- TypeScript IntelliSense / LSP (requires project tsconfig loading and worker config)
- AI inline suggestions wired to task chat
- Mobile viewport emulation in preview
- Inline diff comment anchoring
- Multiple preview commands per project

See `.planning/research/FEATURES.md` for the full prioritization matrix and competitor analysis.

### Architecture Approach

The workbench integrates into the existing task page (`/workspaces/[workspaceId]/tasks/[taskId]`) by expanding the right panel from a single tab to a three-tab layout: Files (tree + editor), Changes (existing `TaskDiffView` unchanged), and Preview. The left panel (AI chat + SSE execution stream) is untouched. New components follow the established `workbench-` prefix convention and communicate through typed API routes, not Server Actions, because file content and preview lifecycle require streaming and process management that Server Actions do not support.

**Major components:**
1. `WorkbenchFilesPanel` — horizontal resizable split containing `WorkbenchFileTree` + `WorkbenchEditor`; owns `selectedFile` state; receives `refreshKey` prop from parent
2. `WorkbenchFileTree` — recursive file/dir listing from `/api/tasks/[taskId]/files`; lazy expansion; gitignore-aware filtering done server-side
3. `WorkbenchEditor` — Monaco via `dynamic({ ssr: false })`; reads/writes via `/api/tasks/[taskId]/files/content`; LRU model cache (max 10 models); theme sync with next-themes
4. `WorkbenchPreviewPanel` — start/stop controls; polls `/api/tasks/[taskId]/preview/status`; renders iframe after port confirmed; streams stderr to error log
5. `preview-process-manager.ts` — server-side module singleton `Map<taskId, ChildProcess+port>`; mirrors existing `process-manager.ts` pattern
6. Three new API route groups: `files/`, `files/content/`, `preview/start|stop|status` — all path-anchored against worktree root

**Key patterns:**
- All file paths on the wire are relative to the worktree root (never absolute)
- Preview command split by whitespace into args array; `spawn(shell: false)` — no shell interpolation
- Tab state owned by `TaskPageClient`; panel-internal state stays local; cross-panel communication via `refreshKey` prop
- File tree refresh triggered only on `status_changed` SSE events (not on every event — prevents dozens of FS reads per second during execution)

See `.planning/research/ARCHITECTURE.md` for full component diagram, data flow sequences, and build order rationale.

### Critical Pitfalls

1. **Monaco SSR crash** — Importing `@monaco-editor/react` without `dynamic({ ssr: false })` causes a hard build failure (`window is not defined`). The `"use client"` directive alone is insufficient — App Router Client Components still pre-render on the server. Must be established as the first step of the editor phase; verify with `next build`.

2. **File API path traversal** — `path.normalize` alone does not prevent `../../.env` traversal. Every file read/write route must verify `resolved.startsWith(worktreeRoot + path.sep)` after resolving. Implement as a shared `safeResolvePath()` utility in `src/lib/fs-security.ts` before the first file endpoint.

3. **Preview subprocess leak** — Child processes spawned by preview start do not terminate when the user navigates away. A server-side `Map<taskId, ChildProcess>` singleton must exist from the first day of the preview phase. The start route must check for an existing process before spawning. Register `process.on('SIGTERM')` cleanup. Never start subprocesses from client-side `useEffect` (React Strict Mode double-invoke causes duplicate spawns in development).

4. **Monaco model memory leak** — Monaco text models are not disposed on editor unmount; only the editor view is disposed. Accumulation after 20+ file opens causes memory growth and sluggishness. Implement a `Map<uri, ITextModel>` cache with LRU eviction (max 10 models) and call `model.dispose()` in the workbench unmount cleanup.

5. **File tree inotify exhaustion** — Using `fs.watch` or chokidar recursively on a project with `node_modules` can exhaust the Linux inotify limit, breaking Next.js HMR system-wide. Default to polling (2-second interval) triggered by `status_changed` SSE events instead of reactive file watching. If watching is needed, exclude `node_modules`, `.git`, `dist`, `.next` and scope to `src/`/`app/` only.

See `.planning/research/PITFALLS.md` for the full 11-pitfall catalog with verification checklists.

---

## Implications for Roadmap

Based on the dependency graph in ARCHITECTURE.md and the pitfall-to-phase mapping in PITFALLS.md, the recommended build order is six sequential phases (A-F), with Phase F (Preview) parallelizable with C-D if two developers are available.

### Phase A: Tab Bar Skeleton + Route Entry
**Rationale:** Everything else builds on the multi-tab layout. Establishing the `[Files][Changes][Preview]` tab structure in `TaskPageClient` with empty placeholder panels lets Phases B-F work independently without layout conflicts.
**Delivers:** Expanded task page with three-tab right panel; tab switching works; no content yet
**Avoids:** Integration conflicts between workbench components during later phases

### Phase B: File Tree Browser
**Rationale:** The file tree is the primary navigation primitive; the editor (Phase C) depends on file selection events from the tree. Server-side exclusion list and lazy expansion must be in place before the editor integration.
**Delivers:** Working file tree with expand/collapse, gitignore filtering, lazy directory expansion, auto-refresh on `status_changed`
**Implements:** `WorkbenchFileTree`, `/api/tasks/[taskId]/files/` route, `safeResolvePath` utility in `fs-security.ts`
**Avoids:** File tree DOM freeze (lazy expansion), path traversal (shared `safeResolvePath`), inotify exhaustion (polling over watching)

### Phase C: Code Editor (Monaco Integration)
**Rationale:** Depends on Phase B's path convention and `safeResolvePath`. Monaco's `ssr: false` dynamic import is isolated to one component file — resolving this before panel integration keeps Phase D low-risk. Model cache and LRU cleanup must be implemented here, not retrofitted.
**Delivers:** Monaco editor with syntax highlight, file read/write, Ctrl+S save, unsaved-changes indicator, tab-based multi-file editing
**Implements:** `WorkbenchEditor`, `/api/tasks/[taskId]/files/content/` route, `language-map.ts`, Monaco model LRU cache
**Avoids:** Monaco SSR build failure, Monaco bundle inflation (verify with bundle-analyzer), Monaco model memory leak

### Phase D: Files Panel Integration
**Rationale:** Combines Phase B + C into the `WorkbenchFilesPanel` with a horizontal resizable splitter. Low-risk assembly step after both components are independently verified.
**Delivers:** `WorkbenchFilesPanel` with `react-resizable-panels` v2 splitter; tree click opens file in editor; editor save shows toast; file tree refreshes on agent edits
**Implements:** `WorkbenchFilesPanel`, `useFileContent` hook, `react-resizable-panels` integration

### Phase E: Changes Tab (Diff View)
**Rationale:** Nearly free — `TaskDiffView` already exists and is unchanged. Work is purely wiring it as the Changes tab in the new multi-tab layout. Can be done in parallel with Phase C or D.
**Delivers:** Changes tab rendering existing `TaskDiffView`; old single-tab layout removed from `TaskPageClient`; unified/split toggle, file-by-file sections, reload button, summary header via `@git-diff-view/react`
**Avoids:** Re-implementing diff logic that already exists (pure reuse)

### Phase F: Live Preview Panel
**Rationale:** Independent of Phases B-E (no shared components or routes). Can run in parallel with C-D or be deferred to a separate sprint. Process registry and security measures must be established from day one of this phase, not added later.
**Delivers:** Preview panel with configurable command+port, start/stop controls, iframe embed, process error output, status polling
**Implements:** `preview-process-manager.ts`, three preview API routes (start/stop/status), `WorkbenchPreviewPanel`, `usePreviewServer` hook, `previewCommand`/`previewPort` schema migration on `Project`
**Avoids:** Subprocess leak (process registry from day one), React Strict Mode double-spawn (server-side only start), iframe sandbox omission

### Phase Ordering Rationale

- Phases A through E are sequential due to layout to navigation to editor to integration dependencies; each is independently mergeable and testable
- Phase E is nearly free (pure reuse of `TaskDiffView`) and can overlap with D if convenient
- Phase F is independent and can run in parallel with C-D or be scheduled separately; Preview has the highest independent complexity (process lifecycle, security surface)
- The Monaco SSR pitfall (Phase C) is isolated to one component; verifying it before Phase D integration avoids discovering a hard build failure mid-panel-assembly
- The `safeResolvePath` utility created in Phase B is reused by Phase C's content routes — creating it once there prevents duplicated and potentially divergent traversal guards

### Research Flags

Phases with standard, well-documented patterns (no additional research needed):
- **Phase A** — Tab bar layout is a trivial shadcn/ui component composition
- **Phase B** — File listing via `fs.readdir` with gitignore filtering is a solved problem; `ignore` npm package handles pattern matching
- **Phase E** — Pure component reuse; no new patterns

Phases that may need targeted lookup during implementation:
- **Phase C** — Monaco Turbopack worker issue (#72613) is an open GitHub issue; check its status before starting. If unresolved, confirm CDN loader is sufficient for the project's use case (it should be, but verify worker loading in dev mode before committing to it).
- **Phase F** — Preview subprocess `AbortSignal` integration with Next.js 16 Route Handlers: the pattern exists in the codebase (stream route) but the exact cleanup hook for non-SSE route handlers should be verified before implementation. Also requires a `prisma migrate dev` for the new `previewCommand`/`previewPort` fields on `Project`.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Core base stack unchanged and production-validated. New libraries verified via npm and official docs; React 19 compatibility confirmed for all three additions. `react-resizable-panels` v4 breakage confirmed via tracked GitHub issue. |
| Features | HIGH | Editor and diff features are well-documented; preview proxy implementation is straightforward for a localhost-only tool. Competitor analysis (bolt.new, v0.dev, Cursor) confirms feature set convergence. |
| Architecture | HIGH | Derived directly from codebase inspection of existing patterns (`process-manager.ts`, `file-serve.ts`, `diff/route.ts`, `stream/route.ts`). No speculative patterns — all components follow established project conventions. |
| Pitfalls | HIGH | Verified against official Next.js 16 docs, Monaco Editor GitHub issue tracker, OWASP path traversal guides, and multiple production post-mortems. The 11 pitfalls are specific to this stack and domain, not generic warnings. |

**Overall confidence:** HIGH

### Gaps to Address

- **Monaco Turbopack worker status:** The open issue (#72613) was confirmed as of early 2026 but may be resolved by implementation time. Check the issue status at the start of Phase C; if resolved, CDN loader may no longer be necessary (though it remains the simpler choice regardless).
- **`previewCommand` / `previewPort` schema migration:** The Preview panel requires new fields on the `Project` model. The migration is straightforward (two nullable fields) but must be planned before Phase F begins — Prisma migration ordering relative to other pending schema changes should be confirmed.
- **i18n coverage:** All workbench UI labels require both `zh` and `en` translations. The pitfalls checklist flags this as a verification requirement; confirm the project's i18n workflow before Phase A to avoid retrofitting translations at the end.

---

## Sources

### Primary (HIGH confidence)
- `/src/app/api/tasks/[taskId]/diff/route.ts` — path anchor + worktree DB query pattern (codebase)
- `/src/lib/adapters/process-manager.ts` + `process-utils.ts` — singleton process registry + `spawn(shell: false)` pattern (codebase)
- `/src/lib/file-serve.ts` — path traversal protection (`startsWith(safePrefix)` guard) (codebase)
- `/src/lib/worktree.ts` — worktree path convention (`localPath/.worktrees/task-{taskId}`) (codebase)
- [Next.js 16 proxy.ts docs](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) — proxy.ts convention replacing middleware.ts
- [Next.js App Router — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — `"use client"` does not disable SSR pre-rendering
- [Next.js Lazy Loading Guide](https://nextjs.org/docs/pages/guides/lazy-loading) — `dynamic({ ssr: false })` requirement
- [react-resizable-panels shadcn v4 issue #9136](https://github.com/shadcn-ui/ui/issues/9136) — confirmed v4.x export rename breakage
- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal) — `path.normalize` alone is insufficient

### Secondary (MEDIUM confidence)
- [@monaco-editor/react npm](https://www.npmjs.com/package/@monaco-editor/react) — v4.7.0-rc.0 for React 19, CDN loader behavior
- [@git-diff-view/react npm](https://www.npmjs.com/package/@git-diff-view/react) + [GitHub](https://github.com/MrWangJustToDo/git-diff-view) — SSR/RSC-ready, zero deps, unified diff input
- [Next.js Turbopack issue #72613](https://github.com/vercel/next.js/issues/72613) — Monaco dynamic import issue under Turbopack
- [Monaco Editor issue #4659](https://github.com/microsoft/monaco-editor/issues/4659) — Diff editor Emitter not disposed
- [Monaco Editor issue #1693](https://github.com/microsoft/monaco-editor/issues/1693) — models not disposed on unmount
- [RedMonk: 10 Things Developers Want from Agentic IDEs 2025](https://redmonk.com/kholterhoff/2025/12/22/10-things-developers-want-from-their-agentic-ides-in-2025/) — developer expectation research
- [Builder.io: Best Agentic IDEs heading into 2026](https://www.builder.io/blog/agentic-ide) — UX patterns and feature convergence

### Tertiary (MEDIUM-LOW confidence)
- [Sourcegraph: Migrating Monaco to CodeMirror](https://sourcegraph.com/blog/migrating-monaco-codemirror) — bundle size trade-offs; Monaco chosen over CodeMirror for this use case (VSCode UX parity)
- [Bolt.diy architecture — DeepWiki](https://deepwiki.com/stackblitz-labs/bolt.diy) — reference for preview iframe + file tree + editor panel layout pattern
- [NxCode: V0 vs Bolt.new vs Lovable comparison 2026](https://www.nxcode.io/resources/news/v0-vs-bolt-vs-lovable-ai-app-builder-comparison-2025) — feature-level competitor comparison

---
*Research completed: 2026-03-31*
*Ready for roadmap: yes*
