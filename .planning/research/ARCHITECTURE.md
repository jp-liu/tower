# Architecture Research

**Domain:** Task development workbench (code editor + file tree + diff + preview) integrated into an existing AI task management platform
**Researched:** 2026-03-31
**Confidence:** HIGH

## Standard Architecture

### System Overview

The workbench adds four capabilities to the existing task page. The existing layout is a 40/60 split (Chat | Tabs). The workbench expands the right-side tab bar with three new panels: Files (editor + tree), Diff (already partially exists), and Preview.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Task Page Route                                  │
│  /workspaces/[workspaceId]/tasks/[taskId]                                │
├──────────────────────────┬──────────────────────────────────────────────┤
│   Left Panel (40%)       │   Right Panel (60%)                          │
│   AI Chat (existing)     │   Tab Bar: [Files] [Changes] [Preview]        │
│                          ├──────────────────────────────────────────────┤
│   - TaskConversation     │   Files Tab                                  │
│   - TaskMessageInput     │   ┌────────────┐ ┌──────────────────────┐   │
│   - SSE stream           │   │ FileTree   │ │ MonacoEditor         │   │
│                          │   │ (worktree  │ │ (dynamic import,     │   │
│                          │   │  or local  │ │  ssr: false)         │   │
│                          │   │  path)     │ │                      │   │
│                          │   └────────────┘ └──────────────────────┘   │
│                          ├──────────────────────────────────────────────┤
│                          │   Changes Tab (existing TaskDiffView)         │
│                          ├──────────────────────────────────────────────┤
│                          │   Preview Tab                                 │
│                          │   ┌────────────────────────────────────────┐ │
│                          │   │ PreviewPanel                           │ │
│                          │   │ - Start/Stop command controls          │ │
│                          │   │ - Port selector                        │ │
│                          │   │ - iframe src="http://localhost:PORT"   │ │
│                          │   └────────────────────────────────────────┘ │
└──────────────────────────┴──────────────────────────────────────────────┘

Server-side support:
┌─────────────────────────────────────────────────────────────────────────┐
│  API Routes (new)                                                        │
│  GET  /api/tasks/[taskId]/files          — list files in worktree/path  │
│  GET  /api/tasks/[taskId]/files/content  — read file content            │
│  PUT  /api/tasks/[taskId]/files/content  — write file content           │
│  POST /api/tasks/[taskId]/preview/start  — spawn preview child process  │
│  POST /api/tasks/[taskId]/preview/stop   — kill preview child process   │
│  GET  /api/tasks/[taskId]/preview/status — preview running/port info    │
├─────────────────────────────────────────────────────────────────────────┤
│  Existing Infrastructure (unchanged)                                     │
│  - /api/tasks/[taskId]/stream  (SSE execution)                          │
│  - /api/tasks/[taskId]/diff    (git diff)                               │
│  - /api/tasks/[taskId]/merge   (squash merge)                           │
│  - lib/worktree.ts             (path derivation reused)                 │
│  - lib/adapters/process-utils.ts (runChildProcess reused for preview)   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Classification |
|-----------|----------------|----------------|
| `TaskPageClient` | Top-level layout, tab state, panel orchestration | Modified (existing) |
| `WorkbenchFileTree` | Recursive file/dir listing from worktree path | New |
| `WorkbenchEditor` | Monaco editor with file load/save via API | New |
| `WorkbenchFilesPanel` | Combines FileTree + Editor in resizable split | New |
| `TaskDiffView` | Git diff rendering + merge (already exists) | Unchanged |
| `WorkbenchPreviewPanel` | Preview controls + iframe renderer | New |
| `useFileContent` | Custom hook: fetch/save file via API | New |
| `usePreviewServer` | Custom hook: start/stop/poll preview process | New |
| `previewProcessManager` | Server-singleton: Map of taskId to ChildProcess+port | New |

## Recommended Project Structure

