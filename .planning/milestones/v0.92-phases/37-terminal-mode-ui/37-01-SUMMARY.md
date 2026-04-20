---
phase: 37-terminal-mode-ui
plan: "01"
subsystem: assistant-ui
tags: [react-context, assistant, terminal, keyboard-shortcut]
dependency_graph:
  requires: [36-assistant-backend]
  provides: [AssistantProvider, AssistantPanel, assistant-api-worktreePath]
  affects: [src/components/assistant, src/app/api/internal/assistant]
tech_stack:
  added: []
  patterns: [React context pattern, dynamic import ssr:false, fire-and-forget fetch]
key_files:
  created:
    - src/components/assistant/assistant-provider.tsx
    - src/components/assistant/assistant-panel.tsx
  modified:
    - src/app/api/internal/assistant/route.ts
decisions:
  - toggleAssistant checks both isOpen and isStarting to prevent double-start during loading
  - openAssistant sets worktreePath before isOpen=true to ensure terminal mounts after path is available
  - All user-facing strings hardcoded English (i18n deferred to Phase 39)
metrics:
  duration: "~8 minutes"
  completed: "2026-04-17T11:05:35Z"
  tasks_completed: 3
  files_modified: 3
---

# Phase 37 Plan 01: Assistant Provider & Panel Summary

AssistantProvider React context + AssistantPanel component + worktreePath in assistant API POST response.

## What Was Built

Three artifacts implementing the building blocks for the global chat assistant UI:

1. **POST /api/internal/assistant** now returns `worktreePath: process.cwd()` — required because TaskTerminal guards initialization on a non-null worktreePath.

2. **AssistantProvider** (`src/components/assistant/assistant-provider.tsx`) — React context wrapping the full assistant session lifecycle:
   - State: `isOpen`, `isStarting`, `displayMode`, `worktreePath`
   - `openAssistant`: sets isStarting=true, calls POST, sets worktreePath from response, then sets isOpen=true (correct ordering prevents terminal mount before session exists)
   - `closeAssistant`: clears state immediately, fire-and-forget DELETE
   - `toggleAssistant`: open or close depending on `isOpen || isStarting`
   - Keyboard shortcut Cmd+L/Ctrl+L registered at provider level (works from any page)
   - Reads `assistant.displayMode` from SystemConfig on mount

3. **AssistantPanel** (`src/components/assistant/assistant-panel.tsx`) — Title bar + xterm terminal body:
   - Title bar: Bot icon + "Tower Assistant" text + close button (X)
   - Loading state: Loader2 spinner while isStarting=true
   - Terminal: DynamicTerminal (next/dynamic ssr:false) with taskId=`__assistant__` and worktreePath from context
   - Sidebar mode: `w-[420px] shrink-0 border-r` fixed width
   - Dialog mode: `flex flex-col h-full` for wrapper-controlled sizing

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | ba059b0 | Fix assistant API route to return worktreePath |
| Task 2 | 621ce39 | Create AssistantProvider context |
| Task 3 | 98cadc9 | Create AssistantPanel component |

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. The components are complete building blocks ready for layout integration in Plan 02.

## Self-Check: PASSED
