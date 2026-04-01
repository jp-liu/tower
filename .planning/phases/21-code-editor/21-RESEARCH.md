# Phase 21: Code Editor - Research

**Researched:** 2026-03-31
**Domain:** Monaco Editor integration in Next.js 16 App Router (Turbopack, React 19)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Use `@monaco-editor/react` (install `@monaco-editor/react@next` + `monaco-editor`) with CDN loader. Wrap in `dynamic({ ssr: false })` to avoid SSR crash. No webpack plugin — Turbopack incompatible.
- **D-02:** Extend `src/actions/file-actions.ts` with `readFile(worktreePath, relativePath)` returning file content string, and `writeFile(worktreePath, relativePath, content)` writing content to disk. Both path-validated via safeResolvePath from Phase 20.
- **D-03:** Local `useState` in the editor component with `openTabs` array. Each tab: `{ path: string, filename: string, content: string, isDirty: boolean }`. `activeTab` index tracks which tab is shown. Monaco model per tab via `monaco.editor.createModel()`.
- **D-04:** When clicking a file in the tree: if tab for that path exists, switch to it; otherwise open new tab, fetch content via `readFile`, create model.
- **D-05:** Use `useTheme()` from `next-themes` — map `resolvedTheme === "dark"` → Monaco theme `"vs-dark"`, else `"light"`. Updates automatically when user toggles theme.
- **D-06:** Ctrl+S / Cmd+S via Monaco's `editor.addAction()` — prevent browser default save dialog, call `writeFile` server action, clear dirty flag on success.
- **D-07:** Toast notification on save — "保存成功" / "File saved" via a lightweight toast. Keep it simple (div with setTimeout auto-dismiss), no toast library.
- **D-08:** Dirty indicator: dot before filename in tab header — `● filename.ts` when modified, plain `filename.ts` when clean. Track via `onDidChangeModelContent` Monaco event.

### Claude's Discretion

- Editor component file structure and naming
- Tab close button (X) behavior and UX
- Maximum number of open tabs (if any limit)
- Editor options (minimap, line numbers, word wrap settings)
- i18n key naming for editor-related strings

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ED-01 | 用户可在工作台中打开文件并查看语法高亮代码（Monaco Editor） | @monaco-editor/react CDN loader + dynamic import; language detection from file extension |
| ED-02 | 用户可通过 Ctrl+S 保存文件到 worktree 磁盘 | editor.addAction() with keybinding; new readFile/writeFile server actions; safeResolvePath validation |
| ED-03 | 编辑器显示未保存文件标记（dirty dot） | onDidChangeModelContent event → isDirty flag → ● prefix in tab header |
| ED-04 | 用户可同时打开多个文件标签页切换编辑 | openTabs useState array; Monaco model-per-tab pattern; activeTab index |
| ED-05 | 编辑器主题跟随 ai-manager 的 dark/light 设置 | useTheme() from next-themes (already installed); resolvedTheme → Monaco theme string |
</phase_requirements>

---

## Summary

Phase 21 integrates Monaco Editor into the workbench's Files tab, transforming the existing file tree (Phase 20) into a full editor experience. The Files tab layout changes from a single-panel file tree to a split view: file tree on the left, editor tabs on the right.

