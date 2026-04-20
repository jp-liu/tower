# Phase 27: Task Card Context Menu - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Add right-click context menu to Kanban task cards with three actions: (1) change task status, (2) launch/execute task (greyed out if already executed), (3) navigate to task detail/workbench page.

</domain>

<decisions>
## Implementation Decisions

### Context Menu
- **D-01:** Right-click on task card opens a context menu positioned at cursor. Same portal-based approach as FileTreeContextMenu (Phase 20).
- **D-02:** Menu items: "更改状态" (submenu with status options), "启动任务" (launch execution), "查看详情" (navigate to workbench).
- **D-03:** "启动任务" is disabled (greyed out) when the task has any TaskExecution records (already been executed at least once). Check via task's execution history.
- **D-04:** "更改状态" submenu shows all status values (TODO, IN_PROGRESS, IN_REVIEW, DONE, CANCELLED). Current status is highlighted/checked.
- **D-05:** "查看详情" navigates to `/workspaces/{workspaceId}/tasks/{taskId}` via `router.push()`.

### Execution
- **D-06:** "启动任务" calls `startPtyExecution` (Phase 26) to create a PTY session, then navigates to the task detail page where the terminal auto-connects.

### Claude's Discretion
- Context menu styling (follow FileTreeContextMenu pattern)
- i18n key naming
- Whether to show separator lines between menu groups
- How to fetch execution history for disable check (inline query or preloaded)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/task/file-tree-context-menu.tsx` — portal-based right-click menu pattern
- `src/components/board/task-card.tsx` — current task card component
- `src/actions/task-actions.ts` — `updateTaskStatus` server action
- `src/actions/agent-actions.ts` — `startPtyExecution` server action (Phase 26)

### Integration Points
- `task-card.tsx` — add `onContextMenu` handler
- `board-page-client.tsx` — manage context menu state, pass handlers

</code_context>

<specifics>
## Specific Ideas

No specific requirements.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>

---

*Phase: 27-task-card-context-menu*
*Context gathered: 2026-04-03*