```
src/
├── app/
│   └── workspaces/[workspaceId]/tasks/[taskId]/
│       ├── page.tsx                    # Server Component (unchanged)
│       └── task-page-client.tsx        # Modified: add Files + Preview tabs
│
├── app/api/tasks/[taskId]/
│   ├── files/
│   │   └── route.ts                   # GET: list files in worktree/localPath
│   ├── files/content/
│   │   └── route.ts                   # GET: read file, PUT: write file
│   ├── preview/
│   │   ├── start/route.ts             # POST: spawn preview process
│   │   ├── stop/route.ts              # POST: kill preview process
│   │   └── status/route.ts            # GET: port + running state
│   ├── diff/route.ts                  # (existing, unchanged)
│   ├── execute/route.ts               # (existing, unchanged)
│   ├── merge/route.ts                 # (existing, unchanged)
│   └── stream/route.ts                # (existing, unchanged)
│
├── components/task/
│   ├── workbench-file-tree.tsx        # New: recursive tree from API
│   ├── workbench-editor.tsx           # New: Monaco dynamic import wrapper
│   ├── workbench-files-panel.tsx      # New: FileTree + Editor layout
│   ├── workbench-preview-panel.tsx    # New: iframe + controls
│   ├── task-diff-view.tsx             # (existing, unchanged)
│   ├── task-conversation.tsx          # (existing, unchanged)
│   └── task-message-input.tsx         # (existing, unchanged)
│
└── lib/
    ├── preview-process-manager.ts     # New: server singleton for preview processes
    ├── language-map.ts                # New: file extension to Monaco language
    ├── worktree.ts                    # (existing, reused for path derivation)
    ├── adapters/process-utils.ts      # (existing, reused for preview spawn)
    └── file-serve.ts                  # (existing, pattern reference)
```

### Structure Rationale

- **`app/api/tasks/[taskId]/files/`:** Follows existing per-task API grouping convention. File listing and content are separate routes to keep each handler focused.
- **`app/api/tasks/[taskId]/preview/`:** Preview lifecycle needs three endpoints (start/stop/status) — mirrors how execution uses `/execute` and `/stream`.
- **`components/task/workbench-*.tsx`:** Keeps workbench components co-located with other task components. All prefixed `workbench-` to distinguish from the chat-related `task-*` components.
- **`lib/preview-process-manager.ts`:** A server-side singleton (module-level Map) following the pattern of `process-utils.ts`'s `runningProcesses`. Preview processes are long-lived unlike execution processes.

## Architectural Patterns

### Pattern 1: Monaco Editor as Dynamic Import with `ssr: false`

**What:** Monaco Editor requires browser APIs (`document`, `window`). It cannot run on the server. Use Next.js `dynamic()` with `ssr: false` to ensure the editor only loads client-side.

**When to use:** Any time Monaco is rendered. The `WorkbenchEditor` component must be a Client Component, and it must additionally wrap the `@monaco-editor/react` Editor in a `dynamic()` call.

**Trade-offs:** Adds approximately 2-4MB bundle to client (Monaco is large). First render shows a loading skeleton. Language services (IntelliSense) work without a language server — syntax highlighting and basic completion are built-in. Turbopack (Next.js 16 dev server) has known issues with Monaco's web workers; the `ssr: false` dynamic import is the stable workaround.

**Example:**

```typescript
// components/task/workbench-editor.tsx
"use client";
import dynamic from "next/dynamic";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  { ssr: false, loading: () => <EditorSkeleton /> }
);
```

### Pattern 2: File API Route with Path Anchoring

**What:** All file read/write routes resolve the requested path relative to the task's worktree path (or `localPath` for NORMAL projects). They enforce that the resolved path stays within that root — the same path-traversal protection used in `file-serve.ts`.

**When to use:** `/api/tasks/[taskId]/files/content` GET and PUT handlers.

**Trade-offs:** The worktree path must be looked up from DB on every request (task to latest execution to worktreePath). Cache the worktree path in the route's request handling, not across requests. SQLite is fast enough for a local tool.

**Example:**

```typescript
// app/api/tasks/[taskId]/files/content/route.ts
const worktreeRoot = path.resolve(worktreePath);
const requestedPath = path.resolve(worktreeRoot, filePath);
if (!requestedPath.startsWith(worktreeRoot + path.sep)) {
  return NextResponse.json({ error: "Invalid path" }, { status: 400 });
}
```

### Pattern 3: Preview Process as Server Singleton

**What:** A module-level `Map<taskId, { process: ChildProcess; port: number }>` in `lib/preview-process-manager.ts` tracks running preview servers. The preview start API route spawns `child_process.spawn()` with the user-configured command (e.g., `npm run dev -- --port 3100`) in the worktree directory. The stop route kills it. The status route reads the map.

**When to use:** The Preview tab's start/stop controls POST to these routes.

**Trade-offs:** This is a process-level singleton, not persisted in SQLite. On Next.js hot-reload, the Map clears but child processes may still be running on their ports. Mitigation: the start route checks whether a process for this taskId already exists in the map before spawning. The stop route uses SIGTERM then SIGKILL after a 3-second grace period, following the existing `process-utils.ts` pattern.

Port selection: user configures a port in the Preview panel UI (default 3000). The system does not auto-assign ports — this is a local tool and users control their own port space.

**Example:**

