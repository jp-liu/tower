---
phase: quick
plan: 260327-fah
subsystem: settings, task-panel
tags: [settings, ai-tools, prompts, simplification]
dependency_graph:
  requires: []
  provides: [simplified-ai-tools-settings, prompt-selector-in-task-panel]
  affects: [src/components/settings/ai-tools-config.tsx, src/app/settings/page.tsx, src/components/task/task-message-input.tsx, src/components/task/task-detail-panel.tsx]
tech_stack:
  added: []
  patterns: [localStorage for local preferences, server action getPrompts() in client component]
key_files:
  created: []
  modified:
    - src/components/settings/ai-tools-config.tsx
    - src/app/settings/page.tsx
    - src/components/task/task-message-input.tsx
    - src/components/task/task-detail-panel.tsx
decisions:
  - "Store default CLI adapter in localStorage (ai-manager:default-cli-adapter) — no DB persistence needed for local preference"
  - "Prompt content prepended inline in handleSend using format: prompt.content + newlines + userMessage"
  - "Auto-select default prompt (isDefault: true) on TaskDetailPanel mount"
metrics:
  duration: "~15 minutes"
  completed: "2026-03-27"
  tasks: 2
  files: 4
---

# Quick Task 260327-fah: Simplify AI Tools Settings + Add Prompt Selector

**One-liner:** Gutted AgentConfig CRUD from AI Tools settings (replaced with localStorage CLI selector) and added a prompt template dropdown to the task panel message input with auto-prepend on send.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Simplify AI Tools settings page | 9f9f020, e89df89 | ai-tools-config.tsx, settings/page.tsx |
| 2 | Add prompt template selector to task message input | 5bb2584 | task-message-input.tsx, task-detail-panel.tsx |

## What Was Built

### Task 1: Simplified AI Tools Settings

- `AIToolsConfig` is now a zero-prop self-contained component
- Removed: AgentConfig CRUD UI (JSON editor, append prompt textarea, config mode toggle, agent+config selectors, save/delete buttons)
- Added: Simple "Default CLI Adapter" section with a Select dropdown backed by `localStorage`
- Settings page (`src/app/settings/page.tsx`) cleaned up: removed all AgentConfig state, handlers, imports (`getAgentConfigs`, `updateAgentConfig`, `deleteAgentConfig`, `Prisma` type, local `AgentConfig` interface)
- `<AIToolsConfig />` now renders with no props

### Task 2: Prompt Template Selector in Task Panel

- `TaskMessageInput` accepts new props: `prompts`, `selectedPromptId`, `onPromptChange`
- A prompt dropdown (FileText icon + selected prompt name or "No Prompt") appears in the toolbar next to the mode selector
- Default prompts show a star icon (Star from lucide-react)
- On send: if a prompt is selected, its content is prepended to the message (`promptContent\n\nuserMessage`)
- `TaskDetailPanel` calls `getPrompts()` on mount, maps to `PromptOption[]`, auto-selects the default prompt (isDefault: true)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript error in Select onValueChange handler**
- **Found during:** Task 1 verification
- **Issue:** The Select component's `onValueChange` signature expects `(value: string | null, eventDetails: ...) => void` but the handler typed `value: string`, causing a TypeScript error
- **Fix:** Changed handler param type to `string | null` with early return guard
- **Files modified:** src/components/settings/ai-tools-config.tsx
- **Commit:** e89df89

## Known Stubs

None — the prompt selector is fully wired to `getPrompts()` and the CLI adapter selector reads/writes real localStorage.

## Verification

- TypeScript: `npx tsc --noEmit` passes with no errors in modified files (pre-existing errors in `agent-config-actions.ts` and `api/tasks/[taskId]/stream/route.ts` are unrelated and pre-existed)
- AI Tools settings section: shows only Default CLI Adapter selector + CLIAdapterTester (no AgentConfig editing UI)
- Task detail panel: prompt dropdown visible in message input toolbar
- Default prompt auto-selected on panel open
- Message sent with selected prompt prepends prompt content

## Self-Check: PASSED

- src/components/settings/ai-tools-config.tsx: FOUND
- src/app/settings/page.tsx: FOUND
- src/components/task/task-message-input.tsx: FOUND
- src/components/task/task-detail-panel.tsx: FOUND
- Commit 9f9f020: FOUND
- Commit 5bb2584: FOUND
- Commit e89df89: FOUND
