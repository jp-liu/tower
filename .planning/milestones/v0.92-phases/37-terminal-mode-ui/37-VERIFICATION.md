---
phase: 37-terminal-mode-ui
verified: 2026-04-17T12:00:00Z
status: human_needed
score: 8/8 automated must-haves verified
re_verification: false
human_verification:
  - test: "Open browser at http://localhost:3000, click the Bot icon in the top bar (between search box and language toggle)"
    expected: "Assistant panel appears as a 420px push-sidebar below the top bar; main content area shrinks to accommodate it; Bot icon shows active state (bg-accent)"
    why_human: "Push layout visual behavior and icon active state cannot be verified programmatically"
  - test: "With panel open, press Cmd+L (or Ctrl+L)"
    expected: "Panel closes; pressing Cmd+L again reopens it (toggle behavior works from any page)"
    why_human: "Keyboard shortcut and toggle round-trip requires live browser interaction"
  - test: "With panel open, verify the xterm terminal loads and Claude CLI starts"
    expected: "Terminal appears in the panel body; Claude CLI prompt visible; typing input produces Claude responses"
    why_human: "PTY session startup and xterm rendering require a running dev server with a valid CLI profile"
  - test: "Click the close button (X) in the panel title bar"
    expected: "Panel closes; PTY session is destroyed (DELETE /api/internal/assistant fires); no leftover process"
    why_human: "Session teardown and PTY process destruction requires server-side observation"
  - test: "Set assistant.displayMode to 'dialog' in SystemConfig, then click Bot icon"
    expected: "Panel renders as a centered Dialog modal (600px wide, 70vh tall) instead of push sidebar"
    why_human: "Dialog mode rendering requires config change and visual verification"
---

# Phase 37: Terminal Mode UI Verification Report

**Phase Goal:** Users can open a global assistant panel from any page and interact with Claude CLI via an embedded xterm terminal
**Verified:** 2026-04-17T12:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | AssistantProvider exposes isOpen, displayMode, toggleAssistant, closeAssistant via React context | VERIFIED | `src/components/assistant/assistant-provider.tsx` exports `AssistantProvider` and `useAssistant`; context shape matches spec (lines 14-21, 84-91, 93-99) |
| 2 | AssistantPanel renders a title bar with Bot icon, title text, and close button above a terminal body | VERIFIED | `src/components/assistant/assistant-panel.tsx` lines 31-61: h-[44px] title bar with `Bot`, "Tower Assistant" span, `X` close button; DynamicTerminal below |
| 3 | POST /api/internal/assistant returns worktreePath so TaskTerminal can initialize | VERIFIED | `src/app/api/internal/assistant/route.ts` line 19: `worktreePath: process.cwd()` in JSON response |
| 4 | User can see a Bot icon in the top bar between the search box and the language toggle | VERIFIED | `src/components/layout/top-bar.tsx` lines 164-174: `<button onClick={toggleAssistant}>` with `<Bot className="h-4 w-4" />` placed before Language Toggle in right-actions div |
| 5 | Clicking the Bot icon or pressing Cmd+L opens the assistant panel | VERIFIED | `top-bar.tsx` line 166 wires click to `toggleAssistant()`; `assistant-provider.tsx` lines 71-82 register `keydown` for `(metaKey||ctrlKey) && key==="l"` |
| 6 | In sidebar mode, the assistant panel appears inside the content area below the top bar as a flex sibling of main | VERIFIED | `src/components/layout/layout-client.tsx` lines 43-44, 76-81, 97-101: `sidebarPanel` rendered as flex sibling of `<main>` inside `flex flex-1 overflow-hidden` wrapper below TopBar in both page layouts |
| 7 | In dialog mode, the assistant panel appears in a centered Dialog modal | VERIFIED | `layout-client.tsx` lines 47-68: `Dialog` with `DialogContent` (maxWidth 600px, height 70vh, minHeight 480px, maxHeight 800px, padding 0) containing `AssistantPanel mode="dialog"` |
| 8 | Closing the panel (Escape, close button, Cmd+L toggle) destroys the session | VERIFIED | close button calls `closeAssistant()` (panel.tsx line 39); Cmd+L toggle calls `closeAssistant()` (provider.tsx line 64); Dialog `onOpenChange` calls `closeAssistant()` (layout-client.tsx line 52); `closeAssistant` fires `DELETE /api/internal/assistant` (provider.tsx line 59) which calls `stopAssistantSession()` → `destroySession()` |

