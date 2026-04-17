# Requirements — v0.92 Global Chat Assistant

**Defined:** 2026-04-17
**Core Value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base.

## UI

- [ ] **UI-01**: User can see an assistant icon in the top bar next to the search box
- [ ] **UI-02**: User can open the chat assistant via clicking the icon or pressing Cmd+L (Ctrl+L)
- [ ] **UI-03**: User can use the assistant in sidebar mode (left side panel, does not block other operations)
- [ ] **UI-04**: User can use the assistant in dialog mode (centered modal)
- [ ] **UI-05**: User can switch between sidebar and dialog mode in Settings
- [ ] **UI-06**: User can close the assistant via Escape, close button, or Cmd+L toggle
- [ ] **UI-07**: User can see all UI text in Chinese or English (i18n)

## Terminal Mode (xterm)

- [ ] **TM-01**: Assistant embeds an xterm.js terminal in a chat-panel wrapper (title bar + terminal body)
- [ ] **TM-02**: User can type directly in the terminal (xterm handles input, no separate input box)
- [ ] **TM-03**: CC output is displayed as-is in the terminal (Markdown tables/lists rendered by CC itself)

## Chat Mode (message bubbles)

- [ ] **CM-01**: System parses CC output stream into structured messages (user / assistant / thinking / tool-call)
- [ ] **CM-02**: User can see AI responses rendered as Markdown bubbles (tables, lists, code blocks)
- [ ] **CM-03**: User can type in an input box and send via Enter (Shift+Enter for newline)
- [ ] **CM-04**: User can see a thinking/loading indicator while AI is responding

## Backend

- [x] **BE-01**: System creates a new Claude CLI PTY session when user opens the assistant
- [x] **BE-02**: System injects a system prompt defining the assistant's identity and capabilities via --append-system-prompt
- [x] **BE-03**: System restricts tools to Tower MCP only via --allowedTools "mcp__tower__*"
- [x] **BE-04**: System connects the assistant to the PTY session via WebSocket for real-time streaming
- [x] **BE-05**: System destroys the PTY session when the assistant is closed (stateless)
- [x] **BE-06**: System supports a config key to switch between terminal mode and chat mode

## UX

- [x] **UX-01**: Each assistant open starts a fresh session with no prior history
- [ ] **UX-02**: Sidebar mode does not obstruct the main content area (push layout or overlay)
- [ ] **UX-03**: Responsive sizing for both modes

## Future Requirements

- Chat history persistence across sessions
- Voice input support
- Context-aware mode (inject current page context)
- Customizable system prompt in settings

## Out of Scope

- Code editing capabilities — assistant is operator, not developer
- Read/Edit/Bash tools — explicitly blocked via --allowedTools
- Chat history database table — stateless by design
- File upload in chat — use task references instead

## Traceability

| REQ | Phase | Status |
|-----|-------|--------|
| UI-01 | Phase 37 | Pending |
| UI-02 | Phase 37 | Pending |
| UI-03 | Phase 37 | Pending |
| UI-04 | Phase 37 | Pending |
| UI-05 | Phase 39 | Pending |
| UI-06 | Phase 37 | Pending |
| UI-07 | Phase 39 | Pending |
| TM-01 | Phase 37 | Pending |
| TM-02 | Phase 37 | Pending |
| TM-03 | Phase 37 | Pending |
| CM-01 | Phase 38 | Pending |
| CM-02 | Phase 38 | Pending |
| CM-03 | Phase 38 | Pending |
| CM-04 | Phase 38 | Pending |
| BE-01 | Phase 36 | Complete |
| BE-02 | Phase 36 | Complete |
| BE-03 | Phase 36 | Complete |
| BE-04 | Phase 36 | Complete |
| BE-05 | Phase 36 | Complete |
| BE-06 | Phase 36 | Complete |
| UX-01 | Phase 36 | Complete |
| UX-02 | Phase 37 | Pending |
| UX-03 | Phase 39 | Pending |