```typescript
// lib/preview-process-manager.ts
interface PreviewEntry { process: ChildProcess; port: number; taskId: string }
const previews = new Map<string, PreviewEntry>();

export function startPreview(taskId: string, command: string, cwd: string, port: number): void
export function stopPreview(taskId: string): void
export function getPreviewStatus(taskId: string): { running: boolean; port: number | null }
```

### Pattern 4: File Tree Listing with Lazy Expansion

**What:** The file listing API route runs `fs.readdir` on the worktree path. By default it returns only the first level. When a directory node is expanded in the UI, a second fetch retrieves its children. The `WorkbenchFileTree` component renders this as a collapsible tree. The `path` returned is always relative to the worktree root, not absolute.

**When to use:** The Files tab in the right panel.

**Trade-offs:** Lazy expansion avoids loading large trees upfront. The content endpoint reconstructs the absolute path server-side from the relative path + worktree root. Hidden files/directories (dotfiles) are excluded by default with an opt-in toggle.

### Pattern 5: Tab State in Parent, Panel State Local

**What:** `TaskPageClient` owns which tab is active (Files / Changes / Preview) and manages the top-level layout. Each panel component (`WorkbenchFilesPanel`, `TaskDiffView`, `WorkbenchPreviewPanel`) owns its own internal state (selected file, preview port, etc.). Cross-panel communication (e.g., agent edit triggers file tree refresh) happens via a `refreshKey` prop incremented by the parent.

**When to use:** Always — keeps the parent thin and panels independently testable.

**Trade-offs:** File tree refresh after agent execution requires the parent to detect `status_changed` SSE events (already handled in `task-page-client.tsx`) and increment a `refreshKey` passed to `WorkbenchFilesPanel`. No global state or Zustand slice is needed.

## Data Flow

### File Read Flow

```
User clicks file in WorkbenchFileTree
    |
WorkbenchFilesPanel.handleFileSelect(relativePath)
    |
useFileContent hook: GET /api/tasks/[taskId]/files/content?path=<relativePath>
    |
API route: resolve worktree root from DB → anchor path → fs.readFile
    |
Response: { content: string; language: string }
    |
MonacoEditor: setValue(content), setLanguage(language)
```

### File Write Flow

```
User edits in Monaco, clicks Save (Ctrl+S handler)
    |
WorkbenchEditor.handleSave(content)
    |
useFileContent hook: PUT /api/tasks/[taskId]/files/content
  body: { path: relativePath, content: string }
    |
API route: anchor path → fs.writeFile
    |
Response: { success: true }
    |
Toast notification "Saved"
```

### Preview Start Flow

```
User configures command ("npm run dev") + port (3000) in WorkbenchPreviewPanel
    |
handleStart() → POST /api/tasks/[taskId]/preview/start
  body: { command: string; port: number }
    |
API route: validate command (Zod), lookup worktree path from DB
    |
previewProcessManager.startPreview(taskId, command, cwd, port)
  → spawn child_process in worktree directory (shell: false)
    |
Response: { started: true; port: number }
    |
WorkbenchPreviewPanel: polls GET /api/tasks/[taskId]/preview/status
  every 2 seconds until running confirmed or 30-second timeout
    |
iframe src="http://localhost:{port}" renders once confirmed running
```

### Agent Edit → File Tree Refresh Flow

```
SSE event { type: "status_changed" } received in TaskPageClient
    |
TaskPageClient: increment fileTreeRefreshKey state
    |
WorkbenchFilesPanel receives new refreshKey prop
    |
useEffect on refreshKey: re-fetch file listing from API
    |
File tree re-renders with agent's new/modified files
```

### Key Data Flows

1. **Worktree path resolution:** Every file/preview API route resolves the worktree path the same way: look up `db.taskExecution.findFirst({ where: { taskId, status: "COMPLETED" }, orderBy: { createdAt: "desc" } })` and use `worktreePath`. Falls back to `task.project.localPath` if no COMPLETED execution exists (NORMAL projects, or before first execution on GIT projects).

2. **Language detection:** Map file extension to Monaco language string in `lib/language-map.ts`. The content API includes a `language` field in the response so the client does not need to do extension mapping itself.

3. **Preview command security:** The command string from the user is split by whitespace and passed as args array to `child_process.spawn(shell: false)` — never interpolated into a shell string. This follows the existing `execFileSync` pattern in `diff/route.ts` and the security convention in `process-utils.ts`.

## Scaling Considerations

This is a localhost-only single-user tool. Scaling is not a concern. The relevant operational limits:

