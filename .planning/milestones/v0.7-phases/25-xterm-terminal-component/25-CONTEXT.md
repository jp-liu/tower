# Phase 25: xterm.js Terminal Component - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the browser-side xterm.js terminal component that connects to the Phase 24 WebSocket server. Four capabilities: (1) xterm.js terminal rendering ANSI output from PTY, (2) keyboard input forwarded to PTY via WebSocket, (3) resize sync (FitAddon + ResizeObserver → WS resize message → PTY resize), (4) theme following app dark/light setting.

</domain>

<decisions>
## Implementation Decisions

### Component Structure
- **D-01:** New `src/components/task/task-terminal.tsx` — "use client" component, loaded via `dynamic({ ssr: false })` (xterm.js accesses `window` at import time, same pattern as Monaco Editor in Phase 21).
- **D-02:** Install `@xterm/addon-attach` for automatic WS↔terminal piping. Already have `@xterm/xterm` + `@xterm/addon-fit`.

### WebSocket Connection
- **D-03:** Connect to `ws://localhost:3001/terminal?taskId={taskId}`. URL constructed from prop. Connection established on mount, closed on unmount.
- **D-04:** AttachAddon handles bidirectional data piping automatically — no manual `ws.onmessage` / `terminal.onData` wiring needed.

### Resize
- **D-05:** FitAddon + ResizeObserver on container div. On resize: `fitAddon.fit()` → `terminal.onResize(({cols, rows}) => ws.send(JSON.stringify({type:"resize", cols, rows})))`.
- **D-06:** Debounce resize messages to avoid flooding (100ms debounce).

### Theme
- **D-07:** `useTheme()` from next-themes — map `resolvedTheme` to xterm.js theme object. Dark: bg `#0a0a0a`, fg `#e5e5e5`. Light: bg `#fafafa`, fg `#171717`. Apply via `terminal.options.theme = {...}`.

### Claude's Discretion
- Exact ANSI color palette values
- Terminal font size (recommend 13px to match Monaco)
- Scrollback buffer size (recommend 5000 lines)
- Whether to show a connection status indicator
- i18n key naming

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/task/code-editor.tsx` — `dynamic({ ssr: false })` pattern, exact same approach needed
- `src/lib/pty/ws-server.ts` — Phase 24, WS server on port 3001 accepting `?taskId=xxx`
- `next-themes` useTheme — already used in code-editor for Monaco theme sync

### Integration Points
- Phase 26 will replace `TaskConversation` in `task-page-client.tsx` with this `TaskTerminal` component
- This phase only creates the component — no page wiring yet
- Props needed: `taskId: string`, `onSessionEnd?: (exitCode: number) => void`

</code_context>

<specifics>
## Specific Ideas

No specific requirements — follow research patterns (xterm.js + FitAddon + AttachAddon).

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>

---

*Phase: 25-xterm-terminal-component*
*Context gathered: 2026-04-02*