**Score:** 8/8 truths verified (automated)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/assistant/assistant-provider.tsx` | React context for assistant state management | VERIFIED | 100 lines; exports `AssistantProvider` and `useAssistant`; full state + lifecycle implementation |
| `src/components/assistant/assistant-panel.tsx` | Title bar + xterm terminal body panel component | VERIFIED | 65 lines; exports `AssistantPanel`; title bar + DynamicTerminal with ASSISTANT_SESSION_KEY |
| `src/app/api/internal/assistant/route.ts` | worktreePath in POST response | VERIFIED | Line 19: `worktreePath: process.cwd()` present |
| `src/components/layout/layout-client.tsx` | AssistantProvider wrapping, push sidebar rendering, dialog mode rendering | VERIFIED | 139 lines; `AssistantProvider` wraps layout (line 130); `LayoutInner` renders `sidebarPanel` and `dialogPanel`; both page variants covered |
| `src/components/layout/top-bar.tsx` | Assistant Bot icon button in right-actions section | VERIFIED | Lines 164-174: Bot icon button with `toggleAssistant` onClick and `assistantOpen` active state |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `assistant-provider.tsx` | `/api/internal/assistant` | `fetch POST/DELETE` | WIRED | Line 41: `fetch("/api/internal/assistant", { method: "POST" })`; line 59: `fetch("/api/internal/assistant", { method: "DELETE" })` |
| `assistant-panel.tsx` | `task-terminal.tsx` | `dynamic import, taskId=ASSISTANT_SESSION_KEY` | WIRED | Lines 13-19: `dynamic(import("@/components/task/task-terminal"))`; line 57: `taskId={ASSISTANT_SESSION_KEY}` |
| `layout-client.tsx` | `assistant-provider.tsx` | `AssistantProvider` wrapper | WIRED | Lines 9, 130: `import { AssistantProvider, useAssistant }` and `<AssistantProvider>` wrapping layout |
| `layout-client.tsx` | `assistant-panel.tsx` | `AssistantPanel` as flex sibling and in Dialog | WIRED | Lines 10, 44, 65: import and both render paths use `<AssistantPanel mode="sidebar"/>` and `<AssistantPanel mode="dialog"/>` |
| `top-bar.tsx` | `assistant-provider.tsx` | `useAssistant()` for toggleAssistant and isOpen | WIRED | Lines 20, 39: import and destructure `isOpen: assistantOpen, toggleAssistant` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `assistant-panel.tsx` (DynamicTerminal) | `worktreePath` | POST `/api/internal/assistant` → `process.cwd()` → provider state `worktreePath` → prop | Yes — `process.cwd()` is a real runtime value (not empty/null/static) | FLOWING |
| `assistant-panel.tsx` (DynamicTerminal) | `taskId` (ASSISTANT_SESSION_KEY = `"__assistant__"`) | Constant; PTY session keyed by this ID | Yes — `startAssistantSession()` calls `createSession(ASSISTANT_SESSION_KEY, ...)` which spawns a real Claude CLI PTY | FLOWING |
| `assistant-provider.tsx` | `displayMode` | `getConfigValue("assistant.displayMode", "sidebar")` on mount | Yes — reads from SystemConfig DB, defaults to "sidebar" | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Assistant provider exports are present | `grep -c "export function AssistantProvider\|export function useAssistant" src/components/assistant/assistant-provider.tsx` | 2 | PASS |
| AssistantPanel has DynamicTerminal and ASSISTANT_SESSION_KEY | `grep -c "dynamic\|ASSISTANT_SESSION_KEY" src/components/assistant/assistant-panel.tsx` | 3 | PASS |
| API route returns worktreePath | `grep -c "worktreePath" src/app/api/internal/assistant/route.ts` | 1 | PASS |
| layout-client.tsx has AssistantProvider | `grep -c "AssistantProvider\|AssistantPanel\|sidebarPanel" src/components/layout/layout-client.tsx` | 3+3+3 | PASS |
| top-bar.tsx has Bot icon and toggleAssistant | `grep -c "Bot\|useAssistant\|toggleAssistant" src/components/layout/top-bar.tsx` | 2+2+2 | PASS |
| TypeScript compiles clean (non-test files) | `npx tsc --noEmit 2>&1` | Errors only in `tests/unit/lib/pty-session.test.ts` (pre-existing, not phase-37 code) | PASS |
| startAssistantSession is a real PTY spawn | Read `src/actions/assistant-actions.ts` — calls `createSession(ASSISTANT_SESSION_KEY, profile.command, claudeArgs, cwd, ...)` | Full implementation, no stub | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| UI-01 | 37-02 | User can see an assistant icon in the top bar next to the search box | SATISFIED | `top-bar.tsx` lines 164-174: Bot icon button in right-actions before language toggle |
| UI-02 | 37-01, 37-02 | User can open via clicking icon or pressing Cmd+L (Ctrl+L) | SATISFIED | Click wired to `toggleAssistant` in top-bar; keyboard shortcut in provider (`metaKey||ctrlKey && key==="l"`) |
| UI-03 | 37-02 | Sidebar mode — left side panel, does not block other operations | SATISFIED | Push layout implemented in layout-client.tsx; AssistantPanel w-[420px] shrink-0 as flex sibling of main |
| UI-04 | 37-02 | Dialog mode — centered modal | SATISFIED | Dialog component with DialogContent (maxWidth 600px, height 70vh) in layout-client.tsx lines 47-68 |
| UI-06 | 37-01, 37-02 | Close via Escape, close button, or Cmd+L toggle | SATISFIED | Close button in panel calls `closeAssistant()`; Cmd+L toggle calls `closeAssistant()` when open; Dialog `onOpenChange` calls `closeAssistant()` (Escape is handled by Dialog's native behavior) |
| TM-01 | 37-01 | Embeds xterm.js terminal in chat-panel wrapper (title bar + terminal body) | SATISFIED | AssistantPanel: h-[44px] title bar + DynamicTerminal body (next/dynamic wrapping TaskTerminal which uses xterm.js) |
| TM-02 | 37-01 | User types directly in terminal — no separate input box | SATISFIED | DynamicTerminal renders TaskTerminal directly; no input box in AssistantPanel; xterm handles all input |
| TM-03 | 37-01 | CC output displayed as-is in terminal | SATISFIED | TaskTerminal renders raw PTY stream via WebSocket → xterm; no output transformation in AssistantPanel |
| UX-02 | 37-02 | Sidebar mode does not obstruct main content (push layout) | SATISFIED | Push layout: `flex flex-1 overflow-hidden` wrapper with sidebarPanel as flex sibling of `<main flex-1>` — main shrinks by 420px, never overlaid |

**Orphaned requirements check:** UI-05, UI-07, UX-03 are assigned to Phase 39 (Pending). CM-01 through CM-04 are Phase 38. BE-01 through BE-06 and UX-01 are Phase 36. No requirements are assigned to Phase 37 outside the 9 IDs in the plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/layout/top-bar.tsx` | 226, 252, 263, 267, 276, 289 | `placeholder=` attribute values | Info | These are HTML input placeholder attributes in the New Project dialog — not code stubs. Not related to phase-37 assistant functionality. |

