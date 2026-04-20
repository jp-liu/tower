---
phase: 38-chat-mode
plan: "01"
subsystem: assistant-chat
tags: [hook, parser, websocket, ansi, state-machine]
dependency_graph:
  requires: [36-assistant-backend, 37-terminal-mode-ui]
  provides: [useAssistantChat, ChatMessage, MessageRole, stripAnsi, communicationMode]
  affects: [assistant-provider, chat-ui-plan-02]
tech_stack:
  added: []
  patterns: [state-machine-parser, incremental-buffer, pure-function-export-for-testing]
key_files:
  created:
    - src/hooks/use-assistant-chat.ts
    - src/hooks/__tests__/use-assistant-chat.test.ts
  modified:
    - src/lib/config-defaults.ts
    - src/components/assistant/assistant-provider.tsx
decisions:
  - "parseLines exported as pure function (not closure) so tests can call it without jsdom WebSocket mock"
  - "OSC regex simplified to [^\\x07\\x1B]* pattern — avoids alternation issue with \\x1B[\\\\] backslash-T"
  - "Consecutive assistant lines merged into single message via lastAssistant() check"
  - "Box-drawing boundaries (╭/╰) treated as delimiters but produce no message of their own"
metrics:
  duration: "~3 minutes"
  completed_date: "2026-04-17"
  tasks_completed: 2
  files_changed: 4
---

# Phase 38 Plan 01: useAssistantChat Hook + communicationMode Config Summary

One-liner: Incremental PTY WebSocket parser converting raw Claude CLI output to ChatMessage[] with ANSI stripping, state-machine role detection, and communicationMode config key in AssistantProvider.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Add communicationMode config key + expose from AssistantProvider | 0107e6a | config-defaults.ts, assistant-provider.tsx |
| TDD-RED | Add failing tests for useAssistantChat hook | 62753b0 | src/hooks/__tests__/use-assistant-chat.test.ts |
| 2 | Implement useAssistantChat hook with incremental state-machine parser | 9470673 | src/hooks/use-assistant-chat.ts |

## What Was Built

### src/hooks/use-assistant-chat.ts

Exports:
- `stripAnsi(text)` — removes ANSI/VT escape sequences (CSI color codes, OSC title sequences, cursor movement, two-character ESC forms) using a single regex pass
- `parseLines(existingMessages, lineBuffer, newLines)` — pure incremental state-machine parser; exported for unit testing without WS overhead
- `ChatMessage` / `MessageRole` types
- `useAssistantChat({ enabled, worktreePath })` — React hook with WebSocket connection to `ws://localhost:${wsPort}/terminal?taskId=__assistant__`

Parser state-machine role detection:
- Lines starting with `>` or `❯` → `user` role
- Lines with spinner characters (⠋⠙...) or hourglass (⏳⌛) → `thinking` role with `isStreaming: true`
- Lines starting with `Tool:` → `tool` role, `toolName` extracted
- Box-drawing characters (╭ ╰) → message boundary delimiter (no message created)
- All other lines → `assistant` role, consecutive lines merged into one message

Partial chunk buffering: raw WS chunks split on `\n`, last partial held in `lineBufferRef` until the next chunk completes it.

### src/lib/config-defaults.ts

Added `assistant.communicationMode` config entry with `defaultValue: "terminal"`. This separates layout mode (`assistant.displayMode`) from communication mode (`terminal` vs `chat`).

### src/components/assistant/assistant-provider.tsx

- Added `communicationMode: "terminal" | "chat"` to `AssistantContextValue` interface
- Added `communicationMode` state (default `"terminal"`)
- Reads `assistant.communicationMode` from config on mount alongside `displayMode`
- Includes `communicationMode` in Provider value object

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed OSC regex pattern for ANSI stripping**
- **Found during:** Task 2 GREEN phase (2 test failures)
- **Issue:** Original regex `\](?:[^\x07\x1B]|\x1B[\\])*(?:\x07|\x1B\\)` used backslash-bracket alternation that didn't correctly match the `\x1B\\` (ST) terminator, leaving OSC content visible
- **Fix:** Simplified to `\][^\x07\x1B]*(?:\x07|\x1B\\)` — match any non-BEL/non-ESC chars followed by BEL or ESC-backslash
- **Files modified:** src/hooks/use-assistant-chat.ts
- **Commit:** 9470673 (part of GREEN implementation)

## Test Results

```
Test Files: 1 passed (1)
Tests:      22 passed (22)
Duration:   ~700ms
```

All 22 tests pass:
- stripAnsi: 8 tests (CSI, OSC, cursor movement, clean text, mixed)
- parseLines state machine: 8 tests (user, assistant, thinking, tool, box-drawing, unique IDs)
- Partial chunk buffering: 3 tests (incomplete lines, buffer drain, incremental accumulation)
- ChatMessage shape: 1 test

Note: Pre-existing test suite has 27 unrelated failures in pty-session and other files — these are not caused by this plan's changes (verified by running tests before and after stash).

## Self-Check: PASSED

- [x] src/hooks/use-assistant-chat.ts — FOUND
- [x] src/hooks/__tests__/use-assistant-chat.test.ts — FOUND
- [x] commit 0107e6a — FOUND (config-defaults + assistant-provider)
- [x] commit 62753b0 — FOUND (test RED)
- [x] commit 9470673 — FOUND (implementation GREEN)
