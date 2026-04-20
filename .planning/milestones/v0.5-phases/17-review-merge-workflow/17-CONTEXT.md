# Phase 17: Review & Merge Workflow - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning

<domain>
## Phase Boundary

After a task execution completes successfully, the task enters IN_REVIEW. Users can view the diff on a dedicated task page, squash merge to the base branch when satisfied, or send the task back for more work by chatting. The result is a complete review-merge-revise cycle integrated into the task UI.

</domain>

<decisions>
## Implementation Decisions

### Task Page & Layout
- **D-01:** New route `/workspaces/[workspaceId]/tasks/[taskId]` — dedicated task page with full-width layout. Left side: chat/conversation panel. Right side: large container with tab switching.
- **D-02:** Right-side tabs: "Changes" (diff view with per-file collapsible sections). Future tabs (file browser, preview) deferred.
- **D-03:** In the existing drawer (task-detail-panel), add a "View Details" button that navigates to the task page. Also add a simplified "Conversation / Changes" tab in the drawer itself for quick diff viewing without leaving the board.

### Diff Display
- **D-04:** Diff rendered as per-file collapsible blocks. Each block shows filename + lines added/removed count. Click to expand and see unified diff content. Similar to GitHub PR file diff.
- **D-05:** Diff data fetched via new API route (not server action). Server-side executes `git diff baseBranch...task/{taskId}` and returns JSON with file list and per-file diff content.
- **D-06:** When task is in IN_REVIEW, the diff/Changes tab auto-loads on page open.

### Merge Action
- **D-07:** "Merge" and action buttons appear in the diff area header, only when task status is IN_REVIEW.
- **D-08:** Clicking "Merge" opens a confirmation dialog showing: target branch name, number of changed files, number of commits to squash.
- **D-09:** Squash merge commit message is auto-generated (format: `feat: {taskTitle}`) — no user editing required.
- **D-10:** Before merge, system checks for conflicts via `git merge-tree` or dry-run. If conflicts detected: Merge button is disabled/grayed out, conflict file list displayed. User must resolve conflicts before merging.
- **D-11:** After successful merge, task status automatically transitions to DONE.

### Send-Back / Revise Flow
- **D-12:** No separate "Send Back" button needed. When a task is in IN_REVIEW and the user sends a message in the chat panel, the task automatically transitions back to IN_PROGRESS and starts a new execution. The message becomes the new prompt context.
- **D-13:** The new execution reuses the existing worktree and branch (createWorktree handles this with its reuse logic from Phase 16).
- **D-14:** A new TaskExecution record is created pointing to the same worktree path and branch.

### IN_REVIEW Transition
- **D-15:** Task automatically transitions from IN_PROGRESS to IN_REVIEW when execution completes successfully (exitCode === 0). Failed executions (exitCode !== 0) stay IN_PROGRESS.
- **D-16:** The transition happens in the stream route's persistResult helper, after marking the TaskExecution as COMPLETED.

### Claude's Discretion
- Exact layout proportions for left chat / right diff on the task page
- Diff syntax highlighting approach (CSS classes vs library)
- Loading states and skeleton screens for diff fetching
- i18n key naming for all new UI strings
- Git diff parsing logic (raw output → structured JSON)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Task UI
- `src/components/task/task-detail-panel.tsx` — Current task panel, needs "View Details" button
- `src/components/task/task-metadata.tsx` — Task header with branch badge
- `src/components/task/task-conversation.tsx` — Chat message list
- `src/components/task/task-message-input.tsx` — Message input component

### Execution Pipeline
- `src/app/api/tasks/[taskId]/stream/route.ts` — Stream route with worktree integration (Phase 16), persistResult helper needs IN_REVIEW transition
- `src/lib/worktree.ts` — createWorktree with reuse logic (handles send-back case)
- `src/actions/agent-actions.ts` — startTaskExecution, stopTaskExecution
- `src/actions/task-actions.ts` — updateTaskStatus, createTask with baseBranch

### Git Operations
- `src/actions/git-actions.ts` — getProjectBranches (pattern for git exec)
- `src/app/api/git/route.ts` — Existing git API route

### Data Model
- `prisma/schema.prisma` — Task.baseBranch, TaskExecution.worktreePath/worktreeBranch
- `AGENTS.md` — Full data model reference, constraints

### Routing & Layout
- `src/app/workspaces/[workspaceId]/board-page-client.tsx` — Board page, where task detail panel lives
- `src/app/workspaces/[workspaceId]/page.tsx` — Workspace page server component

### i18n
- `src/lib/i18n.tsx` — Translation keys for zh/en

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `task-detail-panel.tsx` — existing chat UI, can extract shared conversation component for task page
- `task-metadata.tsx` — branch badge already displayed
- `worktree.ts` `createWorktree()` — handles worktree reuse for send-back case
- `git-actions.ts` `getProjectBranches()` — pattern for execSync git commands
- `api/git/route.ts` — existing API route for git operations, pattern reference
- `constants.ts` BOARD_COLUMNS — IN_REVIEW status already defined
- `updateTaskStatus` server action — already handles status transitions

### Established Patterns
- API routes for streaming/git operations, server actions for CRUD mutations
- `execSync` for git operations with timeout
- SSE events for execution progress
- `revalidatePath("/workspaces")` after mutations
- Client components with `"use client"` + `useI18n()` hook

### Integration Points
- `stream/route.ts` persistResult — add IN_REVIEW transition on success
- `task-detail-panel.tsx` — add "View Details" navigation button
- New route: `src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx`
- New API route: `src/app/api/tasks/[taskId]/diff/route.ts`
- New API route: `src/app/api/tasks/[taskId]/merge/route.ts`
- `board-page-client.tsx` — handle IN_REVIEW message sending → auto-transition

</code_context>

<specifics>
## Specific Ideas

- Task page layout: left chat panel + right tab container, similar to IDE layout
- Diff view similar to GitHub PR page: collapsible file sections with +/- line counts
- Auto-generated squash merge commit message: `feat: {taskTitle}`
- Drawer keeps simplified tab view (Conversation / Changes) for quick access without navigating away

</specifics>

<deferred>
## Deferred Ideas

- **File system browser** — Tab in task page to browse worktree file structure, click to preview files. Mentioned during discussion but belongs in a future phase.
- **Frontend iframe Preview** — Tab in task page with iframe pointing to local dev server for live preview of frontend changes. Similar to Vercel v0 preview. Requires knowing dev server port. Future phase.
- **Conflict resolution UI** — Show conflicting files inline and offer to send to Claude for fixing. Currently just disabling merge button. Future phase (WT-F02 in REQUIREMENTS.md).

</deferred>

---

*Phase: 17-review-merge-workflow*
*Context gathered: 2026-03-31*
