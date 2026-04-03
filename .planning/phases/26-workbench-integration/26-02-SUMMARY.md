---
phase: 26-workbench-integration
plan: "02"
subsystem: workbench-ui
tags: [terminal, xterm, pty, execute, i18n]
dependency_graph:
  requires: [26-01, 25-01, 25-02, 24-01, 24-02]
  provides: [INT-01, INT-02, INT-03]
  affects: [task-page-client, i18n]
tech_stack:
  added: []
  patterns: [dynamic-import-ssr-false, useCallback-immutable-handlers]
key_files:
  created: []
  modified:
    - src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx
    - src/lib/i18n.tsx
decisions:
  - "TaskTerminal loaded via next/dynamic({ ssr: false }) per Phase 25 JSDoc requirement — xterm.js accesses window at import time"
  - "activeWorktreePath state initialized from latestExecution.worktreePath — supports first-execution and reconnect flows"
  - "handleSessionEnd sets IN_REVIEW on exitCode 0 + calls router.refresh() for immediate UI + data sync"
  - "handleExecute sets isExecuting=true before await; only resets on error (terminal onSessionEnd resets on success)"
  - "All 5 i18n keys (terminal.execute, terminal.executing, terminal.noPrompt, terminal.stopExecution, terminal.promptPlaceholder) added to both zh and en"
metrics:
  duration: 180s
  completed: "2026-04-03T01:25:05Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 26 Plan 02: Workbench Terminal Integration Summary

**One-liner:** Replace left panel chat bubbles with xterm.js TaskTerminal + Execute button wired to startPtyExecution, with automatic IN_REVIEW status on PTY exit code 0.

## What Was Built

### Task 1: i18n Keys for Terminal Execute UI

Added 5 new i18n keys to both zh and en sections of `src/lib/i18n.tsx`:

| Key | zh | en |
|-----|----|----|
| `terminal.execute` | 执行 | Execute |
| `terminal.executing` | 执行中... | Executing... |
| `terminal.noPrompt` | 请输入执行提示词 | Enter a prompt to execute |
| `terminal.stopExecution` | 停止执行 | Stop |
| `terminal.promptPlaceholder` | 输入任务提示词... | Enter task prompt... |

### Task 2: Left Panel Replacement

Rewrote `task-page-client.tsx` to remove the SSE chat UI and replace it with the PTY terminal integration:

**Removed:**
- `TaskConversation` + `TaskMessageInput` imports and JSX
- `getTaskMessages` import and useEffect (no chat history)
- `getPrompts` import and useEffect (no prompt selector)
- `messages`, `isLoading`, `prompts`, `selectedPromptId`, `abortRef` state
- `handleSend` callback (entire SSE streaming implementation)
- Cleanup abort useEffect

**Added:**
- `dynamic` import of `TaskTerminal` with `{ ssr: false }` (per Phase 25 JSDoc requirement)
- `startPtyExecution` import from `@/actions/agent-actions`
- `Terminal` icon from `lucide-react`
- `prompt`, `isExecuting`, `activeWorktreePath` state
- `handleExecute`: calls `startPtyExecution`, updates `activeWorktreePath` on success
- `handleSessionEnd`: resets `isExecuting`, sets `IN_REVIEW` on exit code 0, calls `router.refresh()`
- Terminal area (`flex-1 min-h-0`) + Execute controls bottom bar (textarea + button)

**Left panel structure after change:**
1. Header (unchanged — back, breadcrumb, status badge, branch badge)
2. `<TaskTerminal>` filling `flex-1 min-h-0`
3. Execute controls: textarea (3 rows) + Execute/Executing button

**Right panel:** Unchanged (Files/Changes/Preview tabs).

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `6e293f3` | feat(26-02): add i18n keys for terminal execute UI |
| 2 | `09c08cd` | feat(26-02): replace left panel chat UI with TaskTerminal + Execute button |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. `activeWorktreePath` is initialized from `latestExecution?.worktreePath` (real DB data) and updated on `startPtyExecution` resolution. The terminal component (Phase 25) handles the "no worktree" placeholder state internally.

## Pending: Checkpoint Task 3

Human verification is required before this plan is fully complete:

- Start dev server: `pnpm dev`
- Navigate to a task with a project that has `localPath` configured
- Enter a prompt in the textarea and click Execute (or Cmd+Enter)
- Verify: terminal shows live Claude CLI output (ANSI colors, not chat bubbles)
- Verify: task status badge updates to "待评审" (IN_REVIEW) without manual refresh after Claude exits with code 0

## Self-Check: PASSED

- `src/lib/i18n.tsx` modified: confirmed (10 lines added)
- `task-page-client.tsx` modified: confirmed (79 insertions, 179 deletions)
- Commit `6e293f3`: confirmed
- Commit `09c08cd`: confirmed
- TypeScript: no errors in modified files
- `grep -n "TaskConversation|TaskMessageInput"` returns no results: confirmed
- `grep -c "terminal.execute" src/lib/i18n.tsx` returns 2: confirmed
