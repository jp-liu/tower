# Phase 36: Assistant Backend - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning
**Mode:** Auto-generated (--auto mode, infrastructure phase)

<domain>
## Phase Boundary

The system can spawn a dedicated Claude CLI PTY session for the global assistant with restricted tools and a predefined identity, independent of any task. This differs from existing task-based PTY sessions (keyed by taskId) — the assistant session uses a fixed key (e.g. `__assistant__`), has no TaskExecution DB row, and is destroyed on close with no resume support.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Key considerations from codebase analysis:

- Reuse existing `session-store.ts` and `PtySession` class — the assistant session is just another PTY session with a special key
- Reuse existing WebSocket server (`ws-server.ts`) — the assistant connects via the same WS server with a special identifier
- Create a new `assistant-actions.ts` server action file for assistant-specific logic (startAssistantSession, stopAssistantSession)
- The system prompt and --allowedTools args are built in the server action, not stored in CliProfile
- Add `assistant.systemPrompt` config key to SystemConfig for the predefined identity text
- No TaskExecution record needed — the assistant is stateless

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/pty/session-store.ts` — createSession/destroySession/getSession functions, keyed by string ID
- `src/lib/pty/pty-session.ts` — PtySession class with buffer, resize, write, idle detection
- `src/lib/pty/ws-server.ts` — WebSocket server that wires PTY sessions to browser clients
- `src/lib/config-reader.ts` — readConfigValue for SystemConfig settings
- `src/actions/agent-actions.ts` — existing startPtyExecution pattern to reference

### Established Patterns
- Sessions keyed by taskId string — assistant can use a fixed key like `__assistant__`
- CliProfile determines CLI binary and base args
- Environment overrides passed to PtySession constructor
- WebSocket server polls for session appearance after client connects

### Integration Points
- `ws-server.ts` needs to handle assistant session connections (different from task sessions)
- New server action file for assistant lifecycle
- Config key for system prompt text

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase.

</deferred>
