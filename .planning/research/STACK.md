# Stack Research

**Domain:** Task development workbench — online code editor, file tree, diff viewer, live preview proxy (v0.6)
**Researched:** 2026-03-31
**Confidence:** MEDIUM-HIGH — core library choices verified via npm + official docs; Next.js 16 proxy.ts behavior confirmed via official docs; React 19 compatibility caveats noted

---

## Scope

This is a **delta research document** for the v0.6 milestone. The base stack (Next.js 16, React 19, Prisma 6, SQLite, Tailwind CSS v4, shadcn/ui, zustand) is validated and unchanged. This document covers only the **four new capability areas**:

1. Online code editor (view + edit files in the worktree)
2. File tree panel (browse worktree directory structure)
3. Diff viewer (git diff of the worktree vs base branch)
4. Live preview / dev server proxy (iframe into a running dev server)

---

## Recommended Stack

### New Dependencies

| Library | Version | Purpose | Why Recommended |
|---------|---------|---------|-----------------|
| `@monaco-editor/react` | `4.7.0-rc.0` (React 19 RC) | In-browser code editor | Monaco is the VSCode engine — syntax highlighting, IntelliSense stubs, multi-language support out of the box. The `@monaco-editor/react` wrapper handles webpack worker configuration automatically via CDN loader, eliminating the typical Next.js webpack plugin dance. The `4.7.0-rc.0` release explicitly targets React 19. |
| `monaco-editor` | `^0.55.1` | Monaco core (peer dep) | Latest stable; AMD build deprecated in 0.53+, the React wrapper handles this via CDN so the peer dep is only needed for TypeScript types. |
| `@git-diff-view/react` | `^0.1.3` | GitHub-style diff viewer | SSR/RSC-ready, zero dependencies, 25kb core + 15kb UI. Accepts unified diff strings (which the existing git worktree infrastructure already produces) and renders split/unified views with syntax highlighting via Web Worker. Actively maintained (published within days of research date). |
| `react-resizable-panels` | `^2.x` (NOT v4.x) | Resizable panel layout | The workbench needs a draggable splitter between the chat panel and the right-side editor/diff/preview tabs. Use v2.x — v4.x introduced breaking export renames that as of late 2025 remain unresolved in shadcn/ui's Resizable component. Pin to `^2.1.7` until shadcn fixes the v4 mismatch. |

### No New Dependencies Needed

| Capability | Approach | Rationale |
|-----------|---------|-----------|
| File tree | Custom recursive component | No well-maintained npm library matches the project's aesthetic and React 19 requirements. The worktree is a local filesystem — a Server Action reads the directory tree via `fs.readdir` recursively and returns a JSON tree. The UI is a straightforward recursive component using existing Tailwind + lucide-react (already installed). |
| Dev server proxy | Next.js 16 built-in `proxy.ts` + `next.config.js` rewrites | Next.js 16 renamed `middleware.ts` to `proxy.ts`. Use `next.config.js` rewrites to forward `/preview/[taskId]/**` to `localhost:{port}`. Port registry lives in a simple in-memory Map in a Server Action. No `http-proxy-middleware` needed. |
| Terminal output (preview startup) | Reuse existing SSE streaming | The project already streams Claude CLI output via SSE. The same pattern (`ReadableStream` + `res.write`) can stream dev server stdout for the preview panel startup log. No xterm.js needed — a `<pre>` with auto-scroll is sufficient for startup log display. |

---

## Integration Points with Existing Stack

### Monaco Editor + Next.js 16 App Router

Monaco requires a browser environment. Mark the editor component `"use client"`. Use `next/dynamic` with `{ ssr: false }` to prevent SSR:

```typescript
// src/components/workbench/CodeEditor.tsx
"use client"
import dynamic from "next/dynamic"

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then(m => m.default),
  { ssr: false, loading: () => <div>Loading editor...</div> }
)
```

`@monaco-editor/react` loads the Monaco worker scripts via CDN by default (no webpack config needed). This is the correct approach for Next.js — the alternative of using `monaco-editor-webpack-plugin` requires a custom webpack config and conflicts with Next.js's built-in webpack setup.

**Theme integration:** Monaco has its own theming system. Map `next-themes` values (`dark`/`light`) to Monaco's `vs-dark`/`vs` themes via a `useEffect` that calls `monaco.editor.setTheme()`.

