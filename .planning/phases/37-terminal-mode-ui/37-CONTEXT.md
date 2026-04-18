# Phase 37: Terminal Mode UI - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning
**Mode:** Smart discuss (--auto, all recommended accepted)

<domain>
## Phase Boundary

Users can open a global assistant panel from any page and interact with Claude CLI via an embedded xterm terminal. The panel renders as either a left sidebar (push layout) or a centered dialog modal. Terminal mode uses xterm.js for raw CLI output — no parsing, no message bubbles (that's Phase 38). The assistant icon appears in the top bar next to the search box.

</domain>

<decisions>
## Implementation Decisions

### Panel Layout & Rendering
- Use a plain flex `div` for sidebar mode (NOT Sheet) — Sheet uses `fixed z-50` overlay positioning which violates UX-02 push layout requirement. The sidebar must be a flex sibling of `<main>` to achieve push layout.
- Use the existing `Dialog` component for dialog/modal mode — already used in top-bar.tsx and elsewhere
- Sidebar width: 420px fixed — wide enough for terminal output, not too wide to block main content
- Push layout for sidebar (UX-02): main content area shrinks when sidebar is open, not an overlay that blocks interaction
- The panel component (`AssistantPanel`) wraps a title bar + terminal body regardless of sidebar or dialog mode

### Terminal Integration
- Reuse the WebSocket connection pattern from `task-terminal.tsx` — connect to `ws://localhost:${wsPort}/terminal?taskId=__assistant__`
- Reuse xterm.js lifecycle from the existing task terminal: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`
- Terminal theme matches the existing task terminal appearance (same color scheme, same font)
- Terminal auto-fits to panel dimensions on open and on resize using `@xterm/addon-fit`
- No separate input box in terminal mode (TM-02) — xterm handles input directly

### Keyboard & Interaction
- Toggle shortcut: Cmd+L (macOS) / Ctrl+L (Windows/Linux) — distinct from Cmd+K search
- Close via: Escape key, close button in title bar, or Cmd+L toggle
- All close actions destroy the assistant session (stateless per UX-01/BE-05)
- No auto-open on page load — user-initiated via icon click or keyboard shortcut

### State Management
- Use React context (`AssistantProvider`) at the layout level for panel open/close state + display mode
- Session lifecycle: call `POST /api/internal/assistant` on open, `DELETE /api/internal/assistant` on close
- Read `assistant.displayMode` from SystemConfig on mount to determine sidebar vs dialog rendering
- The provider wraps the layout and exposes `toggleAssistant()`, `isOpen`, `displayMode`

### Claude's Discretion
- Exact positioning and animation of sidebar slide-in
- Title bar content (icon, title text, close button arrangement)
- Loading state while assistant session is being created

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ui/sheet.tsx` — Sheet component with left/right/top/bottom sides, overlay, close button
- `src/components/ui/dialog.tsx` — Dialog component for modal rendering
- `src/components/task/task-terminal.tsx` — WebSocket + xterm.js terminal with connection, resize, and cleanup patterns
- `src/components/layout/top-bar.tsx` — Top bar with search button, Cmd+K shortcut, right-side actions
- `src/components/layout/layout-client.tsx` — Layout wrapper with TopBar + sidebar + main content

### Established Patterns
- `useI18n()` hook for all user-facing strings
- `useEffect` for keyboard shortcuts (see top-bar.tsx lines 52-61)
- Server action calls for session lifecycle
- `fetch()` to internal API routes for non-server-action operations
- Terminal portal pattern in `terminal-portal.tsx` for cross-component terminal rendering

### Integration Points
- Assistant icon: Add to `top-bar.tsx` right-actions section, between search and settings
- Panel rendering: Wrap in `layout-client.tsx` via a new `AssistantProvider`
- WebSocket: Connect to existing ws-server on port from `terminal.wsPort` config
- Session lifecycle: `POST/DELETE /api/internal/assistant` routes (created in Phase 36)

</code_context>

<specifics>
## Specific Ideas

- The assistant icon should use the `Bot` or `MessageSquare` icon from lucide-react
- Title bar should show "Tower Assistant" with a close button
- The Cmd+L shortcut should be registered at the layout level, not per-page

</specifics>

<deferred>
## Deferred Ideas

- Chat mode (message bubbles, Markdown rendering) — Phase 38
- Mode switching in Settings — Phase 39
- Responsive sizing — Phase 39
- i18n for all assistant text — Phase 39

</deferred>
