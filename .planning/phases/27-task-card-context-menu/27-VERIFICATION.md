---
phase: 27-task-card-context-menu
verified: 2026-03-31T00:00:00Z
status: passed
score: 9/9 must-haves verified
---

# Phase 27: Task Card Context Menu Verification Report

**Phase Goal:** Kanban task card right-click menu with status change, launch task, navigate to detail page
**Verified:** 2026-03-31
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Right-clicking a task card shows a context menu at cursor position | VERIFIED | `task-card.tsx` line 50-54: `onContextMenu` handler calls `e.preventDefault()`, `e.stopPropagation()`, and `onContextMenu?.(task, e.clientX, e.clientY)` |
| 2 | Menu has three groups: change status (submenu), launch task, go to detail | VERIFIED | `task-card-context-menu.tsx` lines 66-111: section label + BOARD_COLUMNS buttons + hr + launch button + hr + detail button |
| 3 | Context menu closes on outside click and Escape key | VERIFIED | `task-card-context-menu.tsx` lines 38-55: `useEffect` with `mousedown` and `keydown` listeners, both calling `onClose()` |
| 4 | Menu renders via portal (never clipped by overflow:hidden containers) | VERIFIED | `task-card-context-menu.tsx` line 116: `createPortal(menu, document.body)` with SSR guard at line 115 |
| 5 | Right-clicking a task card opens the context menu at cursor position | VERIFIED | Full chain wired: `task-card.tsx` → `board-column.tsx` → `kanban-board.tsx` via `handleContextMenu` → `contextMenu` state → renders `TaskCardContextMenu` |
| 6 | Selecting a status updates the task status immediately and refreshes the board | VERIFIED | `board-page-client.tsx` line 120-123: `handleContextMenuStatusChange` calls `updateTaskStatus` then `refreshData()` |
| 7 | Launch Task is greyed out when task has been executed at least once | VERIFIED | `task-card-context-menu.tsx` lines 88-100: `disabled={hasExecutions}` + `opacity-50 cursor-not-allowed` when `hasExecutions` is true; `kanban-board.tsx` line 149: `hasExecutions={((contextMenu.task as any)._count?.executions ?? 0) > 0}` |
| 8 | Clicking Launch Task starts PTY execution and navigates to task detail | VERIFIED | `board-page-client.tsx` lines 111-118: `handleLaunchTask` calls `startPtyExecution(taskId, "")` then `router.push(`/workspaces/${workspaceId}/tasks/${taskId}`)` |
| 9 | Clicking Go to Detail navigates to /workspaces/{workspaceId}/tasks/{taskId} | VERIFIED | `task-card-context-menu.tsx` lines 102-110: `router.push(`/workspaces/${workspaceId}/tasks/${taskId}`)` on click |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/board/task-card-context-menu.tsx` | TaskCardContextMenu component with status submenu, launch, and detail navigation | VERIFIED | 117 lines, exports `TaskCardContextMenu`, full implementation |
| `src/lib/i18n.tsx` | i18n keys for context menu labels in both zh and en | VERIFIED | 6 keys present (3 zh + 3 en) at lines 66-68 and 482-484 |
| `src/app/workspaces/[workspaceId]/page.tsx` | Includes `_count.executions` in task query | VERIFIED | Line 26: `_count: { select: { executions: true } }` |
| `src/components/board/task-card.tsx` | `onContextMenu` handler calling prop with task, x, y | VERIFIED | Lines 21 + 50-54: prop defined and handler implemented |
| `src/components/board/board-column.tsx` | Forwards `onContextMenu` prop to each TaskCard | VERIFIED | Line 18: prop in interface; line 74: `onContextMenu={onContextMenu}` on TaskCard |
| `src/components/board/kanban-board.tsx` | Manages context menu state; renders TaskCardContextMenu | VERIFIED | Lines 46-50: state; lines 63-65: `handleContextMenu`; lines 143-161: renders `TaskCardContextMenu` |
| `src/app/workspaces/[workspaceId]/board-page-client.tsx` | `handleLaunchTask` calling `startPtyExecution` | VERIFIED | Lines 111-118: full implementation |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `task-card-context-menu.tsx` | `src/lib/i18n.tsx` | `useI18n()` + `t("board.contextMenu.*")` | WIRED | Lines 34, 67, 99, 110: `useI18n` called, keys used |
| `kanban-board.tsx` | `task-card-context-menu.tsx` | Renders `TaskCardContextMenu` when `contextMenu !== null` | WIRED | Line 4: import; lines 143-161: conditional render |
| `board-page-client.tsx` | `agent-actions.ts` | `startPtyExecution` import | WIRED | Line 12: `import { startPtyExecution } from "@/actions/agent-actions"` |
| `page.tsx` | Prisma `_count.executions` | `include._count.select.executions` | WIRED | Line 26: `_count: { select: { executions: true } }` |
| `board-column.tsx` | `task-card.tsx` | `onContextMenu={onContextMenu}` prop threading | WIRED | Line 74: forwarded to each TaskCard |
| `kanban-board.tsx` | `board-column.tsx` | `onContextMenu={handleContextMenu}` | WIRED | Line 130: `onContextMenu={handleContextMenu}` on each BoardColumn |
| `board-page-client.tsx` | `kanban-board.tsx` | `onContextMenuStatusChange` + `onContextMenuLaunch` + `workspaceId` props | WIRED | Lines 178-180: all three props passed |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `task-card-context-menu.tsx` (hasExecutions) | `hasExecutions` prop | `page.tsx` Prisma query `_count.executions` → `KanbanBoard` `(task as any)._count?.executions` | Yes — Prisma count query on `executions` relation | FLOWING |
| `task-card-context-menu.tsx` (status submenu) | `currentStatus` prop | `contextMenu.task.status` from local `tasks` state in `KanbanBoard` (seeded from `initialTasks`) | Yes — from DB query in `page.tsx` | FLOWING |
| `board-page-client.tsx` (board refresh) | `filteredTasks` | `initialTasks` re-fetched via `router.refresh()` in `refreshData` | Yes — Next.js server component re-renders fetch | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Check | Result | Status |
|----------|-------|--------|--------|
| `createPortal` present in context menu | `grep -q "createPortal" task-card-context-menu.tsx` | Found at line 116 | PASS |
| SSR guard present | `grep -q "typeof document" task-card-context-menu.tsx` | Found at line 115 | PASS |
| All 6 i18n keys present | Node key-check: `board.contextMenu.changeStatus`, `.launch`, `.goToDetail` × 2 locales | All 6 found | PASS |
| TypeScript — no new errors from this phase | `tsc --noEmit` | Only 2 pre-existing errors in `agent-config-actions.ts` (unrelated to Phase 27); zero errors in any Phase 27 file | PASS |
| Commits exist | git log check | `0b3dee9`, `ecb9f56`, `9732cbb`, `65237e3` all confirmed | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TASK-01 | 27-01, 27-02 | 任务 Kanban 卡片支持右键菜单（更改状态、启动任务、前往详情页） | SATISFIED | Full wiring chain verified; context menu renders with all three action groups |
| TASK-02 | 27-01, 27-02 | 右键"启动任务"直接运行 Claude CLI（仅未执行过的任务可点击，已执行过的置灰） | SATISFIED | `hasExecutions` computed from `_count.executions`; `disabled` attribute + `opacity-50` when true; `startPtyExecution` called on launch |
| TASK-03 | 27-01, 27-02 | 右键"前往详情页"跳转到任务工作台页面 | SATISFIED | `router.push(/workspaces/${workspaceId}/tasks/${taskId})` on "Go to Detail" click |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `task-card-context-menu.tsx` | 115 | SSR guard after hooks | Info | The `if (typeof document === "undefined") return null` check appears after all hooks. In a "use client" component this is acceptable — the component never server-renders, so `document` is always available; the guard protects only the `createPortal` call. No bug, but the comment in the plan describes it as an early-return pattern. |

No blockers found. No FIXME/TODO/placeholder comments. No empty implementations. No hardcoded empty data in rendered paths.

---

### Human Verification Required

#### 1. Right-click context menu visual appearance and positioning

**Test:** On the running dev server, right-click a task card at the edge of the browser viewport.
**Expected:** Menu appears at cursor without being cut off; if near the right/bottom edge, menu remains fully visible.
**Why human:** Viewport boundary clamping is not implemented — the menu positions at `{ top: y, left: x }` with no viewport overflow check. Edge-case clipping needs visual confirmation.

#### 2. Launch Task disabled state UX

**Test:** Find a task that has at least one execution; right-click it.
**Expected:** "Launch Task" item is visually greyed out and not clickable.
**Why human:** Disabled button appearance and cursor behavior need visual confirmation.

#### 3. Status change immediate board update

**Test:** Right-click a TODO task → select "In Progress".
**Expected:** Card moves to In Progress column without full page reload; checkmark appears on In Progress in the next right-click.
**Why human:** Optimistic update + server refresh timing needs live observation.

---

### Gaps Summary

No gaps. All automated checks pass:
- Component exists and is substantive (117 lines, full implementation)
- Portal pattern implemented correctly
- Full wiring chain verified: `page.tsx` → `task-card.tsx` → `board-column.tsx` → `kanban-board.tsx` → `board-page-client.tsx`
- No unused variables or broken prop threading found
- `_count.executions` flows from Prisma through to the `hasExecutions` prop
- All 6 i18n keys present in both locales
- TypeScript reports zero errors for Phase 27 files

Three human verification items are noted for visual/behavioral confirmation but none block the goal.

---

_Verified: 2026-03-31_
_Verifier: Claude (gsd-verifier)_