The core integration uses `@monaco-editor/react` (the `@next` tag installs the React 19-compatible version 4.7.0) loaded via CDN rather than webpack bundling. This avoids the known Turbopack/webpack worker incompatibility (GitHub issue #72613). The editor component must be wrapped in `dynamic({ ssr: false })` because Monaco accesses browser globals (`window`, `worker`) that are unavailable during Next.js server rendering.

Tab state is managed entirely in client-side React state with `useState`. Each open file gets a Monaco model created via `monaco.editor.createModel()`, and the active editor switches models rather than re-mounting the component. This is the performance-correct pattern — re-mounting causes editor flicker and loses cursor position. Two server actions (`readFile`, `writeFile`) extend the existing `file-actions.ts` using the already-established `safeResolvePath` security utility.

**Primary recommendation:** Keep the `MonacoEditor` wrapper component isolated as a single `"use client"` file dynamically imported in the Files tab. Wire state management up to `task-page-client.tsx` only through props (`openTabs`, `activeTab`, `onTabChange`, `onSave`).

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@monaco-editor/react` | 4.7.0 (`latest`) | React wrapper for Monaco Editor | Official React integration, CDN support, React 19 compatible |
| `monaco-editor` | 0.55.1 | Monaco editor core (peer dep) | Required by @monaco-editor/react for type resolution |
| `next-themes` | ^0.4.6 | Theme detection for editor theme sync | Already installed; `useTheme()` provides `resolvedTheme` |
| `next/dynamic` | (built-in) | SSR-skip wrapper | Required to prevent Monaco SSR crash |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | ^4.3.6 | Input validation for new server actions | Validate `readFile`/`writeFile` parameters (already used in file-actions.ts) |
| `fs/promises` | (Node built-in) | `readFile` / `writeFile` I/O | Server action implementations |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@monaco-editor/react` CDN | webpack MonacoWebpackPlugin | Webpack plugin is Turbopack-incompatible (issue #72613) — CDN is the correct choice |
| `@monaco-editor/react` | CodeMirror 6 | Decision locked; Monaco chosen for VS Code fidelity |
| Custom toast (div+setTimeout) | `sonner` / `react-hot-toast` | Decision locked; keep simple per D-07 |
| Local useState for tabs | Zustand | Local state is sufficient; Zustand already in deps but adds indirection |

**Installation:**
```bash
pnpm add @monaco-editor/react@next monaco-editor
```

**Version verification:** Verified via npm registry 2026-03-31.
- `@monaco-editor/react@next` resolves to 4.8.0-rc.3 (React 19 compatible)
- `@monaco-editor/react@latest` resolves to 4.7.0 (also React 19 compatible per README)
- `monaco-editor@latest` is 0.55.1

The `@next` tag is labeled as an RC. Given the project uses React 19.2.4 and `latest` (4.7.0) already states React V19 support, prefer `@monaco-editor/react@4.7.0` (pinned stable) over the RC. The decision in CONTEXT.md says "install `@monaco-editor/react@next`" — follow that, but verify it installs cleanly with React 19 peerDeps.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── actions/
│   └── file-actions.ts          # Add readFile + writeFile here (extends Phase 20 file)
├── components/
│   └── task/
│       ├── file-tree.tsx         # Phase 20 (unchanged)
│       ├── code-editor.tsx       # NEW: "use client" Monaco wrapper (dynamic-imported)
│       └── editor-tabs.tsx       # NEW: tab bar with dirty indicators (optional split)
└── app/
    └── workspaces/[workspaceId]/tasks/[taskId]/
        └── task-page-client.tsx  # Extend Files tab: tree + editor split layout
```

The component split into `code-editor.tsx` (Monaco logic) + optional `editor-tabs.tsx` (tab bar UI) keeps Monaco's 2MB+ bundle isolated from the tab bar rendering, but a single file is also acceptable since both are client-only.

### Pattern 1: Dynamic Import with SSR Disabled

**What:** Monaco accesses `window` and `Worker` on import. SSR will crash without this guard.
**When to use:** Always — Monaco is a client-only library.

```typescript
// In task-page-client.tsx or a dedicated wrapper
import dynamic from "next/dynamic";

const CodeEditor = dynamic(
  () => import("@/components/task/code-editor").then((m) => ({ default: m.CodeEditor })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);
```

Note: Per Next.js 16 docs (`lazy-loading.md`), `ssr: false` only works correctly when used inside a Client Component. `task-page-client.tsx` is already `"use client"`, so this is safe.

### Pattern 2: CDN Loader Configuration

**What:** Tell @monaco-editor/react to fetch monaco from CDN instead of bundled workers.
**When to use:** Required when webpack plugin is not configured (all Turbopack projects).

```typescript
// code-editor.tsx — call once at module level or in beforeMount
import { loader } from "@monaco-editor/react";

// Uses jsDelivr CDN by default; can pin a version:
loader.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs" } });
```

Calling `loader.config()` at module level (top of `code-editor.tsx`) ensures it runs once before any editor instance is created. Do NOT place inside a component body (runs on every render) or inside `beforeMount` only (may race with loader).

### Pattern 3: Model-Per-Tab with Editor Instance Reuse

**What:** Create one Monaco model per open file; switch which model the editor displays rather than re-mounting the editor.
**When to use:** Multi-tab editing — prevents flickering and preserves cursor/scroll state.

```typescript
// Inside onMount callback — store editor and monaco refs
const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
const monacoRef = useRef<Monaco | null>(null);

function handleEditorMount(editorInstance: editor.IStandaloneCodeEditor, monacoInstance: Monaco) {
  editorRef.current = editorInstance;
  monacoRef.current = monacoInstance;

  // Register Ctrl+S / Cmd+S save action
  editorInstance.addAction({
    id: "save-file",
    label: "Save File",
    keybindings: [
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
    ],
    run: () => {
      // Call save handler — prevent browser default (Monaco intercepts it)
      onSave();
    },
  });
}
```

```typescript
// When switching tabs: set model on existing editor instance
function switchToTab(tabIndex: number) {
  const tab = openTabs[tabIndex];
  if (editorRef.current && tab.model) {
    editorRef.current.setModel(tab.model);
  }
  setActiveTab(tabIndex);
}
```

```typescript
// When opening a new file: create model with language detection
async function openFile(absolutePath: string, relativePath: string) {
  const content = await readFile(worktreePath, relativePath);
  const language = getLanguageFromPath(relativePath); // see Pattern 5
  const model = monacoRef.current!.editor.createModel(content, language);

  // Track dirty state via content change event
  model.onDidChangeContent(() => {
    setOpenTabs((prev) =>
      prev.map((t) => (t.path === absolutePath ? { ...t, isDirty: true } : t))
    );
  });

  setOpenTabs((prev) => [...prev, { path: absolutePath, filename: basename(relativePath), content, isDirty: false, model }]);
  setActiveTab(openTabs.length);
}
```

### Pattern 4: Theme Sync

**What:** Mirror next-themes dark/light setting into Monaco's built-in theme names.
**When to use:** On mount and whenever resolvedTheme changes.

```typescript
import { useTheme } from "next-themes";
import { useEffect } from "react";

const { resolvedTheme } = useTheme();

useEffect(() => {
  if (monacoRef.current) {
    monacoRef.current.editor.setTheme(resolvedTheme === "dark" ? "vs-dark" : "light");
  }
}, [resolvedTheme]);
```

Alternatively, pass theme as `theme` prop to the `<Editor>` component — it accepts `"vs-dark"` | `"light"` | `"vs"`. The prop approach is simpler but reapplying it triggers a full theme re-initialization vs `setTheme()` which is instantaneous.

### Pattern 5: Language Detection from File Extension

**What:** Map file extensions to Monaco language IDs for syntax highlighting.
**When to use:** When creating a model for a new file tab.

```typescript
// Utility — no import needed, string manipulation only
function getLanguageFromPath(filePath: string): string {
  // Use string operations, NOT path.extname (path module is Node-only, banned in client components per Phase 20 decision)
  const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  const MAP: Record<string, string> = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript",
    json: "json", md: "markdown",
    css: "css", scss: "scss",
    html: "html", py: "python",
    rs: "rust", go: "go",
    sh: "shell", yaml: "yaml", yml: "yaml",
    prisma: "prisma", // Monaco has no built-in; falls back to plaintext
  };
  return MAP[ext] ?? "plaintext";
}
```

**Critical:** Do NOT use `path.extname()` or `path.basename()` in client components. Use string methods — this is an established Phase 20 decision (`path module removed from client components — use string manipulation for browser-compatible path operations`).

### Pattern 6: Lightweight Toast (No Library)

**What:** A self-dismissing div overlay for save confirmation.
**When to use:** After successful `writeFile` server action.

```typescript
// State in component
const [toastMessage, setToastMessage] = useState<string | null>(null);

// Show toast — auto-dismiss after 2s
function showToast(message: string) {
  setToastMessage(message);
  setTimeout(() => setToastMessage(null), 2000);
}

// JSX
{toastMessage && (
  <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-emerald-500/90 px-4 py-2 text-sm text-white shadow-lg z-50">
    {toastMessage}
  </div>
)}
```

### Pattern 7: Files Tab Split Layout

**What:** Horizontal split in the Files tab: file tree left (~240px), editor right (flex-1).
**When to use:** Phase 21 replaces the single-panel `FileTree` with a two-pane layout.

```tsx
// In task-page-client.tsx, inside TabsContent value="files"
<TabsContent value="files" className="flex-1 overflow-hidden">
  <div className="flex h-full">
    {/* File tree — fixed width or resizable */}
    <div className="w-60 shrink-0 border-r border-border overflow-auto">
      <FileTree ... onFileSelect={handleFileSelect} />
    </div>
    {/* Editor panel */}
    <div className="flex-1 flex flex-col overflow-hidden">
      <CodeEditor ... />
    </div>
  </div>
</TabsContent>
```

Option: use `react-resizable-panels` (already installed at ^2.1.9) for the tree/editor split — same component already used for the left/right workbench panels. This is at Claude's discretion.

### Anti-Patterns to Avoid

- **Re-mounting the Editor component on tab switch:** Causes flicker, loses cursor position, re-initializes keybindings. Use `setModel()` instead.
- **Using `path` module in client components:** Node.js `path` is not available in browsers. Use string methods (established Phase 20 pattern).
- **Calling `loader.config()` inside component body:** Runs on every render. Call at module level once.
- **Accessing `window` outside `useEffect` or `onMount`:** Monaco's dynamic import is async; `window` access before hydration throws in SSR even with `ssr: false` if the module is imported synchronously elsewhere.
- **Storing Monaco models in React state:** Models are mutable objects — storing in state causes unnecessary re-renders. Store in a `useRef` map instead: `modelsRef = useRef<Map<string, editor.ITextModel>>()`.
- **Forgetting model disposal:** When closing a tab, call `model.dispose()` to prevent memory leaks. Monaco models accumulate in memory if not disposed.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Syntax highlighting | Custom tokenizer | Monaco built-in language support (200+ languages) | Monaco ships complete grammar for all common languages |
| Keyboard shortcut handling | `keydown` event listener | `editor.addAction()` | Monaco intercepts keyboard events; `keydown` listeners miss shortcuts that Monaco captures first |
| Find/replace | Custom dialog | Monaco built-in (Ctrl+F / Ctrl+H) | Works out of the box; no implementation needed |
| Undo/redo | Custom history | Monaco model history | Model tracks undo stack per-file automatically |
| Language detection | File content sniffing | Extension mapping to Monaco language ID | Monaco language IDs are stable strings (typescript, javascript, json, etc.) |

**Key insight:** Monaco is a complete editor — most "features" are already there. The implementation work is integration (CDN loader, SSR bypass, React state for tabs, server actions for I/O), not editor feature building.

---

## Common Pitfalls

### Pitfall 1: SSR Crash — "window is not defined"

**What goes wrong:** Importing `@monaco-editor/react` or `monaco-editor` in a module that Next.js renders server-side throws `ReferenceError: window is not defined`.

**Why it happens:** Monaco imports web workers and browser globals at module load time. App Router renders all components on the server unless explicitly opted out.

**How to avoid:** Always use `dynamic(() => import("@/components/task/code-editor"), { ssr: false })`. The component itself can be `"use client"` — this is insufficient alone. `ssr: false` on the dynamic import is what prevents server execution.

**Warning signs:** Error during build or hydration mentioning `window`, `Worker`, or `document`. If you see these, the SSR guard is missing.

### Pitfall 2: Turbopack Worker Incompatibility (webpack plugin path)

**What goes wrong:** Using `MonacoWebpackPlugin` (the standard webpack approach for self-hosted Monaco workers) fails with Turbopack because Turbopack has its own module system and worker bundling strategy.

**Why it happens:** The project uses `next dev --turbopack` (see package.json scripts). MonacoWebpackPlugin is webpack-specific.

**How to avoid:** Use CDN loader (`loader.config({ paths: { vs: ... } })`) — no webpack plugin needed. Already decided in D-01.

**Warning signs:** Build errors mentioning `MonacoWebpackPlugin` not found, or workers returning 404 in network tab.

### Pitfall 3: Model Memory Leak on Tab Close

**What goes wrong:** Closing a tab without disposing its Monaco model leaves the model in memory indefinitely. After many file opens/closes, memory grows unboundedly.

**Why it happens:** Monaco models are not garbage-collected while the editor instance exists — they remain in Monaco's internal registry until `model.dispose()` is called.

**How to avoid:** On tab close, call `tab.model.dispose()` before removing the tab from `openTabs`. If the closed tab is the active one, switch to an adjacent tab first.

**Warning signs:** Memory usage creeping up after many file open/close cycles. DevTools memory profiler showing accumulating `TextModel` instances.

### Pitfall 4: Dirty State Race on Rapid Typing

**What goes wrong:** `onDidChangeModelContent` fires on every keystroke. If `isDirty` setState updates are synchronous with save operations, there's a window where a save completes but a final keystroke triggers `isDirty: true` again immediately after clearing it.

**Why it happens:** `writeFile` is async. Between the save call and the response, more keystrokes arrive.

**How to avoid:** Track a `isSaving` boolean. During save: set `isSaving: true`, await `writeFile`, then clear `isDirty` AND set `isSaving: false`. The `onDidChangeModelContent` handler should set `isDirty: true` only when `!isSaving`. Alternatively, compare model version after save: if model version matches the saved version, don't mark dirty.

**Warning signs:** Dirty dot reappears immediately after Ctrl+S even without typing.

### Pitfall 5: Missing `useEffect` Cleanup for Monaco Event Listeners

**What goes wrong:** `onDidChangeModelContent` subscriptions registered in effects or `onMount` callbacks accumulate if not disposed, causing stale closure bugs and multiple dirty-flag updates per keystroke.

**Why it happens:** Monaco event listeners return `IDisposable` objects. React effects must clean these up on unmount or dependency change.

**How to avoid:**
```typescript
useEffect(() => {
  const disposable = model.onDidChangeContent(() => { /* ... */ });
  return () => disposable.dispose();
}, [model]);
```

**Warning signs:** Dirty state updates doubling with each re-render; `isDirty` toggling unexpectedly.

### Pitfall 6: `readFile` Encoding — Binary Files

**What goes wrong:** Opening a binary file (image, compiled output) as UTF-8 text produces garbled output or throws. Monaco cannot meaningfully display binary content.

**Why it happens:** `fs.readFile(path, "utf-8")` interprets all bytes as UTF-8, which is incorrect for binary files.

**How to avoid:** In `readFile` server action, check file size first (< reasonable limit, e.g. 1MB). For the MVP, a simple size guard is sufficient — return an error string like `"[Binary file — cannot display]"` instead of content, and mark the tab as non-editable. Full binary detection is out of scope.

**Warning signs:** Monaco showing garbled text, encoding errors in console.

---

## Code Examples

Verified patterns based on @monaco-editor/react 4.7.0 API and Next.js 16 lazy loading docs:

### Full CodeEditor Component Shell

```typescript
// src/components/task/code-editor.tsx
"use client";

import { useRef, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { loader, Editor } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import type { Monaco } from "@monaco-editor/react";

// Configure CDN loader once at module level (D-01)
loader.config({
  paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs" },
});

export interface EditorTab {
  path: string;       // absolute path (key for deduplication)
  filename: string;   // display name in tab header
  content: string;    // initial content (model source of truth)
  isDirty: boolean;
  model?: editor.ITextModel;  // Monaco model reference (NOT in React state)
}

interface CodeEditorProps {
  worktreePath: string;
  openTabs: EditorTab[];
  activeTabIndex: number;
  onTabChange: (index: number) => void;
  onTabClose: (index: number) => void;
  onDirtyChange: (path: string, isDirty: boolean) => void;
  onSaveRequest: (path: string, content: string) => Promise<void>;
}

export function CodeEditor({
  worktreePath,
  openTabs,
  activeTabIndex,
  onTabChange,
  onTabClose,
  onDirtyChange,
  onSaveRequest,
}: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const modelsRef = useRef<Map<string, editor.ITextModel>>(new Map());
  const { resolvedTheme } = useTheme();

  // Theme sync (D-05)
  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(resolvedTheme === "dark" ? "vs-dark" : "light");
    }
  }, [resolvedTheme]);

  function handleMount(editorInstance: editor.IStandaloneCodeEditor, monacoInstance: Monaco) {
    editorRef.current = editorInstance;
    monacoRef.current = monacoInstance;

    // Ctrl+S / Cmd+S save action (D-06)
    editorInstance.addAction({
      id: "save-file",
      label: "Save File",
      keybindings: [monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS],
      run: () => {
        const activeTab = openTabs[activeTabIndex];
        if (!activeTab || !activeTab.model) return;
        void onSaveRequest(activeTab.path, activeTab.model.getValue());
      },
    });

    // Set initial theme
    monacoInstance.editor.setTheme(resolvedTheme === "dark" ? "vs-dark" : "light");
  }

  // Switch model when active tab changes (Pattern 3)
  useEffect(() => {
    const tab = openTabs[activeTabIndex];
    if (!tab || !editorRef.current || !monacoRef.current) return;

    let model = modelsRef.current.get(tab.path);
    if (!model) {
      const lang = getLanguageFromPath(tab.filename);
      model = monacoRef.current.editor.createModel(tab.content, lang);
      modelsRef.current.set(tab.path, model);

      // Track dirty state (D-08)
      const disposable = model.onDidChangeContent(() => {
        onDirtyChange(tab.path, true);
      });
      // Store disposable cleanup... (simplified here)
    }
    editorRef.current.setModel(model);
  }, [activeTabIndex, openTabs]);

  const activeTab = openTabs[activeTabIndex];

  if (openTabs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to open
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar (ED-04, ED-03) */}
      <div className="flex shrink-0 overflow-x-auto border-b border-border bg-background">
        {openTabs.map((tab, i) => (
          <div
            key={tab.path}
            onClick={() => onTabChange(i)}
            className={`flex min-w-0 cursor-pointer items-center gap-1 border-r border-border px-3 py-1.5 text-xs ${
              i === activeTabIndex
                ? "bg-background text-foreground"
                : "bg-muted/50 text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="truncate">
              {tab.isDirty ? `● ${tab.filename}` : tab.filename}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onTabClose(i); }}
              className="ml-1 rounded hover:bg-muted p-0.5 text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Monaco Editor (ED-01) */}
      <div className="flex-1 overflow-hidden">
        <Editor
          onMount={handleMount}
          theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            wordWrap: "off",
            scrollBeyondLastLine: false,
            automaticLayout: true,  // CRITICAL: resizes with container
          }}
        />
      </div>
    </div>
  );
}

// Language detection — string ops only, no path module (Phase 20 constraint)
function getLanguageFromPath(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const MAP: Record<string, string> = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript",
    json: "json", md: "markdown",
    css: "css", scss: "scss", less: "css",
    html: "html", xml: "xml",
    py: "python", rb: "ruby",
    rs: "rust", go: "go", java: "java",
    sh: "shell", bash: "shell",
    yaml: "yaml", yml: "yaml",
    toml: "ini", env: "plaintext",
    prisma: "plaintext",  // Monaco has no Prisma grammar built-in
  };
  return MAP[ext] ?? "plaintext";
}
```

### New Server Actions in file-actions.ts

```typescript
// Append to src/actions/file-actions.ts

// ---- readFileContent ----
const readFileContentSchema = z.object({
  worktreePath: z.string().min(1),
  relativePath: z.string().min(1),
});

export async function readFileContent(
  worktreePath: string,
  relativePath: string
): Promise<string> {
  readFileContentSchema.parse({ worktreePath, relativePath });
  const absolute = safeResolvePath(worktreePath, relativePath);
  return readFile(absolute, "utf-8");
}

// ---- writeFileContent ----
const writeFileContentSchema = z.object({
  worktreePath: z.string().min(1),
  relativePath: z.string().min(1),
  content: z.string(),
});

export async function writeFileContent(
  worktreePath: string,
  relativePath: string,
  content: string
): Promise<void> {
  writeFileContentSchema.parse({ worktreePath, relativePath, content });
  const absolute = safeResolvePath(worktreePath, relativePath);
  await writeFile(absolute, content, "utf-8");
}
```

Note: The existing `file-actions.ts` already imports `readFile` and `writeFile` from `fs/promises` — the new functions reuse these imports. Name the exported functions `readFileContent` / `writeFileContent` to avoid collision with the already-imported `readFile` / `writeFile` Node.js functions.

### Dynamic Import in task-page-client.tsx

```typescript
// At the top of task-page-client.tsx, with other imports
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const CodeEditor = dynamic(
  () => import("@/components/task/code-editor").then((m) => ({ default: m.CodeEditor })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);
```

### i18n Keys to Add

```typescript
// Add to both zh and en sections in src/lib/i18n.tsx
"taskPage.editor.selectFile": "选择文件以打开" / "Select a file to open",
"taskPage.editor.saved": "保存成功" / "File saved",
"taskPage.editor.saveFailed": "保存失败" / "Save failed",
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monaco via MonacoWebpackPlugin | Monaco via CDN loader | Turbopack adoption (2024) | No webpack config needed; workers loaded from CDN |
| `@monaco-editor/react@latest` for React 18 | `@monaco-editor/react@next` / 4.7.0+ for React 19 | 2025 | Peer dep constraint updated; `@next` tag ships React 19 compat |
| Editor re-mount on tab switch | `editor.setModel()` switching | Monaco v0.30+ | Instant tab switch, cursor position preserved |

**Deprecated/outdated:**
- `MonacoWebpackPlugin`: Still works for webpack builds, but not applicable here (Turbopack project).
- React 18 peerDep constraint on older `@monaco-editor/react` versions: resolved in 4.7.0+ / `@next`.

---

## Open Questions

1. **`@monaco-editor/react@next` vs `@latest` (4.7.0)**
   - What we know: `@next` is 4.8.0-rc.3 (RC status); `@latest` is 4.7.0 and already claims React 19 support. Context.md decision says "install `@monaco-editor/react@next`."
   - What's unclear: Whether 4.8.0-rc.3 has any known regressions vs 4.7.0 in production.
   - Recommendation: Install `@monaco-editor/react@next` as decided, but pin the exact version in package.json after installing to prevent surprise RC updates.

2. **`automaticLayout: true` performance with react-resizable-panels**
   - What we know: `automaticLayout: true` polls the editor container size every 100ms to handle resize. This is the standard approach.
   - What's unclear: Whether this interacts poorly with the panel resize handle during active drag.
   - Recommendation: Use `automaticLayout: true` by default. If resize jank is observed, switch to manual resize with a ResizeObserver on the container.

3. **Tab state location — local vs. lifted to task-page-client**
   - What we know: Context.md says "Local `useState` in the editor component" (D-03).
   - What's unclear: Whether `selectedFilePath` in `task-page-client.tsx` (which `FileTree.onFileSelect` already updates) needs to be the bridge, or if all tab state lives inside `CodeEditor`.
   - Recommendation: Keep `openTabs` state inside `CodeEditor` component. `task-page-client` passes `selectedFilePath` down as a prop; `CodeEditor` watches it with `useEffect` to trigger file open. This matches the existing `setSelectedFilePath` wiring in `task-page-client.tsx`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Server actions (readFileContent/writeFileContent) | Yes | v22.17.0 | — |
| pnpm | Package installation | Yes | (in project) | npm |
| `@monaco-editor/react` | ED-01–05 | Not installed | To be installed | — |
| `monaco-editor` | Peer dep of above | Not installed | To be installed | — |
| CDN (jsDelivr) | Monaco worker scripts at runtime | Requires network | cdn.jsdelivr.net | Could use unpkg.com |

**Missing dependencies with no fallback:**
- `@monaco-editor/react` and `monaco-editor` — must be installed before any editor code is written.

**Missing dependencies with fallback:**
- jsDelivr CDN — if blocked by network policy, can use `unpkg.com/monaco-editor@0.55.1/min/vs` as alternate CDN path in `loader.config()`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 + @testing-library/react 16.3.2 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm vitest run tests/unit/actions/file-actions.test.ts tests/unit/components/code-editor.test.tsx` |
| Full suite command | `pnpm vitest run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ED-01 | Monaco Editor renders when file selected | unit (component) | `pnpm vitest run tests/unit/components/code-editor.test.tsx` | No — Wave 0 |
| ED-02 | Ctrl+S triggers writeFileContent server action | unit (component) | same | No — Wave 0 |
| ED-03 | isDirty flag set on content change; dot shown in tab | unit (component) | same | No — Wave 0 |
| ED-04 | Opening multiple files creates multiple tabs; switching preserves content | unit (component) | same | No — Wave 0 |
| ED-05 | Theme prop switches to vs-dark / light | unit (component) | same | No — Wave 0 |
| ED-02 (server) | readFileContent validates path via safeResolvePath | unit (actions) | `pnpm vitest run tests/unit/actions/file-actions.test.ts` | Yes — extend existing |
| ED-02 (server) | writeFileContent validates path via safeResolvePath | unit (actions) | same | Yes — extend existing |

**Testing constraint for Monaco:** Monaco Editor itself cannot be meaningfully rendered in jsdom — the Canvas and Worker APIs are absent. Tests must mock `@monaco-editor/react`:

```typescript
// In test file header
vi.mock("@monaco-editor/react", () => ({
  Editor: vi.fn(({ onMount }) => {
    // Simulate onMount with stub editor/monaco instances
    onMount?.(mockEditor, mockMonaco);
    return <div data-testid="monaco-editor" />;
  }),
  loader: { config: vi.fn() },
}));
```

This means component tests verify the tab state logic, dirty tracking, and save callback invocation — not the actual Monaco rendering.

### Sampling Rate

- **Per task commit:** `pnpm vitest run tests/unit/actions/file-actions.test.ts tests/unit/components/code-editor.test.tsx`
- **Per wave merge:** `pnpm vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/components/code-editor.test.tsx` — covers ED-01 through ED-05 (component behavior with mocked Monaco)
- [ ] Extend `tests/unit/actions/file-actions.test.ts` — add `readFileContent` and `writeFileContent` test cases

---

## Project Constraints (from CLAUDE.md)

The project AGENTS.md states: "This is NOT the Next.js you know — This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code."

From reading `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`:
- `ssr: false` in `dynamic()` is the correct pattern for client-only components in App Router
- `ssr: false` only works correctly inside Client Components (confirmed — `task-page-client.tsx` is `"use client"`)
- Dynamic imports with `ssr: false` support a `loading` prop for Suspense fallback

Additional project constraints enforced across all files:
- No `console.log` in production code (TypeScript hooks rule)
- No mutation — use spread/immutable updates (applied to `setOpenTabs` map operations)
- Functions < 50 lines, files < 800 lines — split `CodeEditor` into smaller pieces if it grows large
- Zod validation on all server action inputs (already used in file-actions.ts — apply to new actions)
- No `path` module in client components (Phase 20 decision — use string manipulation)
- All file I/O via server actions, never client-side fs access

---

## Sources

### Primary (HIGH confidence)

- `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md` — `dynamic()` with `ssr: false` pattern, App Router lazy loading behavior
- `src/actions/file-actions.ts` — existing server action patterns, safeResolvePath usage
- `src/lib/fs-security.ts` — safeResolvePath implementation
- `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` — integration point, existing FileTree wiring
- `src/lib/i18n.tsx` — existing i18n pattern and key format
- `vitest.config.ts` + `tests/setup.ts` — test infrastructure
- `package.json` — confirmed: next-themes, react-resizable-panels, zod already installed; @monaco-editor/react NOT installed

### Secondary (MEDIUM confidence)

- npm registry: `@monaco-editor/react@4.7.0` (latest), `4.8.0-rc.3` (@next), `monaco-editor@0.55.1` — verified 2026-03-31
- @monaco-editor/react README (via WebFetch): React 19 support confirmed, CDN usage documented, `onMount`/`onChange` API confirmed

### Tertiary (LOW confidence)

- Monaco editor GitHub issue #72613 (Turbopack worker incompatibility) — referenced in STATE.md "Blockers/Concerns"; not directly verified by fetching issue, but CDN loader bypass is the project-confirmed safe fallback

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against npm registry; packages confirmed not installed
- Architecture: HIGH — patterns derived from existing codebase conventions + official Next.js docs
- Pitfalls: HIGH for SSR/Turbopack (project-documented in STATE.md); MEDIUM for memory/dirty-state pitfalls (based on Monaco API knowledge)
- Test mapping: HIGH — test infrastructure fully understood from existing test files

**Research date:** 2026-03-31
**Valid until:** 2026-05-01 (Monaco ecosystem is stable; @monaco-editor/react RC status warrants monitoring)
