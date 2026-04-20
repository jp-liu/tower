# Phase 60: Resource Attribution & Task Drawer - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous --auto)

<domain>
## Phase Boundary

Show all project assets (including task-bound ones) in the assets page with task attribution labels, and add a TaskOverviewDrawer for quick task preview from anywhere assets or completed tasks are referenced.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — --auto mode. Key architectural notes:

- Assets page query: include task-bound assets (query all ProjectAsset where projectId matches, regardless of taskId)
- Task attribution: show "[任务: <title>]" badge (truncated 20 chars) on task-bound assets
- TaskOverviewDrawer: Sheet/Drawer component with task metadata (title, status, priority, description, labels, last execution summary, resource count, creation date)
- Integration: clicking task badge in asset list → opens drawer; clicking completed/archived task in task list → opens drawer instead of navigating

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/assets/asset-item.tsx` — Asset row component (modified in phase 56)
- `src/app/workspaces/[workspaceId]/assets/assets-page-client.tsx` — Assets page
- `src/components/board/task-card.tsx` — Task card with click handler
- `src/components/board/kanban-board.tsx` — Board with task click handling
- shadcn Sheet component for drawer

### Established Patterns
- Badge component for labels
- Dialog/Sheet for overlays
- Server actions for data fetching
- i18n for all text

### Integration Points
- Asset list needs taskId and task title data
- Task list click handler needs condition for completed/archived tasks
- New TaskOverviewDrawer imported where needed

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
