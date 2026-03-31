# Phase 20: File Tree Browser - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the file tree browser for the workbench Files tab. Six capabilities: (1) directory listing scoped to TaskExecution.worktreePath with expand/collapse and file icons, (2) click-to-open file selection passed to Phase 21's editor, (3) gitignore-aware filtering, (4) auto-refresh every 2s during Claude execution, (5) right-click context menu for create/rename/delete operations, (6) git change status badges (M/A/D) on file tree nodes.

</domain>

<decisions>
## Implementation Decisions

### File System API & Security
- **D-01:** New `src/actions/file-actions.ts` with server actions: `listDirectory(worktreePath, relativePath)`, `createFile(worktreePath, relativePath)`, `createDirectory(worktreePath, relativePath)`, `renameEntry(worktreePath, oldPath, newPath)`, `deleteEntry(worktreePath, relativePath)`. All path-validated via safeResolvePath.
- **D-02:** `safeResolvePath(base, relative)` utility in `src/lib/fs-security.ts` — uses `path.resolve(base, relative)` + `startsWith(base)` check. Returns resolved absolute path or throws. Reused by Phase 21 editor file read/write.
- **D-03:** gitignore filtering via `ignore` npm package — parse `.gitignore` from worktree root, filter entries server-side in `listDirectory` before returning to client. Never expose gitignored files.
- **D-04:** Lazy directory loading — only list immediate children on expand. Fetch deeper levels on demand when user expands folders.

### File Tree Component
- **D-05:** File icons via lucide-react mapping: `.ts/.tsx`→FileCode, `.json`→FileJson, `.md`→FileText, `.css/.scss`→Palette, folder→Folder/FolderOpen, default→File. No external icon package.
- **D-06:** Custom right-click context menu — positioned absolute div with portal to document.body, triggered by `onContextMenu`. Shows: New File, New Folder, Rename, Delete (with separator before Delete).
- **D-07:** Auto-refresh via `setInterval(2000)` polling when task execution status is RUNNING — stop interval when not executing. Parent component passes execution status down.
- **D-08:** Git status from `git diff --name-status baseBranch...taskBranch` — parsed server-side into `Map<relativePath, 'M'|'A'|'D'>`, returned alongside directory listing or as separate endpoint.

### Right-Click Operations
- **D-09:** Create file/folder uses inline rename-style input — new entry appears in tree with editable name field at the target location, press Enter to create, Escape to cancel.
- **D-10:** Delete shows simple confirm dialog — "Delete {name}?" with cancel/delete buttons. Prevent deleting `.git/` directory.
- **D-11:** Rename via inline edit — click context menu "Rename" to make filename editable, press Enter to save, Escape to cancel.

### Claude's Discretion
- Component file structure (single file vs split into sub-components)
- Exact Tailwind styling for tree nodes, indentation, context menu
- Whether to show file sizes or last-modified dates in the tree
- Whether to highlight the currently selected/open file
- i18n key naming for context menu items and error messages

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `task-page-client.tsx` — Phase 19 workbench with Files tab placeholder; file tree component goes here
- `src/lib/file-serve.ts` — existing path-anchor pattern for safe file serving (reference for safeResolvePath)
- `src/actions/git-actions.ts` — existing `getProjectBranches` pattern for git operations
- `src/lib/worktree.ts` — worktree creation/removal utilities (worktreePath access pattern)
- `TaskExecution.worktreePath` field — the root path for all file operations in this phase

### Established Patterns
- Server actions for data mutations (`src/actions/*.ts`)
- Zod validation in server actions
- `useI18n()` hook for bilingual strings
- lucide-react for all icons throughout the app
- Tailwind CSS for styling, no CSS-in-JS

### Integration Points
- `task-page-client.tsx` Files tab content — replace placeholder with file tree component
- File tree click → pass selected file path to editor (Phase 21 will consume this)
- File tree needs `worktreePath` from `TaskExecution` and `baseBranch` from `Task` for git status

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

*Phase: 20-file-tree-browser*
*Context gathered: 2026-03-31*
