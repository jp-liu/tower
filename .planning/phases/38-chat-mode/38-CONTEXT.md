# Phase 38: Chat Mode - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning
**Mode:** Smart discuss (--auto, all recommended accepted)

<domain>
## Phase Boundary

Users can interact with the assistant via a chat bubble interface with Markdown-rendered responses instead of raw terminal output. The system parses the Claude CLI PTY output stream into structured segments (user messages, assistant responses, thinking indicators, tool-call blocks) and renders them as styled chat bubbles with proper Markdown formatting.

</domain>

<decisions>
## Implementation Decisions

### Output Parsing Strategy
- Parse the raw PTY output stream character-by-character to detect Claude CLI output patterns: user prompts (lines starting with `>`), assistant responses (Markdown content blocks), thinking indicators (`⏳` or spinner patterns), and tool-call blocks (structured output sections)
- Use a state machine parser that accumulates content into segments: `{ role: "user" | "assistant" | "thinking" | "tool", content: string }`
- The parser runs on the raw text AFTER stripping ANSI escape codes — use a library like `strip-ansi` or a regex-based stripper
- The parser is incremental — it processes new chunks as they arrive from the WebSocket, appending to the current segment or starting a new one

### Chat Bubble Rendering
- Use `react-markdown` with `remark-gfm` for rendering assistant responses — supports tables, lists, code blocks, inline formatting
- Code blocks use syntax highlighting via `rehype-highlight` or a lightweight alternative
- User messages render as right-aligned bubbles with a distinct background color
- Assistant messages render as left-aligned bubbles with Markdown formatting
- Thinking indicators show as a subtle animated indicator (pulsing dots or spinner)
- Tool-call blocks render as collapsed/expandable sections showing the tool name and result

### Input Interface
- Text input box at the bottom of the panel with Send button
- Enter sends the message (forwards text + newline to the PTY via WebSocket)
- Shift+Enter inserts a newline in the input (multi-line support)
- The input box auto-focuses when the panel opens
- Sent messages appear immediately as user bubbles before the PTY echoes them

### Integration with Existing Infrastructure
- Chat mode is an ALTERNATIVE view to terminal mode — both use the same PTY session and WebSocket connection
- The `assistant.displayMode` config key (from Phase 36) already supports `"terminal" | "chat"` — this phase adds the `"chat"` rendering path
- The `AssistantPanel` component from Phase 37 is extended with a `renderMode` prop: `"terminal"` (existing) or `"chat"` (new)
- WebSocket data flows through the same connection — chat mode intercepts the raw data and parses it instead of writing to xterm.js

### Claude's Discretion
- Exact parsing heuristics for detecting message boundaries in Claude CLI output
- Chat bubble styling details (border radius, padding, max-width)
- Whether to show raw terminal output as a fallback for unparseable segments
- Animation details for thinking indicator

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/assistant/assistant-panel.tsx` — AssistantPanel with title bar + terminal body (extend with chat mode)
- `src/components/assistant/assistant-provider.tsx` — Session lifecycle, WebSocket connection via TaskTerminal
- `src/components/task/task-terminal.tsx` — WebSocket connection pattern, resize handling
- `src/lib/assistant-constants.ts` — ASSISTANT_SESSION_KEY

### Established Patterns
- Dynamic imports with `next/dynamic({ ssr: false })` for browser-only components
- WebSocket connection to `ws://localhost:${wsPort}/terminal?taskId=__assistant__`
- PTY data arrives as raw string chunks via WebSocket `onmessage`

### Integration Points
- `AssistantPanel` gets a new `renderMode` prop
- `AssistantProvider` reads `assistant.displayMode` and passes it to panel
- New `AssistantChat` component handles message parsing + bubble rendering
- WebSocket connection shared between terminal and chat modes

</code_context>

<specifics>
## Specific Ideas

- Consider using a custom hook `useAssistantChat` that manages the parsed message array and handles WebSocket data interception
- The message parser should handle Claude CLI's specific output format: `╭─`, `╰─` box drawing characters for message boundaries
- For code blocks, use a lightweight syntax highlighter that doesn't add too much bundle size

</specifics>

<deferred>
## Deferred Ideas

- Chat history persistence across sessions — future requirement
- Voice input support — future requirement
- Context-aware mode (inject current page context) — future requirement
- i18n for chat UI text — Phase 39

</deferred>
