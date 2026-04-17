---
phase: 37-terminal-mode-ui
plan: "02"
subsystem: layout
tags: [assistant, layout, top-bar, push-sidebar, dialog]
dependency_graph:
  requires: ["37-01"]
  provides: ["assistant-icon-top-bar", "push-sidebar-layout", "dialog-mode-layout"]
  affects: ["src/components/layout/layout-client.tsx", "src/components/layout/top-bar.tsx"]
tech_stack:
  added: []
  patterns: ["push-sidebar", "provider-pattern", "inner-component-pattern"]
key_files:
  created: []
  modified:
    - src/components/layout/layout-client.tsx
    - src/components/layout/top-bar.tsx
decisions:
  - "LayoutInner inner component pattern used to call useAssistant() inside AssistantProvider boundary"
  - "showCloseButton=false on DialogContent since AssistantPanel provides its own close button"
  - "CreateProjectData interface duplicated in layout-client.tsx for LayoutInner prop typing"
metrics:
  duration: "2m"
  completed_date: "2026-04-17"
  tasks_completed: 3
  files_modified: 2
---

# Phase 37 Plan 02: Layout Integration Summary

One-liner: Bot icon in top-bar and AssistantProvider+panel wired into layout-client with push-sidebar and dialog rendering modes.

## What Was Built

Wired the assistant panel (built in Plan 01) into the live layout so users can access it from any page.

**top-bar.tsx changes:**
- Added `Bot` icon import from lucide-react
- Added `useAssistant` import from assistant-provider
- Destructure `isOpen: assistantOpen, toggleAssistant` from useAssistant hook
- Bot icon button inserted before Language Toggle in right-actions section
- Button shows active state (`bg-accent text-foreground`) when assistant panel is open
- aria-label hardcoded English: "Assistant ⌘L" (i18n deferred to Phase 39)

**layout-client.tsx changes:**
- Imports: `AssistantProvider`, `useAssistant`, `AssistantPanel`, `Dialog`, `DialogContent`
- `LayoutInner` inner component extracted — calls `useAssistant()` inside the provider boundary
- Sidebar mode: `AssistantPanel mode="sidebar"` renders as flex sibling of `<main>` in a `flex flex-1 overflow-hidden` wrapper below TopBar (push layout — main shrinks by 420px)
- Dialog mode: `AssistantPanel mode="dialog"` renders inside `Dialog` component (600px wide, 70vh, min 480px, max 800px, padding 0)
- Dialog `onOpenChange` calls `closeAssistant()` to ensure PTY session is destroyed on backdrop click/Escape
- Both render paths (task detail/sub pages and main layout with AppSidebar) support both modes
- `LayoutClient` exported function wraps everything: `AssistantProvider > TerminalPortalProvider > LayoutInner`

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1: Add Bot icon to top-bar | 82ce4bd | feat(terminal-mode-ui-37.02): add assistant Bot icon to top-bar |
| 2: Integrate AssistantProvider | 19361dd | feat(terminal-mode-ui-37.02): integrate AssistantProvider and panel into layout-client |

## Task Completion

- [x] Task 1: Add assistant icon to top-bar.tsx — DONE (82ce4bd)
- [x] Task 2: Integrate AssistantProvider and panel into layout-client.tsx — DONE (19361dd)
- [x] Task 3: Verify assistant panel end-to-end — AUTO-APPROVED (--auto mode, TypeScript clean, structural greps passed)

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- TypeScript compiles cleanly (no errors in non-test files)
- `grep -c "Bot" top-bar.tsx` → 2 (import + JSX)
- `grep -c "useAssistant" top-bar.tsx` → 2 (import + usage)
- `grep -c "AssistantProvider" layout-client.tsx` → 3
- `grep -c "AssistantPanel" layout-client.tsx` → 3
- `grep -c "sidebarPanel" layout-client.tsx` → 3

## Self-Check: PASSED