| Concern | At 1 user (current target) | Notes |
|---------|---------------------------|-------|
| Concurrent preview servers | 1 per task, user-managed | No need to auto-limit |
| File tree size | Bounded by user's project | Lazy expansion prevents UI freeze |
| Monaco bundle size | ~2-4MB initial load | Acceptable for local dev tool |
| File write conflicts | None (single user) | No optimistic locking needed |
| SQLite reads per file op | 1 DB query per API call | Negligible for local SQLite |

## Anti-Patterns

### Anti-Pattern 1: Passing Absolute Filesystem Paths to the Client

**What people do:** Return the full `worktreePath + "/" + filename` in the file listing API and send it back as-is for content requests.

**Why it's wrong:** Exposes internal filesystem structure unnecessarily; makes path-traversal validation harder; couples client to server filesystem layout.

**Do this instead:** Return only paths relative to the worktree root in the listing API. The content API accepts relative paths and resolves them server-side with anchor validation.

### Anti-Pattern 2: Bundling Monaco Without `ssr: false`

**What people do:** Import `@monaco-editor/react` directly at the top of a Client Component without `dynamic()`.

**Why it's wrong:** Next.js still attempts to bundle Monaco for server rendering. Monaco accesses `window` and `document` during initialization, causing a crash at build time or a hydration error at runtime. Turbopack (used in `next dev`) has additional Monaco worker issues.

**Do this instead:** Always use `dynamic(() => import("@monaco-editor/react"), { ssr: false })`. The `WorkbenchEditor` component is the single place this import appears.

### Anti-Pattern 3: Shell-Interpolated Preview Commands

**What people do:** Execute `exec(\`${userCommand}\`)` or `spawn("sh", ["-c", userCommand])` with the user-provided preview command.

**Why it's wrong:** Even on a local tool, running a user-typed command through a shell interpreter enables accidental injection (e.g., `npm run dev; rm -rf ~`).

**Do this instead:** Split the command string by whitespace and pass `spawn(cmd, args, { shell: false })`. This matches the existing `process-utils.ts` approach.

### Anti-Pattern 4: Polling Preview Readiness Too Aggressively

**What people do:** Poll `/api/tasks/[taskId]/preview/status` every 200-500ms immediately after the start response.

**Why it's wrong:** Preview dev servers (Vite, Next.js) take 3-10 seconds to start and bind their port. Rapid polling creates unnecessary API calls and can overwhelm Next.js route handler processing.

**Do this instead:** Poll at 2-second intervals. Show a "Starting..." state in the UI. Cap polling at 30 seconds, then show an error message with the process's stderr for diagnosis.

### Anti-Pattern 5: Re-fetching the File Tree on Every SSE Event

**What people do:** Subscribe to every SSE event and re-fetch the entire file tree on any `tool` or `log` event.

**Why it's wrong:** During an active execution the SSE stream emits dozens of events per second. Each re-fetch is a filesystem read operation.

**Do this instead:** Only re-fetch on `status_changed` events (which fire once per execution completion). Agent file changes are visible atomically after execution completes — not incrementally during streaming.

## Integration Points

### Existing Infrastructure Reused

| Integration | How Reused | Notes |
|-------------|------------|-------|
| `lib/worktree.ts` | Worktree path convention (`localPath/.worktrees/task-{taskId}`) | File routes derive the path using the same convention; no need to call `createWorktree()` on reads |
| `lib/adapters/process-utils.ts` | `spawn` pattern for preview process | Mirror the `shell: false` spawn approach; or call `runChildProcess` if SSE-style logging of startup output is desired |
| `lib/adapters/process-manager.ts` | Module-level singleton registry pattern | `preview-process-manager.ts` follows the same Map-based singleton approach |
| `lib/file-serve.ts` | `resolveAssetPath` path-anchor guard | Replicate the `resolved.startsWith(safePrefix)` check for worktree-scoped file operations |
| `app/api/tasks/[taskId]/diff/route.ts` | DB lookup pattern (task → project → localPath → worktreeBranch) | Copy the Zod validation + DB query + fallback pattern for the new file routes |
| SSE `status_changed` event | Already emitted in `stream/route.ts` | `TaskPageClient` can use this to increment `fileTreeRefreshKey` without any server-side changes |
| `components/task/task-diff-view.tsx` | Entire component reused unchanged | Just render it as the Changes tab content instead of the current sole tab content |

### New External Dependencies

| Dependency | Version | Purpose | Integration |
|------------|---------|---------|-------------|
| `@monaco-editor/react` | ^4.x | Code editor component | Client Component, `dynamic()` import with `ssr: false` |