### File Tree + Server Actions

```typescript
// src/actions/file-actions.ts (new)
export async function getWorktreeFiles(worktreePath: string): Promise<FileNode[]>
export async function readFile(worktreePath: string, relativePath: string): Promise<string>
export async function writeFile(worktreePath: string, relativePath: string, content: string): Promise<void>
```

`worktreePath` comes from `TaskExecution.worktreePath` (already stored in DB). Validate that the requested path is within the worktree root before any `fs` operation — path traversal prevention is established pattern in this codebase (see `src/actions/asset-actions.ts`).

### Diff Viewer + Existing Git Infrastructure

The v0.5 worktree implementation already runs `git diff` to produce unified diff strings (used in the task panel diff view). Feed the same diff string to `@git-diff-view/react`'s `DiffView` component. No new git plumbing needed.

### Preview Proxy + Next.js 16 `proxy.ts`

```typescript
// proxy.ts (project root — Next.js 16 convention)
import type { NextRequest } from "next/server"

export function proxy(request: NextRequest) {
  const taskId = extractTaskId(request.pathname)
  const port = devServerRegistry.get(taskId)
  if (!port) return // fall through to Next.js routes
  return Response.redirect(`http://localhost:${port}${rest}`)
}
```

The dev server registry (`Map<taskId, port>`) is managed by a Server Action that spawns the preview process and stores the assigned port. The process lifecycle (start/stop) uses Node's `child_process.spawn` (same as the existing Claude CLI execution).

---

## Alternatives Considered

| Capability | Recommended | Alternative | Why Not |
|-----------|-------------|-------------|---------|
| Code editor | `@monaco-editor/react` | `@uiw/react-codemirror` (CodeMirror 6) | CodeMirror is smaller (300KB vs 5-10MB) but Monaco's VSCode-identical UX is the right call here: the project's target users are developers who expect VSCode keybindings, multi-cursor, IntelliSense-like completions. CodeMirror's modular system requires assembling language packs manually. Monaco wins on DX for this use case. |
| Code editor | `@monaco-editor/react` | `react-monaco-editor` | `react-monaco-editor` requires webpack config changes; `@monaco-editor/react` works without bundler changes via CDN loader. For a Next.js project, `@monaco-editor/react` is the right wrapper. |
| Diff viewer | `@git-diff-view/react` | `react-diff-view` (v3.3.2) | `react-diff-view` is older and not SSR/RSC-ready. `@git-diff-view/react` is newer, SSR-ready, and specifically designed around unified git diff strings (exactly what the existing git plumbing produces). |
| Diff viewer | `@git-diff-view/react` | `react-diff-viewer` | `react-diff-viewer` is text-only, requires both old/new strings (not a unified diff). The existing infrastructure produces unified diffs from `git diff`; converting is unnecessary overhead. |
| Panel splitter | `react-resizable-panels` v2 | `allotment` | Allotment has a known SSR issue requiring `dynamic` import. `react-resizable-panels` is what shadcn/ui uses — staying in that ecosystem is consistent. Use v2.x until shadcn resolves the v4 export renames. |
| File tree | Custom component | `react-folder-tree`, `react-fs-treeview` | No third-party file tree library has meaningful npm adoption AND React 19 compatibility AND matches this project's aesthetic. A recursive component over a Server Action is ~80 lines and fully controllable. |
| Preview proxy | Next.js 16 built-in | `http-proxy-middleware` | `http-proxy-middleware` requires wrapping Next.js in a custom Express server, losing serverless deployment capability and fighting Next.js's request pipeline. The built-in `proxy.ts` + `next.config.js` rewrites handle this natively in Next.js 16. |
| Preview terminal | xterm.js | Plain `<pre>` with SSE stream | xterm.js (~600KB gzipped) is overkill for displaying startup logs. The existing SSE streaming infrastructure renders output fine in a scrollable `<pre>`. If interactive terminal is needed in a future milestone, xterm.js is the right choice. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `monaco-editor-webpack-plugin` | Conflicts with Next.js built-in webpack; `@monaco-editor/react` CDN loader makes it unnecessary | `@monaco-editor/react` default CDN mode |
| `@uiw/react-codemirror` in addition to Monaco | Two code editors is redundant; pick one. Monaco is already chosen. | `@monaco-editor/react` only |
| `react-resizable-panels` v4.x | Breaking export renames unresolved in shadcn/ui as of late 2025 | Pin to `^2.1.7` |
| WebContainers (StackBlitz) | Runs Node.js in-browser — massive complexity for a local tool where the filesystem IS the host system | Native `fs` + `child_process` Server Actions |
| xterm.js for preview logs | ~600KB bundle, React integration libraries are poorly maintained | Plain `<pre>` auto-scroll with SSE |
| `socket.io` for file watching | Adds a WebSocket server; SSE already exists in the codebase | Native `fs.watch` + existing SSE pattern |

---

## Installation

```bash
# Code editor
pnpm add @monaco-editor/react@next monaco-editor

