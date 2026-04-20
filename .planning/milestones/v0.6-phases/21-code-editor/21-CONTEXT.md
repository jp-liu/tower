# Phase 21: Code Editor - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the Monaco Editor integration for the workbench Files tab. Five capabilities: (1) clicking a file in the tree opens it in Monaco with syntax highlighting, (2) Ctrl+S saves to disk via writeFile server action with toast feedback, (3) unsaved files show a dirty dot indicator on their tab, (4) multi-tab editing with tab switching preserving unsaved edits, (5) editor theme follows ai-manager's dark/light setting.

</domain>

<decisions>
## Implementation Decisions

### Monaco Editor Integration
- **D-01:** Use `@monaco-editor/react` (install `@monaco-editor/react@next` + `monaco-editor`) with CDN loader. Wrap in `dynamic({ ssr: false })` to avoid SSR crash. No webpack plugin — Turbopack incompatible.
- **D-02:** Extend `src/actions/file-actions.ts` with `readFile(worktreePath, relativePath)` returning file content string, and `writeFile(worktreePath, relativePath, content)` writing content to disk. Both path-validated via safeResolvePath from Phase 20.

### Tab State Management
- **D-03:** Local `useState` in the editor component with `openTabs` array. Each tab: `{ path: string, filename: string, content: string, isDirty: boolean }`. `activeTab` index tracks which tab is shown. Monaco model per tab via `monaco.editor.createModel()`.
- **D-04:** When clicking a file in the tree: if tab for that path exists, switch to it; otherwise open new tab, fetch content via `readFile`, create model.

### Theme Sync
- **D-05:** Use `useTheme()` from `next-themes` — map `resolvedTheme === "dark"` → Monaco theme `"vs-dark"`, else `"light"`. Updates automatically when user toggles theme.

### Save & Dirty State
- **D-06:** Ctrl+S / Cmd+S via Monaco's `editor.addAction()` — prevent browser default save dialog, call `writeFile` server action, clear dirty flag on success.
- **D-07:** Toast notification on save — "保存成功" / "File saved" via a lightweight toast. Keep it simple (div with setTimeout auto-dismiss), no toast library.
- **D-08:** Dirty indicator: dot before filename in tab header — `● filename.ts` when modified, plain `filename.ts` when clean. Track via `onDidChangeModelContent` Monaco event.

### Claude's Discretion
- Editor component file structure and naming
- Tab close button (X) behavior and UX
- Maximum number of open tabs (if any limit)
- Editor options (minimap, line numbers, word wrap settings)
- i18n key naming for editor-related strings

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/actions/file-actions.ts` — Phase 20's file operations, needs readFile/writeFile additions
- `src/lib/fs-security.ts` — safeResolvePath utility for path validation
- `task-page-client.tsx` — workbench with Files tab, already has `selectedFilePath` state and `onFileSelect` callback from FileTree
- `next-themes` — already installed and used throughout the app for theme switching

### Established Patterns
- `dynamic(() => import(...), { ssr: false })` — standard Next.js pattern for client-only components
- Server actions for all file I/O (never client-side fs access)
- Tailwind CSS for all styling

### Integration Points
- `task-page-client.tsx` Files tab — split into file tree (left) and editor (right) using nested panels or flex layout
- `FileTree.onFileSelect(absolutePath)` → triggers editor to open that file
- `selectedFilePath` state in task-page-client already set by FileTree click

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 21-code-editor*
*Context gathered: 2026-04-01*
