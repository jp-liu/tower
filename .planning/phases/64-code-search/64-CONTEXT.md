# Phase 64: Code Search - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (--auto flag, recommendations accepted)

<domain>
## Phase Boundary

Deliver a global code search tab in the task detail page's left panel. Users can search across all source files in a project using regex patterns and view results with highlighted matches. Clicking a result opens the file in Monaco at the matched line.

</domain>

<decisions>
## Implementation Decisions

### Tab Integration
- Add a "搜索" tab alongside existing "文件树" (files), "变更" (changes), "预览" (preview) tabs in the left panel of task-page-client.tsx
- Switching between tabs preserves file tree state (tabs component handles this natively)
- Search tab is always visible regardless of project type

### Search Implementation
- Backend: Server action or API route that spawns `rg` (ripgrep) with the search pattern scoped to project.localPath
- Input: regex pattern text input + optional file type/glob filter input
- Ripgrep command: `rg --json -n <pattern> [--glob <glob>] <localPath>` — JSON output for structured parsing
- Scope: always scoped to project.localPath (never searches outside project)
- Performance: results should appear within ~1 second for typical codebases
- Error handling: detect if `rg` is not installed and show clear error message

### Results Display
- Each result row shows: file path (relative to localPath), line number, and matching line content
- Keyword highlighting: wrap matched text in a styled span (e.g., bg-yellow-200/50 or similar highlight)
- Results grouped by file or flat list — Claude's discretion
- Limit results to a reasonable max (e.g., 200 matches) to avoid overwhelming the UI

### Monaco Integration
- Clicking a result row calls the existing file-open handler with the file path and target line number
- Monaco editor scrolls to and highlights the matched line (revealLineInCenter or similar)
- This reuses existing FileTree → Monaco open-file wiring

### Claude's Discretion
- Exact UI layout of search input and filter fields
- Whether to debounce search input or require Enter key to trigger
- Result grouping (by file vs flat list)
- Maximum result count
- Whether to show a search icon in the tab or just text

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` — has Tabs component with files/changes/preview tabs
- `src/components/task/file-tree.tsx` — file tree component in left panel
- `src/components/task/code-editor.tsx` — Monaco editor with file open/scroll support
- `src/actions/preview-actions.ts` — has execFileSync patterns for spawning CLI tools
- Existing Tabs, TabsList, TabsTrigger, TabsContent from `@/components/ui/tabs`

### Established Patterns
- Server actions in `src/actions/` for backend operations
- Tabs component from shadcn for panel switching
- Toast for error feedback
- ScrollArea for scrollable content
- All text uses `t("key")` from useI18n()

### Integration Points
- `task-page-client.tsx` — add new TabsTrigger and TabsContent for search
- New component: `src/components/task/code-search.tsx` (search UI + results)
- New server action for ripgrep execution
- Existing `onFileSelect` handler in task-page-client for opening files in Monaco

</code_context>

<specifics>
## Specific Ideas

- User stated: "在现在的文件树所在区域搜索就行了，这里给一个全局搜索的 tab，一个文件树 tab"
- User stated: "和 vscode 一样吧，我们在现在的文件树所在区域搜索就行了"
- STATE.md notes: "Phase 64 requires rg (ripgrep) on host — detect at runtime and surface clear error if missing"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
