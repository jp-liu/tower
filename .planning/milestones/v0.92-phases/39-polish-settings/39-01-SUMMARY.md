---
phase: 39-polish-settings
plan: "01"
subsystem: assistant-ui
tags: [i18n, settings, assistant, communication-mode]
dependency_graph:
  requires: [38-chat-mode/38-02]
  provides: [communication-mode-setting, assistant-i18n]
  affects: [general-config, assistant-panel, assistant-chat, assistant-chat-bubble]
tech_stack:
  added: []
  patterns: [base-ui-select, useI18n-in-subcomponents]
key_files:
  created: []
  modified:
    - src/lib/i18n.tsx
    - src/components/settings/general-config.tsx
    - src/components/assistant/assistant-panel.tsx
    - src/components/assistant/assistant-chat.tsx
    - src/components/assistant/assistant-chat-bubble.tsx
decisions:
  - "Call useI18n() directly in ThinkingBubble and ToolBubble sub-components rather than prop-drilling t() from parent"
  - "handleSaveCommMode accepts string | null to match base-ui Select onValueChange signature"
metrics:
  duration: ~4 minutes
  completed: "2026-04-17T12:03:54Z"
  tasks_completed: 2
  files_modified: 5
---

# Phase 39 Plan 01: Assistant i18n + Communication Mode Setting Summary

**One-liner:** 28 assistant i18n keys added to zh/en locales; communication mode Select (terminal/chat) wired to SystemConfig in Settings > General; all hardcoded strings in assistant components replaced with t() calls.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add assistant i18n keys and communication mode setting | 1942827 | src/lib/i18n.tsx, src/components/settings/general-config.tsx |
| 2 | Replace hardcoded strings in assistant components with t() calls | 996d9b4 | assistant-panel.tsx, assistant-chat.tsx, assistant-chat-bubble.tsx |

## What Was Built

### Task 1: i18n Keys + Communication Mode Setting

Added 28 new translation keys to both `zh` and `en` objects in `src/lib/i18n.tsx`:

- `assistant.title`, `assistant.iconLabel`, `assistant.starting`, `assistant.errorTitle`, `assistant.errorBody`
- `assistant.emptyTitle`, `assistant.emptyBody`, `assistant.inputPlaceholder`, `assistant.sendLabel`
- `assistant.thinking`, `assistant.toolLabel`, `assistant.parseError`, `assistant.parseErrorBody`
- `assistant.closeLabel`, `assistant.expandTool`
- `settings.assistant.title`, `settings.assistant.desc`, `settings.assistant.communicationMode`
- `settings.assistant.communicationModeDesc`, `settings.assistant.modeTerminal`, `settings.assistant.modeChat`

Added communication mode Select to `src/components/settings/general-config.tsx`:
- Loads initial value via `getConfigValue("assistant.communicationMode", "terminal")`
- Saves on change via `setConfigValue("assistant.communicationMode", mode)`
- Follows ui.md Select rules: manual `<span>` in SelectTrigger showing localized mode name

### Task 2: Component i18n Migration

- **assistant-panel.tsx**: "Tower Assistant" → `t("assistant.title")`, "Starting..." → `t("assistant.starting")`, "Close assistant" → `t("assistant.closeLabel")`
- **assistant-chat.tsx**: `EmptyState` uses `useI18n()` directly; placeholder and send button aria-label use t() calls
- **assistant-chat-bubble.tsx**: `ThinkingBubble` and `ToolBubble` each call `useI18n()` directly; all hardcoded strings replaced

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type error in handleSaveCommMode**
- **Found during:** Build verification after Task 1
- **Issue:** `handleSaveCommMode(value: string)` was incompatible with base-ui Select's `onValueChange: (value: string | null, ...) => void` signature
- **Fix:** Changed parameter type to `string | null`
- **Files modified:** src/components/settings/general-config.tsx
- **Commit:** Included in Task 1 commit 1942827 (fixed before final commit)

## Known Stubs

None — all i18n keys are properly wired and all assistant strings are fully translated.

## Self-Check

- [x] src/lib/i18n.tsx modified with 28 new keys (42 assistant. matches total)
- [x] src/components/settings/general-config.tsx has communication mode select
- [x] assistant-panel.tsx, assistant-chat.tsx, assistant-chat-bubble.tsx use t() calls
- [x] 0 TODO Phase 39 comments remain
- [x] Build succeeded

## Self-Check: PASSED