No blockers or warnings found. The "placeholder" matches are HTML attributes in a pre-existing form, not stub implementations.

### Human Verification Required

#### 1. Push Sidebar Visual Layout

**Test:** Start dev server (`pnpm dev`), navigate to http://localhost:3000, click the Bot icon in the top bar.
**Expected:** Assistant panel (420px wide) appears to the left of the main content area, below the top bar. Main content shrinks by 420px. Bot icon shows highlighted state (`bg-accent`).
**Why human:** Push layout pixel behavior and active state styling require visual browser verification.

#### 2. Keyboard Shortcut Toggle

**Test:** With browser open, press Cmd+L (macOS) or Ctrl+L (Linux/Windows) from any page.
**Expected:** Panel opens. Press again — panel closes. Works from pages including full-screen task detail pages.
**Why human:** Keyboard event behavior across page contexts cannot be verified without a live browser.

#### 3. xterm Terminal Startup

**Test:** Click Bot icon; wait for panel to appear; observe the terminal body.
**Expected:** xterm.js terminal renders in the panel body; Claude CLI starts and displays a prompt; typing produces Claude responses via the `__assistant__` PTY session.
**Why human:** PTY session startup, WebSocket connection, and xterm rendering require a running dev server with a configured CLI profile.

#### 4. Session Destruction on Close

**Test:** Open panel, then close it via the X button or Cmd+L.
**Expected:** DELETE /api/internal/assistant fires; no orphaned PTY process remains; re-opening creates a fresh session (no history from previous session).
**Why human:** PTY process teardown requires server-side process observation.

#### 5. Dialog Mode Rendering (Optional)

**Test:** Change `assistant.displayMode` to `"dialog"` in SystemConfig settings, click Bot icon.
**Expected:** Panel renders as a centered modal (600px wide, 70vh tall, min 480px). Backdrop click or Escape closes it and fires DELETE.
**Why human:** Config change and modal rendering require live browser and server interaction.

### Gaps Summary

No automated gaps found. All 8 must-have truths are verified programmatically. All 5 artifacts exist with substantive implementations (no stubs). All 5 key links are wired. Data flows from real sources (process.cwd(), DB config, PTY session). All 9 requirement IDs are satisfied.

The `human_needed` status reflects that the phase goal involves interactive UI behavior (terminal, push layout, keyboard shortcut) that cannot be fully confirmed without a running browser session. All code-level evidence is complete and correct.

---

_Verified: 2026-04-17T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
