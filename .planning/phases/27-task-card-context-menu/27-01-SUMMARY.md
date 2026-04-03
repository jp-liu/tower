---
phase: 27-task-card-context-menu
plan: "01"
subsystem: board-ui
tags: [context-menu, portal, i18n, kanban]
dependency_graph:
  requires: []
  provides: [TaskCardContextMenu component, board.contextMenu i18n keys]
  affects: [src/components/board/, src/lib/i18n.tsx]
tech_stack:
  added: []
  patterns: [portal-rendering, dismiss-on-outside-click]
key_files:
  created:
    - src/components/board/task-card-context-menu.tsx
  modified:
    - src/lib/i18n.tsx
decisions:
  - "Followed FileTreeContextMenu portal pattern exactly — useRef + mousedown/keydown useEffect + createPortal(menu, document.body)"
  - "hasExecutions prop disables Launch button with opacity-50 + cursor-not-allowed + disabled attribute"
  - "Check icon from lucide-react used for current status indicator; w-5 span spacer for non-current statuses"
metrics:
  duration: ~5min
  completed_date: "2026-04-03"
  tasks: 2
  files: 2
requirements:
  - TASK-01
  - TASK-02
  - TASK-03
---

# Phase 27 Plan 01: TaskCardContextMenu Component Summary

**One-liner:** Portal-based right-click context menu for Kanban task cards with status submenu, launch action, and detail navigation — plus 6 i18n keys (zh/en).

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Create TaskCardContextMenu component | 0b3dee9 | src/components/board/task-card-context-menu.tsx |
| 2 | Add i18n keys for context menu | ecb9f56 | src/lib/i18n.tsx |

## Files Created/Modified

### Created: `src/components/board/task-card-context-menu.tsx`

Full `"use client"` component with:
- Portal rendering via `createPortal(menu, document.body)`
- SSR guard: `if (typeof document === "undefined") return null`
- Position: `style={{ position: "fixed", top: y, left: x, zIndex: 9999 }}`
- Dismiss: `useEffect` adding `mousedown` + `keydown` listeners on document

### Modified: `src/lib/i18n.tsx`

Added 6 keys (3 zh + 3 en) after existing `board.inReviewFilter` entries.

## Prop Interface (for Plan 02 to use)

```typescript
interface TaskCardContextMenuProps {
  x: number;
  y: number;
  taskId: string;
  currentStatus: TaskStatus;
  hasExecutions: boolean;           // true → disable launch item
  workspaceId: string;
  onClose: () => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onLaunch: (taskId: string) => void;
}
```

Export: `export function TaskCardContextMenu(...)` (named export)
Import path: `"@/components/board/task-card-context-menu"`

## i18n Keys Added

| Key | zh | en |
|-----|----|----|
| `board.contextMenu.changeStatus` | 更改状态 | Change Status |
| `board.contextMenu.launch` | 启动任务 | Launch Task |
| `board.contextMenu.goToDetail` | 查看详情 | Go to Detail |

## Menu Structure

```
[section label] "Change Status" (non-interactive, muted uppercase)
[button] ✓ Todo        ← checkmark on current status
[button]   In Progress
[button]   In Review
[button]   Done
[button]   Cancelled
---
[button] Launch Task    ← disabled (opacity-50, cursor-not-allowed) when hasExecutions=true
---
[button] Go to Detail   ← calls router.push(`/workspaces/${workspaceId}/tasks/${taskId}`)
```

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/components/board/task-card-context-menu.tsx` exists
- Commit 0b3dee9 exists (feat: create TaskCardContextMenu)
- Commit ecb9f56 exists (feat: add i18n keys)
- `npx tsc --noEmit` shows no errors for this file
- All 6 i18n keys confirmed present