# Diff viewer
pnpm add @git-diff-view/react

# Panel splitter (pin to v2 — NOT latest v4)
pnpm add react-resizable-panels@^2.1.7
```

No new dev dependencies required.

---

## Version Compatibility

| Package | Version | Compatibility Notes |
|---------|---------|---------------------|
| `@monaco-editor/react` | `4.7.0-rc.0` | Requires `@next` tag; explicitly targets React 19. Stable `4.6.0` works with React 18 but has React 19 hydration warnings. |
| `monaco-editor` | `^0.55.1` | Latest stable; 0.53+ deprecates AMD build — the CDN loader in `@monaco-editor/react` handles this transparently. |
| `@git-diff-view/react` | `^0.1.3` | SSR/RSC-ready; actively maintained; zero dependencies. |
| `react-resizable-panels` | `^2.1.7` | Compatible with React 19. v4.x has unresolved export renames breaking shadcn Resizable. |
| `next` | `16.2.1` | `proxy.ts` convention replaces `middleware.ts` in Next.js 16. |

---

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Monaco via CDN loader (no webpack plugin) | Next.js's webpack setup does not expose a clean extension point for the Monaco Webpack Plugin without `next.config.js` webpack customization. The CDN loader in `@monaco-editor/react` is the established pattern for Next.js projects. |
| File tree as recursive Server Component + Client interaction | Directory listing is a server concern (filesystem access). Initial tree loads as RSC data; expand/collapse is client-side state. Splitting at this boundary avoids unnecessary client bundle size. |
| Dev server port registry in memory (not DB) | Preview dev servers are transient — they don't survive Next.js restarts and don't need persistence. A module-level `Map` in a Server Action file is sufficient and avoids a schema change. |
| `react-resizable-panels` v2 (pinned) | The workbench layout is a core UX element; introducing a broken shadcn/v4 interaction is a risk not worth taking. v2 is stable, well-tested, and the API is identical for our use case. |

---

## Sources

- [@monaco-editor/react on npm](https://www.npmjs.com/package/@monaco-editor/react) — version 4.7.0-rc.0 for React 19, CDN loader behavior — MEDIUM confidence (npm page, official package)
- [monaco-editor releases](https://github.com/microsoft/monaco-editor/releases) — version 0.55.1 latest stable — MEDIUM confidence (GitHub releases)
- [@git-diff-view/react on npm](https://www.npmjs.com/package/@git-diff-view/react) — version 0.1.3, SSR/RSC-ready, zero deps — HIGH confidence (npm + library homepage)
- [git-diff-view GitHub](https://github.com/MrWangJustToDo/git-diff-view) — feature list, SSR support, active maintenance — MEDIUM confidence
- [react-resizable-panels shadcn v4 issues](https://github.com/shadcn-ui/ui/issues/9136) — v4.x export rename breakage — HIGH confidence (tracked GitHub issues)
- [Next.js 16 proxy.ts docs](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) — proxy.ts convention, replaces middleware.ts — HIGH confidence (official docs)
- [CodeMirror vs Monaco comparison — Sourcegraph](https://sourcegraph.com/blog/migrating-monaco-codemirror) — real-world migration rationale — MEDIUM confidence
- [Replit: Betting on CodeMirror](https://blog.replit.com/codemirror) — use case guidance — MEDIUM confidence
- `package.json` codebase inspection — confirmed existing dependencies and React 19.2.4 — HIGH confidence

---

*Stack research for: ai-manager v0.6 — task development workbench (code editor, file tree, diff viewer, preview proxy)*
*Researched: 2026-03-31*