No other new external dependencies are needed. The preview iframe, file tree, and process management all use Node.js built-ins and existing patterns.

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `WorkbenchFilesPanel` ↔ API | Fetch GET/PUT `/api/tasks/[taskId]/files/*` | Relative paths only; never absolute filesystem paths on the wire |
| `WorkbenchPreviewPanel` ↔ API | Fetch POST/GET `/api/tasks/[taskId]/preview/*` | Command + port from UI controls |
| `previewProcessManager` ↔ API routes | Module-level Map singleton (same process) | Not persisted; survives hot-reload only if the module is not re-evaluated |
| `TaskPageClient` ↔ `WorkbenchFilesPanel` | `refreshKey: number` prop | Incremented on `status_changed` SSE event |
| `TaskPageClient` ↔ active tab state | `useState<"files"|"changes"|"preview">` | Tab bar rendered in right panel header |
| `WorkbenchEditor` ↔ `WorkbenchFileTree` | Selected file path via parent state in `WorkbenchFilesPanel` | Parent holds `selectedFile` state; tree fires `onFileSelect`; editor receives `filePath` |

## Suggested Build Order

The features have the following dependency graph:

```
Phase A: Route entry + tab bar skeleton (no deps)
    |
Phase B: File listing API + WorkbenchFileTree (depends on worktree path convention)
    |
Phase C: File content API + WorkbenchEditor/Monaco (depends on Phase B path pattern)
    |
Phase D: Files tab integration (tree + editor combined, depends on B + C)
    |
Phase E: Changes tab (reuse TaskDiffView in new tab bar, depends on Phase A)
    |
Phase F: Preview process manager + API + WorkbenchPreviewPanel (independent)
```

**Recommended phase breakdown:**

| Phase | Deliverable | Dependencies | Risk |
|-------|-------------|--------------|------|
| Phase A | "查看详情" entry in task drawer → task page route; expand tab bar to [Files][Changes][Preview] skeleton | None | Low |
| Phase B | File listing API route + `WorkbenchFileTree` component with lazy expansion | Worktree path convention (existing) | Low |
| Phase C | File content read/write API + `WorkbenchEditor` with Monaco (`ssr: false`) + `useFileContent` hook | Phase B (path anchor pattern) | Medium — Monaco SSR pitfall |
| Phase D | `WorkbenchFilesPanel` integrating tree + editor in a horizontal split | Phases B + C | Low |
| Phase E | Wire existing `TaskDiffView` as the Changes tab; remove old single-tab layout from `TaskPageClient` | Phase A | Low (pure reuse) |
| Phase F | `preview-process-manager.ts` + 3 preview API routes + `WorkbenchPreviewPanel` with iframe | None (independent) | Medium — child process lifecycle |

**Why this order:**

- Phases A through E build sequentially from routing to UI to editor, each independently testable and mergeable.
- Phase F is independent of Phases B-E and can run in parallel with Phases C-D if two developers are available, or be deferred to a separate sprint.
- The Monaco SSR issue (Phase C) is isolated to one component file — resolving it before integrating into the full panel (Phase D) keeps the integration step low-risk.
- Phase E is nearly free — it reuses `TaskDiffView` unchanged, just wires it into the new multi-tab layout instead of the current hardcoded single-tab rendering in `TaskPageClient`.

## Sources

- Codebase: `/src/app/api/tasks/[taskId]/diff/route.ts` — path anchor + worktree query pattern
- Codebase: `/src/app/api/tasks/[taskId]/stream/route.ts` — SSE + child process lifecycle pattern
- Codebase: `/src/lib/adapters/process-manager.ts` + `process-utils.ts` — singleton process registry + `spawn(shell: false)` pattern
- Codebase: `/src/lib/file-serve.ts` — path traversal protection (`startsWith(safePrefix)` guard)
- Codebase: `/src/lib/worktree.ts` — worktree path convention (`localPath/.worktrees/task-{taskId}`)
- Codebase: `/src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` — current 40/60 layout + SSE `status_changed` consumption
- [@monaco-editor/react npm](https://www.npmjs.com/package/@monaco-editor/react) — React wrapper, `ssr: false` requirement (HIGH confidence)
- [Next.js Turbopack Monaco issue #72613](https://github.com/vercel/next.js/issues/72613) — `ssr: false` is the stable workaround for both Turbopack and Webpack (MEDIUM confidence — known open issue)
- [Bolt.diy architecture — DeepWiki](https://deepwiki.com/stackblitz-labs/bolt.diy) — reference for preview iframe + file tree + editor panel layout pattern (MEDIUM confidence)

---
*Architecture research for: ai-manager v0.6 task development workbench*
*Researched: 2026-03-31*
