# Phase 19: Workbench Entry & Layout - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver three things: (1) a "查看详情" entry point in the task drawer header that navigates to the full task page, (2) refactor the existing task-page-client.tsx from a fixed 40/60 split with a single "Changes" tab into a resizable layout with three tabs (Files / Changes / Preview), and (3) placeholder content for each tab so later phases can fill them.

</domain>

<decisions>
## Implementation Decisions

### Layout & Resizing
- **D-01:** Install `react-resizable-panels@^2.x` (NOT v4 — v4 has breaking export renames). Use ResizablePanelGroup with two panels: left (chat) and right (tabs).
- **D-02:** Default proportions are 35% chat / 65% right panel. User can drag the resize handle.
- **D-03:** Minimum panel width is 20% for each side — prevents accidentally hiding either panel.

### Tab Structure
- **D-04:** Right panel has three tabs in order: **Files** / **Changes** / **Preview**. Default selected tab is **Files**.
- **D-05:** Tabs display both icon and text label. Icons: FolderTree (Files), GitCompare (Changes), Eye (Preview) from lucide-react.
- **D-06:** Preview tab is hidden when the project type is "backend" (ties into PV-01 from Phase 23, but the tab visibility logic can be wired now with a placeholder check).

### Navigation Entry
- **D-07:** "查看详情" button is placed in the task drawer header area, next to the task title, using ExternalLink icon. Uses `router.push()` for same-tab navigation (current behavior).
- **D-08:** Back navigation from task page keeps the existing back arrow link to board page — no changes needed.

### Claude's Discretion
- Tab component implementation details (custom tabs vs shadcn Tabs)
- Exact placeholder content for Files and Preview tabs (simple centered text is fine)
- Whether to refactor existing "Changes" tab content in-place or extract to a wrapper component
- i18n key naming for new tab labels and "查看详情" button text

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `task-page-client.tsx` — existing 40/60 split with chat + single "Changes" tab; refactor into resizable + multi-tab
- `TaskConversation` component — chat message display, reuse as-is in left panel
- `TaskMessageInput` component — message input with prompt dropdown, reuse as-is
- `TaskDiffView` component — existing diff view, move into "Changes" tab
- `TaskMetadata` component — header with title/status/branch badges
- `task-detail-panel.tsx` — drawer panel, already has a "查看详情" link via `router.push()`

### Established Patterns
- Server component fetches data in `page.tsx`, serializes dates, passes to client component
- SSE streaming for real-time execution output via `/api/tasks/[taskId]/stream`
- Status changed events trigger both local state update and `router.refresh()`
- Tailwind CSS for all styling, no CSS-in-JS
- `useI18n()` hook for bilingual strings

### Integration Points
- `task-detail-panel.tsx` header — add "查看详情" button/link (may already exist as a navigation link)
- `task-page-client.tsx` — refactor layout from fixed to resizable, add tab bar
- `src/lib/i18n.tsx` — add tab label translations (Files/Changes/Preview, 查看详情)
- `page.tsx` server component — may need to fetch project type for Preview tab visibility

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

*Phase: 19-workbench-entry-layout*
*Context gathered: 2026-03-31*
