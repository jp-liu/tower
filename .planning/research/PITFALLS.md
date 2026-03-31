# Pitfalls Research

**Domain:** Task development workbench — adding online code editor, file tree browser, diff view, and live preview to an existing Next.js 16 + React 19 + App Router application
**Researched:** 2026-03-31
**Confidence:** HIGH (verified against official Next.js 16 docs, Monaco Editor GitHub issues, React 19 release notes, Node.js fs/child_process docs, OWASP path traversal guides, and multiple community post-mortems)

---

## Critical Pitfalls

### Pitfall 1: Monaco Editor Breaks SSR — Missing `dynamic({ ssr: false })` Wrapper

**What goes wrong:**
Importing `@monaco-editor/react` or `monaco-editor` directly in a Server Component or even a Client Component without SSR-disabled dynamic import causes the build to fail with `window is not defined` or `navigator is not defined` at import time. Monaco references browser globals at the module level. The App Router pre-renders all Client Components on the server by default, so `"use client"` alone does not prevent the SSR execution path.

**Why it happens:**
Monaco was built for Electron/browser environments. Its top-level code accesses `window`, `document`, `navigator`, and `Worker`. These do not exist in the Node.js SSR environment. Developers assume `"use client"` means "client-only" but in Next.js 16 App Router, Client Components still execute on the server during initial render — the directive only marks the boundary for the client graph, not the execution environment for SSR.

**How to avoid:**
Wrap the editor component with `next/dynamic` and `ssr: false`, inside a dedicated Client Component file:

```typescript
// src/components/workbench/editor-panel.tsx
"use client"
import dynamic from "next/dynamic"

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react"),
  { ssr: false, loading: () => <div className="editor-skeleton" /> }
)
```

Never import `monaco-editor` directly at the top level of any file in the App Router tree.

**Warning signs:**
- Build error: `ReferenceError: window is not defined` or `self is not defined`
- Error originates inside `monaco-editor/esm/...` during `next build`
- Hydration errors on first render with Monaco-related stack traces

**Phase to address:**
Phase 1 (Code editor foundation). Establish the `dynamic({ ssr: false })` pattern as the very first step; all editor integration builds on top of this.

---

### Pitfall 2: Monaco Web Workers Fail to Load Under Turbopack

**What goes wrong:**
Monaco Editor requires web workers for language services (syntax highlighting, IntelliSense, validation). Under Next.js 16's default Turbopack bundler, the `monaco-editor-webpack-plugin` does not work — it is a Webpack-specific plugin. Without it, workers either fail silently (falling back to main-thread execution, causing UI freezes on large files) or throw `Could not create web worker(s)` at runtime. The Turbopack dynamic import of `monaco-editor/esm/vs/editor/editor.api` is also a known open issue as of early 2026.

**Why it happens:**
Turbopack does not support the full Webpack loader API. The Monaco editor webpack plugin registers custom loaders and resolves worker entry points via `MonacoEnvironment.getWorkerUrl`. Turbopack's loader support is limited to loaders that return JavaScript — CSS loaders and binary-transforming loaders are unsupported. The Monaco ESM migration (post-0.47) also changed workers to `module` workers, which the plugin's `getWorkerUrl` does not handle correctly in all bundler contexts.

**How to avoid:**
Three viable options, in priority order:

1. **Use `@monaco-editor/react` with CDN workers** (recommended for this use case): The `@monaco-editor/react` package defaults to loading Monaco from a CDN (`esm.sh` or `jsdelivr`) — no webpack plugin needed. Workers are loaded from the same CDN. This avoids the bundler problem entirely at the cost of a network request on first load.

2. **Opt out of Turbopack for development builds** that include the workbench route by configuring webpack fallback: `next.config.js` `webpack` option is still supported even when Turbopack is active for other routes. Scope the Monaco webpack plugin only to the workbench bundle.

3. **Disable Turbopack for the entire project** (`next dev --webpack`) if CDN loading is not acceptable and full Webpack control is required.

**Warning signs:**
- Console warning: `Could not create web worker(s). Falling back by loading the worker source in the main thread.`
- Editor becomes unresponsive while typing in large files (worker fell back to main thread)
- Build fails with Turbopack errors referencing `monaco-editor-webpack-plugin` loaders
- Open GitHub issue: [vercel/next.js #72613](https://github.com/vercel/next.js/issues/72613) — check its status before the implementation phase

**Phase to address:**
Phase 1 (Code editor foundation). Decide CDN vs. bundled workers before any language service work; changing this later breaks the editor worker configuration.

---

### Pitfall 3: Monaco Bundle Inflates Initial Page Load by 5-51 MB

**What goes wrong:**
Monaco Editor is 5–10 MB uncompressed. With language service workers bundled via Webpack, one project measured 51 MB raw bundle contribution (5 MB parsed+gzipped). Loading this on the initial workbench page load causes a multi-second blank editor state and inflates the JavaScript parse budget for the entire app — affecting Kanban pages that don't use the editor at all if the bundle is not properly code-split.

**Why it happens:**
Developers add Monaco to a component file that is imported in a shared layout or parent component, causing it to be included in the root JS chunk. Even when the editor file is lazy, importing it inside a component that is already eagerly loaded pulls Monaco into the initial bundle. The App Router does not automatically code-split nested dynamic imports if the parent component is part of a Server Component that renders on every request.

**How to avoid:**
1. Keep the entire workbench route (`/tasks/[taskId]`) isolated: it should be a separate Next.js page segment that is never shared with the Kanban layout. This ensures the Monaco bundle is only loaded when navigating to that route.
2. Use `@monaco-editor/react`'s CDN loader (`loader.config({ monaco })`) which defers the download entirely until the editor mounts.
3. Consider CodeMirror 6 as an alternative (300 KB core vs. 5 MB+ for Monaco) — it supports tree-shaking and modular language packs. Sourcegraph migrated from Monaco to CodeMirror and reported a 43% reduction in JS download size. For a task workbench where VSCode-level IntelliSense is not required, CodeMirror 6 is the better fit.

**Warning signs:**
- `@next/bundle-analyzer` shows `monaco-editor` in the main or shared JS chunk
- Initial page load for the Kanban board gets slower after adding the workbench route
- Lighthouse JS bundle size warnings appear on non-workbench pages

**Phase to address:**
Phase 1 (Code editor foundation). Run `@next/bundle-analyzer` immediately after integrating the editor to verify isolation.

---

### Pitfall 4: File System API Routes Without Path Traversal Hardening Expose the Host Filesystem

**What goes wrong:**
The workbench needs API routes to read, write, and list files in the project's `localPath`. If the `filePath` parameter is passed directly to `fs.readFile` or `path.join(localPath, filePath)` without validation, an attacker (or a misconfigured client) can supply `../../etc/passwd` or `../../../.env` to read arbitrary files on the host system. For a localhost-only tool this is lower severity — but it remains a real risk if the user's browser has a malicious extension or if the tool is ever accidentally exposed on a local network.

**Why it happens:**
`path.normalize` and `path.join` resolve `..` components but do not prevent traversal outside the root. A path like `localPath + "/../../../.env"` after `path.normalize` still resolves to a path outside `localPath`. `path.basename` alone is insufficient because it strips directory components, losing the directory structure needed for the file tree. The existing `uploadAsset` action in this codebase already uses `path.basename` + DB validation — the file tree needs a different, stricter check.

**How to avoid:**
Always verify that the resolved path starts with the allowed root after normalization:

```typescript
import path from "path"

function safeResolvePath(root: string, userPath: string): string {
  const resolved = path.resolve(root, userPath)
  if (!resolved.startsWith(path.resolve(root) + path.sep) &&
      resolved !== path.resolve(root)) {
    throw new Error("Path traversal attempt detected")
  }
  return resolved
}
```

Apply this guard to every filesystem API route: read file, write file, list directory, watch path. Never pass `userPath` directly to `fs.*` methods.

**Warning signs:**
- Any API route that constructs a file path by concatenating `localPath` + user-supplied string without a `startsWith` check
- `path.normalize` used as the only sanitization step (insufficient — see OWASP path traversal)
- URL-encoded paths like `%2e%2e%2f` accepted by the route without decoding before normalization

**Phase to address:**
Phase 2 (File tree browser). Implement `safeResolvePath` as a shared utility in `src/lib/fs-security.ts` before the first file read endpoint. All file API routes import this; none perform raw `path.join` with user input.

---

### Pitfall 5: Live Preview Subprocess Leaks Processes on Workbench Close or Task Navigation

**What goes wrong:**
The Preview panel starts a user-defined dev server (e.g., `npm run dev`) as a child process from a Next.js Route Handler or Server Action. When the user navigates away, closes the browser tab, or the Next.js dev server hot-reloads, the spawned subprocess continues running. On repeated opens of the same workbench, a new subprocess is spawned on a different port, leaving the old one orphaned. After several sessions, multiple dev servers are running simultaneously, consuming ports and RAM, and conflicting with each other (EADDRINUSE).

**Why it happens:**
Node.js child processes spawned with `child_process.spawn` do not automatically die when the parent connection closes. HTTP Route Handlers in Next.js have no lifecycle hooks for "client disconnected" or "route unmounted." The SSE connection drop (if using SSE to stream subprocess output) does trigger an `abortController` signal, but only if the route was set up to listen for it. Without `process.on('exit')` cleanup or a process registry, zombies accumulate.

**How to avoid:**
1. Maintain a server-side process registry (a `Map<taskId, ChildProcess>`) in a module-level singleton on the Node.js server. One subprocess per `taskId` maximum.
2. Before spawning, check if a process for this `taskId` already exists and is running — reuse it.
3. Listen on `AbortSignal` from the Route Handler: `request.signal.addEventListener('abort', () => subprocess.kill())`.
4. Register a `process.on('SIGTERM')` + `process.on('exit')` handler in the singleton to kill all tracked subprocesses on Next.js shutdown.
5. Expose a `POST /api/workbench/preview/stop` endpoint so the client can explicitly stop the server on workbench close (call from a `beforeunload` handler or a stop button).

**Warning signs:**
- `lsof -i :3001` shows multiple node processes after opening/closing the workbench several times
- Preview panel shows "port already in use" error on the second open
- Memory usage of the Next.js process grows linearly with workbench sessions

**Phase to address:**
Phase 4 (Preview panel). Implement the process registry singleton on day one of this phase — do not add it later as a fix.

---

### Pitfall 6: Preview iframe Without Proper CSP and Sandbox Allows Script Execution in Parent Context

**What goes wrong:**
The live preview iframe loads `http://localhost:PORT` — the user's running dev server. If the dev server serves a page that sets `document.domain` or uses `postMessage` to communicate, and the iframe's `sandbox` attribute is missing or too permissive, the embedded app can access the parent window's DOM, steal session-like data from `localStorage`, or trigger navigation in the parent frame. This is particularly relevant because the parent app also runs on `localhost`.

**Why it happens:**
Same-origin restrictions are relaxed between pages on `localhost` — `http://localhost:3000` (ai-manager) and `http://localhost:3001` (preview target) share the same hostname. The `sandbox` attribute without `allow-same-origin` prevents access, but with it enabled (often needed for form submissions and localStorage in the preview), the same-origin bypass is re-enabled. Developers frequently use `sandbox="allow-scripts allow-same-origin allow-forms"` without understanding the implications.

**How to avoid:**
For a localhost developer tool where the user controls both sides, an acceptable configuration is:
```html
<iframe
  src="http://localhost:PORT"
  sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
  referrerpolicy="no-referrer"
  title="Live Preview"
/>
```

Document clearly that `allow-same-origin` is included because the preview app needs localStorage/cookies, but mitigated because this is a single-user localhost tool. Do NOT expose this configuration if the tool ever moves to a network-accessible server.

Additionally, add a Next.js response header for the main app to prevent itself from being framed by unknown origins:
```
Content-Security-Policy: frame-ancestors 'self' http://localhost:*
```

**Warning signs:**
- iframe `sandbox` attribute is absent entirely
- Preview page can call `window.parent.location.href = "..."` and redirect the main app
- Console shows no `sandbox` violations when the preview page tries to access `window.parent`

**Phase to address:**
Phase 4 (Preview panel). Document the sandbox decision in a code comment; include a security audit step in the phase verification.

---

### Pitfall 7: SSE Streaming for Subprocess Output Conflicts with Next.js Route Handler Buffering

**What goes wrong:**
The Preview panel needs to stream dev server output (stdout/stderr) to the browser in real time. The existing SSE implementation in this project (for Claude CLI execution) uses `ReadableStream` in Route Handlers. Adding a second SSE stream for subprocess output while an execution SSE stream is active can cause the Next.js edge runtime or Node.js HTTP server to buffer responses, delay chunks, or fail to flush — resulting in the output appearing in bursts rather than line-by-line.

**Why it happens:**
Next.js 16 App Router Route Handlers in Node.js runtime support streaming via `ReadableStream`. However, when multiple long-lived SSE connections are open simultaneously (one for Claude execution, one for preview output), they share the same Node.js HTTP server. If response compression (gzip) is enabled, Node.js may buffer small chunks before sending — breaking the real-time feel of SSE. Additionally, if the Route Handler uses `Response` with `Transfer-Encoding: chunked` but the reverse proxy (if any) between the browser and Next.js buffers responses, chunks are held.

**How to avoid:**
1. Set `Cache-Control: no-cache` and `X-Accel-Buffering: no` headers on all SSE responses to prevent proxy buffering.
2. Ensure the subprocess output stream uses `\n\n` line endings (SSE spec requires double newline between events).
3. Use the existing SSE pattern from the Claude execution adapter — do not invent a new streaming mechanism. Reuse `src/lib/sse.ts` or equivalent.
4. Test with two simultaneous SSE connections (execution + preview) to verify neither starves the other.
5. Use `controller.enqueue` with `TextEncoder` rather than manual string concatenation to avoid encoding bugs.

**Warning signs:**
- Preview terminal output arrives in large bursts rather than line-by-line
- Opening the Preview panel while a Claude execution is running causes one of the streams to freeze
- `Content-Type: text/event-stream` header is present but chunks are delayed by 5-10 seconds

**Phase to address:**
Phase 4 (Preview panel). Test SSE coexistence explicitly; add a concurrent test case to the Playwright suite.

---

### Pitfall 8: File Tree with Large Projects Renders Thousands of DOM Nodes, Freezing the UI

**What goes wrong:**
A typical project directory (`localPath`) may contain `node_modules` with 50,000+ files. Rendering the file tree naively (recursive `<ul><li>` for every entry) will freeze the browser tab for several seconds on first mount. Even without `node_modules`, a medium-sized Next.js project has 200-500 source files across nested directories.

**Why it happens:**
The React reconciler must create a DOM node for every visible list item. Without virtualization, rendering 500 items synchronously in React 19 still blocks the main thread for 100-200ms at minimum. Recursive tree components also tend to trigger cascading re-renders on any state change (file selection, expansion) across the entire tree.

**How to avoid:**
1. **Always exclude `node_modules`, `.git`, `dist`, `.next`** from the file listing by default — configure an exclusion list in the API that performs the directory scan.
2. **Implement lazy expansion**: only fetch directory contents when a directory node is expanded (API call per expand, not full tree on load).
3. **Virtualize the tree list** using `react-window` or `@tanstack/virtual` once the flattened visible node list exceeds 100 items.
4. Cap the API response at 500 entries per directory and show a "too many files" warning for the rest.

**Warning signs:**
- File tree API returns the contents of `node_modules` without filtering
- First mount of the file tree component causes a 2+ second React render (visible in React DevTools profiler)
- Expanding a directory triggers a re-render of the entire tree component

**Phase to address:**
Phase 2 (File tree browser). Implement server-side exclusion list and lazy expansion before any virtualization work — these eliminate most of the problem without library overhead.

---

### Pitfall 9: Editor State Not Cleaned Up — Monaco Model Accumulation Causes Memory Leaks

**What goes wrong:**
Monaco Editor stores each open file as a `monaco.editor.ITextModel`. When the user opens 20 files in the workbench session (by clicking in the file tree), 20 models accumulate in Monaco's internal registry. When the React component unmounts (tab navigation, route change), the editor instance is disposed but the underlying text models are not — they remain in memory indefinitely. On long workbench sessions with many file opens, this causes steadily growing memory usage and eventually sluggish editor performance.

**Why it happens:**
`@monaco-editor/react`'s `Editor` component calls `editor.dispose()` on unmount, which disposes the editor view but not the associated `ITextModel`. Models must be explicitly disposed via `model.dispose()`. The library's documentation does not prominently highlight this distinction. The diff editor has an additional known bug where `Emitter` and `InteractionEmitter` objects are not disposed when the diff editor is disposed, causing further leaks (see Monaco issue #4659).

**How to avoid:**
```typescript
// Track all created models
const modelCache = new Map<string, monaco.editor.ITextModel>()

function getOrCreateModel(uri: string, content: string, language: string) {
  const existing = monaco.editor.getModel(monaco.Uri.parse(uri))
  if (existing) return existing
  const model = monaco.editor.createModel(content, language, monaco.Uri.parse(uri))
  modelCache.set(uri, model)
  return model
}

// On workbench unmount
function disposeAllModels() {
  modelCache.forEach(model => model.dispose())
  modelCache.clear()
}
```

Call `disposeAllModels()` in the `useEffect` cleanup of the workbench page component. Limit the model cache to the last 10 opened files (LRU eviction) to bound memory during long sessions.

**Warning signs:**
- Browser Task Manager shows the workbench tab memory growing by ~5 MB per 10 files opened
- `monaco.editor.getModels().length` in the console grows unboundedly across file navigation
- Editor becomes slower after 30+ file opens in one session

**Phase to address:**
Phase 3 (Editor file navigation). Implement model cache with LRU eviction and cleanup on mount; verify with `monaco.editor.getModels().length` in end-to-end tests.

---

### Pitfall 10: React 19 `useEffect` Double-Invocation Breaks Subprocess Singleton Registry

**What goes wrong:**
React 19 in Strict Mode (which Next.js 16 enables in development) double-invokes effects and their cleanup functions. A workbench component that starts a preview subprocess in `useEffect` will spawn two subprocesses in development — one for the initial mount, killed by cleanup, and a second for the re-mount. If the process registry singleton tracks by `taskId`, the first process gets registered and killed (cleanup), but the second registration may race with the cleanup of the first, leaving the registry in an inconsistent state with a stale PID.

**Why it happens:**
React 19 Strict Mode mounts → unmounts → remounts every component on development load to surface side-effect bugs. The subprocess spawn is a side effect. The cleanup function must correctly kill the previous process before the second mount starts a new one. If the kill is async (SIGTERM + wait) and the second spawn fires before the kill completes, two processes share the same `taskId` key in the registry.

**How to avoid:**
1. Do not start the preview subprocess from a client-side `useEffect`. Instead, start it via an explicit user action (a "Start Preview" button that calls a Server Action or Route Handler).
2. The Route Handler uses the server-side process registry (a Node.js module singleton) — React Strict Mode's double-invoke does not affect server-side code.
3. If a client `useEffect` must be used for any subprocess-related logic, always check `isMounted` and use a `useRef` cancellation flag to handle the Strict Mode re-mount.

**Warning signs:**
- Two dev server processes appear in `ps aux` after clicking "Start Preview" once in development
- Console shows "subprocess already running" error on first start in development
- Process registry Map has the same `taskId` key twice (impossible if Map — symptoms appear as port conflicts)

**Phase to address:**
Phase 4 (Preview panel). Architect subprocess control as server-side only from the start; never trigger subprocess spawn from a client-side effect.

---

### Pitfall 11: `fs.watch` / Chokidar inotify Limits Exhaust System File Watchers

**What goes wrong:**
If the file tree uses real-time file watching (to reflect changes made by Claude CLI in the worktree), and it watches the entire project directory recursively, the OS inotify limit (`fs.inotify.max_user_watches`) may be exhausted. On Linux, the default limit is 8,192 watches. A medium project with `node_modules` has 100,000+ files. Exhausting inotify causes `ENOSPC` errors (confusingly "no space left" despite disk space being available), breaks all file watching system-wide (including Next.js HMR), and may crash the development server.

**Why it happens:**
`chokidar` and Node.js `fs.watch` use one inotify watch per file/directory on Linux. Recursively watching a project directory without excluding `node_modules` and `.git` uses thousands of watches. When the ai-manager Next.js dev server is also running (which uses chokidar internally for HMR), the combined watch count easily exceeds the default limit.

**How to avoid:**
1. **Do not recursively watch the project directory**. Instead, poll the directory listing on demand (user triggers refresh) or watch only the opened files and their immediate parent directories.
2. If reactive watching is required, scope it tightly: watch only `src/`, `app/`, `pages/` — configurable patterns, not the full `localPath`.
3. Always pass `ignored: /(^|[\/\\])\.\.|node_modules/` to chokidar.
4. Use chokidar's `awaitWriteFinish` option to debounce rapid file change events from Claude's batch writes.

**Warning signs:**
- `ENOSPC: System limit for number of file watchers reached` error in server logs
- Next.js HMR stops working after the workbench is opened
- `cat /proc/sys/fs/inotify/max_user_watches` is below 50,000 on the host machine

**Phase to address:**
Phase 2 (File tree browser). Decide on polling vs. watching before implementation; default to polling with a manual refresh button rather than reactive watching.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip `ssr: false` for Monaco and add `"use client"` only | Faster initial implementation | Build fails immediately — no benefit whatsoever | Never |
| Use CDN-loaded Monaco without bundle analyzer verification | No webpack config needed | Cannot verify isolation; may still inflate unrelated chunks | Only in Phase 1 spike; must verify before Phase 1 complete |
| Render full flat file tree without lazy expansion | Simpler tree component | Freezes on any project with >200 files or `node_modules` present | Never in production |
| No path traversal guard on file read/write API | Simpler API handler | Arbitrary file read on host system via `../` traversal | Never |
| Spawn preview subprocess without process registry | Quick implementation | Zombie processes accumulate; EADDRINUSE on second open | Never |
| Use `Promise.all` for file tree + editor load | Slightly faster | Single FS error drops everything silently | Never — use `Promise.allSettled` |
| Disable Monaco Diff editor cleanup | No unmount logic needed | Memory leak grows with every diff view open | Never — always dispose diff editor models |
| Watch full project directory with chokidar | See all file changes | inotify exhaustion kills Next.js HMR system-wide | Never — scope watches tightly |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Monaco + Next.js App Router | Import at top level of any component | `next/dynamic({ ssr: false })` wrapper — mandatory, no exceptions |
| Monaco + Turbopack | Use `monaco-editor-webpack-plugin` | Use CDN loader (`@monaco-editor/react` default) or disable Turbopack for the workbench route |
| Monaco + React 19 | Use `react-monaco-editor` (React 18 only) | Use `@monaco-editor/react@next` (v4.7.0-rc supports React 19) |
| Monaco Diff Editor + unmount | Call `editor.dispose()` only | Also call `model.dispose()` on both original and modified models |
| File tree + large projects | Fetch entire `localPath` recursively | Server-side exclusions (`node_modules`, `.git`, `dist`, `.next`) + lazy directory expansion |
| File write + concurrent Claude execution | Write directly while Claude is modifying the same file | Show a warning if Claude execution is `IN_PROGRESS` on the task; lock file for writing |
| Preview subprocess + Route Handler | Start subprocess on GET request | Only start on explicit POST; track with server-side Map singleton |
| Preview iframe + same-origin localhost | No sandbox attribute | `sandbox="allow-scripts allow-forms allow-same-origin allow-popups"` with documented rationale |
| SSE subprocess output + existing Claude SSE | Invent new streaming mechanism | Reuse existing `ReadableStream` SSE pattern from `src/lib/sse.ts` |
| Chokidar file watcher + full project directory | Watch `localPath` recursively without exclusions | Scope to `src/`, `app/` only; default to polling |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Monaco loaded on first workbench open from CDN | 2-5 second blank editor while Monaco JS downloads | Pre-warm CDN cache with `<link rel="preload">` or use service worker caching | On every first visit, noticeable on slow connections |
| File tree re-renders entire tree on single node expand | Expansion becomes sluggish after 50+ nodes | Memoize individual tree nodes; use `useCallback` for expand handlers | At ~100+ visible nodes |
| Monaco model accumulation without LRU eviction | Memory grows ~2 MB per file opened | LRU cache with max 10 models; dispose evicted models | After 20+ file opens in one session |
| Recursive directory listing without depth limit | API hangs for projects with deep nested directories | Limit API to 3 levels depth maximum; lazy-load deeper levels | Immediately for projects with `node_modules` |
| Preview subprocess output not line-buffered | Terminal shows output in large bursts | Set `stdio: ['pipe', 'pipe', 'pipe']`; use `readline` to emit line events | Always without proper line buffering |
| Chokidar watching 50K+ files | inotify exhausted; HMR broken | Tight scope + exclusions; prefer polling for workbench | On Linux with default inotify limits |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| File read/write API without `safeResolvePath` | Arbitrary file read/write on host system via `../` | `path.resolve` + `startsWith(root + sep)` check on every FS operation |
| Preview subprocess command from user input without validation | Command injection — user runs arbitrary shell commands | Validate command against allowlist; use `execFileSync`/`spawn` with array args (not shell string); this project already uses `execFileSync` for git — same pattern |
| iframe without `sandbox` attribute | Preview page can redirect parent window | Always set `sandbox` attribute; document the permissions granted |
| Dev server proxy without origin validation | SSRF — proxy forwards requests to internal services | Restrict proxy target to `localhost` only; reject non-localhost targets |
| File write without checking task execution state | Race condition — AI and user overwrite each other's changes | Check `TaskExecution.status`; warn if `IN_PROGRESS`; never silently overwrite |
| Expose `localPath` directly in API responses | Reveals full host filesystem path to the browser | Only return relative paths in file tree responses; `localPath` is a server-side-only concept |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No loading skeleton for Monaco | Blank white rectangle while editor loads (1-5 seconds) | Show a code-colored skeleton or "Loading editor..." placeholder via `dynamic` `loading` prop |
| File tree shows no indication that Claude is editing a file | User opens the same file in the editor — race condition with AI writes | Show a "being modified by AI" indicator on files currently being written by the Claude execution |
| Preview iframe shows a blank page when dev server not started | Confusing — looks like the preview is broken | Show an explicit "Dev server not running — click Start to launch" state before spawning |
| Preview subprocess failure output hidden | User cannot diagnose why the preview is not working | Stream stderr to the Preview terminal panel alongside stdout |
| Editor saves overwrite worktree files without confirmation | User accidentally undoes Claude's work | Explicit Save button (not auto-save); confirm dialog if the file was modified by Claude after the editor opened it |
| File tree does not reflect Claude's file additions after execution | Stale tree shows old file list | Manual Refresh button in file tree header; optionally, auto-refresh when task execution transitions to `IN_REVIEW` |

---

## "Looks Done But Isn't" Checklist

- [ ] **Monaco SSR:** Run `next build` — verify no `window is not defined` errors in the build output
- [ ] **Monaco bundle isolation:** Run `@next/bundle-analyzer` — verify `monaco-editor` does not appear in the main or Kanban route JS chunk
- [ ] **Monaco workers:** Open the editor with a TypeScript file — verify IntelliSense (hover type info) works, indicating workers loaded correctly
- [ ] **Path traversal:** Call the file read API with `filePath: "../../.env"` — verify HTTP 400 is returned, not file contents
- [ ] **Process leak:** Open Preview, start dev server, navigate to Kanban, navigate back — verify only ONE process per `taskId` in `ps aux`
- [ ] **Process leak:** Close browser tab while preview running — verify subprocess is killed within 30 seconds
- [ ] **inotify safety:** If file watching is used, verify `cat /proc/sys/fs/inotify/max_user_watches` is not exhausted after opening the workbench on a large project
- [ ] **Memory leak:** Open 25 files in the editor — run `monaco.editor.getModels().length` in console — verify it does not exceed the LRU cache limit
- [ ] **SSE coexistence:** Start Claude execution (SSE stream 1) then open Preview panel (SSE stream 2) — verify both streams receive data simultaneously
- [ ] **iframe sandbox:** Verify the preview iframe has a `sandbox` attribute; attempt `window.parent.location = "http://evil.com"` from preview console — should be blocked
- [ ] **Large project file tree:** Open the workbench on a Next.js project with `node_modules` — verify `node_modules` is excluded from the tree and the tree renders without freezing
- [ ] **React Strict Mode subprocess:** In development, click "Start Preview" once — verify only ONE subprocess spawns (not two)
- [ ] **i18n:** All workbench UI labels (Start Preview, Stop, Refresh, Save) have both `zh` and `en` translations

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Monaco SSR build failure | LOW | Add `dynamic({ ssr: false })` wrapper; rebuild |
| Monaco Turbopack worker failure | MEDIUM | Switch to CDN loader (`@monaco-editor/react` default config); test workers in browser console |
| Zombie subprocess accumulation | LOW | Kill processes manually with `pkill -f "task/"` pattern; then implement registry |
| inotify limit exhausted | LOW | `echo 65536 | sudo tee /proc/sys/fs/inotify/max_user_watches`; scope watchers more tightly in code |
| Memory leak from Monaco model accumulation | MEDIUM | Implement LRU model cache; refresh page as immediate workaround |
| Path traversal vulnerability discovered | HIGH | Immediately add `safeResolvePath` guard; audit all FS API routes; rotate any exposed secrets |
| Preview subprocess not cleaning up on crash | MEDIUM | Implement `process.on('exit')` registry cleanup; test with `kill -9` on the Next.js process |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Monaco SSR (`window is not defined`) | Phase 1: Code editor foundation | `next build` succeeds without SSR errors |
| Monaco Turbopack worker failure | Phase 1: Code editor foundation | IntelliSense works in browser dev tools |
| Monaco bundle inflation | Phase 1: Code editor foundation | `bundle-analyzer` shows Monaco only in workbench route chunk |
| File tree large project freeze | Phase 2: File tree browser | File tree renders in <1s on project with `node_modules` (excluded) |
| Path traversal on file API | Phase 2: File tree browser | `../` path returns HTTP 400; verified with curl |
| Monaco model memory leak | Phase 3: Editor file navigation | `monaco.editor.getModels().length` bounded by LRU limit after 25 file opens |
| inotify limit exhaustion | Phase 2: File tree browser | Decision documented: polling vs. watching; watchers scoped if used |
| Preview subprocess leak | Phase 4: Preview panel | Single subprocess per task; cleaned up on workbench close |
| Preview iframe sandbox | Phase 4: Preview panel | `sandbox` attribute present; `window.parent` access blocked from preview |
| SSE coexistence | Phase 4: Preview panel | Two simultaneous SSE connections verified in Playwright test |
| React Strict Mode double-spawn | Phase 4: Preview panel | Single subprocess on "Start Preview" in development mode |

---

## Sources

- [Next.js App Router — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — `"use client"` does not disable SSR pre-rendering
- [Next.js Lazy Loading Guide](https://nextjs.org/docs/pages/guides/lazy-loading) — `dynamic({ ssr: false })` for browser-only components
- [Next.js Turbopack issue #72613 — Monaco Editor dynamic import](https://github.com/vercel/next.js/issues/72613) — known open issue as of early 2026
- [Next.js Version 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) — Turbopack is now default for `next dev`
- [`@monaco-editor/react` npm — React 19 RC](https://www.npmjs.com/package/@monaco-editor/react) — v4.7.0-rc.0 for React 19
- [Monaco Editor issue #4659 — Diff editor memory leak](https://github.com/microsoft/monaco-editor/issues/4659) — Emitter not disposed on diff editor dispose
- [Monaco Editor issue #1693 — Memory leakage](https://github.com/microsoft/monaco-editor/issues/1693) — models not disposed on editor unmount
- [Sourcegraph blog — Migrating from Monaco to CodeMirror](https://sourcegraph.com/blog/migrating-monaco-codemirror) — 43% JS size reduction
- [Replit blog — Betting on CodeMirror](https://blog.replit.com/codemirror) — CodeMirror 6 architecture rationale
- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal) — prevention: resolve then startsWith check
- [StackHawk — Node.js Path Traversal Guide](https://www.stackhawk.com/blog/node-js-path-traversal-guide-examples-and-prevention/) — `path.normalize` alone is insufficient
- [MDN — CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors) — iframe clickjacking prevention
- [chokidar GitHub — inotify limits](https://github.com/facebook/create-react-app/issues/7612) — ENOSPC when watching large directories
- [Monaco webpack plugin issue #42 — Cross-origin worker failure](https://github.com/microsoft/monaco-editor-webpack-plugin/issues/42)
- [Next.js GitHub discussion #48427 — SSE in App Router Route Handlers](https://github.com/vercel/next.js/discussions/48427)

---
*Pitfalls research for: Task development workbench (v0.6) — online code editor, file tree, diff view, live preview*
*Researched: 2026-03-31*
