# Phase 38: Chat Mode - Research

**Researched:** 2026-04-17
**Domain:** React chat UI, WebSocket data parsing, Claude CLI output format, Markdown rendering
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Output Parsing Strategy:**
- Parse raw PTY output stream character-by-character to detect Claude CLI output patterns: user prompts (lines starting with `>`), assistant responses (Markdown content blocks), thinking indicators (`⏳` or spinner patterns), tool-call blocks (structured output sections)
- Use a state machine parser that accumulates content into segments: `{ role: "user" | "assistant" | "thinking" | "tool", content: string }`
- Parser runs on raw text AFTER stripping ANSI escape codes
- Parser is incremental — processes new chunks as they arrive from WebSocket

**Chat Bubble Rendering:**
- Use `react-markdown` with `remark-gfm` for rendering assistant responses
- Code blocks use syntax highlighting via `rehype-highlight` or a lightweight alternative
- User messages: right-aligned bubbles with distinct background color
- Assistant messages: left-aligned bubbles with Markdown formatting
- Thinking indicators: subtle animated indicator (pulsing dots or spinner)
- Tool-call blocks: collapsed/expandable sections showing tool name and result

**Input Interface:**
- Text input box at the bottom of the panel with Send button
- Enter sends the message; Shift+Enter inserts newline
- Input box auto-focuses when panel opens
- Sent messages appear immediately as user bubbles before PTY echo

**Integration with Existing Infrastructure:**
- Chat mode is an ALTERNATIVE view to terminal mode — same PTY session and WebSocket connection
- `assistant.displayMode` config key supports `"terminal" | "chat"` — this phase adds the `"chat"` rendering path
- `AssistantPanel` extended with `renderMode` prop: `"terminal"` (existing) or `"chat"` (new)
- WebSocket data flows through same connection — chat mode intercepts raw data instead of writing to xterm.js

### Claude's Discretion

- Exact parsing heuristics for detecting message boundaries in Claude CLI output
- Chat bubble styling details (border radius, padding, max-width)
- Whether to show raw terminal output as a fallback for unparseable segments
- Animation details for thinking indicator

### Deferred Ideas (OUT OF SCOPE)

- Chat history persistence across sessions
- Voice input support
- Context-aware mode (inject current page context)
- i18n for chat UI text — Phase 39
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CM-01 | System parses CC output stream into structured messages (user / assistant / thinking / tool-call) | State machine parser architecture, ANSI stripping, Claude CLI output format |
| CM-02 | User can see AI responses rendered as Markdown bubbles (tables, lists, code blocks) | react-markdown v10 + remark-gfm v4 pattern verified in note-card.tsx, `prose prose-sm dark:prose-invert` |
| CM-03 | User can type in an input box and send via Enter (Shift+Enter for newline) | Textarea component exists, WebSocket send pattern confirmed in task-terminal.tsx |
| CM-04 | User can see a thinking/loading indicator while AI is responding | animate-pulse + staggered animation-delay, tw-animate-css already in globals.css |
</phase_requirements>

---

## Summary

Phase 38 adds chat mode as an alternative rendering path for the assistant panel that already exists from Phase 37. The core work is: (1) parsing the raw PTY WebSocket stream into structured message segments, (2) rendering those segments as styled chat bubbles with Markdown support, and (3) providing a text input interface to send messages to the PTY.

All UI dependencies are already installed. `react-markdown` v10 and `remark-gfm` v4 are in `package.json` and used by `note-card.tsx`. The `@tailwindcss/typography` plugin is active in `globals.css`. `tw-animate-css` is imported for animation classes. No new package installs are required.

The primary technical challenge is the PTY output parser. Claude CLI writes to the terminal with ANSI escape codes and box-drawing characters (`╭─`, `╰─`). A regex-based ANSI stripper (inline, no new package) plus a state-machine parser is the right approach. The parser must be incremental and handle partial chunks delivered by WebSocket.

**Primary recommendation:** Use an inline ANSI-stripping regex (no extra package) + a state machine with states `idle`, `user`, `assistant`, `thinking`, `tool` that accumulates text into message objects. The hook `useAssistantChat` owns this logic. The `AssistantPanel` switches between `DynamicTerminal` (terminal mode) and the new `AssistantChat` component (chat mode) based on a `renderMode` prop derived from `assistant.displayMode` config.

---

## Standard Stack

### Core (all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react-markdown` | ^10.1.0 | Render Markdown as React elements | Already in package.json, used by note-card.tsx |
| `remark-gfm` | ^4.0.1 | GFM extension: tables, strikethrough, task lists | Already in package.json, used alongside react-markdown |
| `@tailwindcss/typography` | ^0.5.19 | `prose` utility classes for Markdown output | Already active in globals.css, note-card.tsx uses `prose prose-sm dark:prose-invert` |
| `tw-animate-css` | (installed) | `animate-in`, `fade-in`, `slide-in-from-bottom-*` | Already imported in globals.css |

### Supporting (already installed, from existing components)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | (installed) | Icons: `SendHorizonal`, `Bot`, `ChevronRight`, `ChevronDown` | Used throughout project |
| `@/components/ui/textarea` | n/a | Auto-resize input | Base UI component already in project |
| `@/components/ui/scroll-area` | n/a | Scrollable message list | Base UI component already in project |
| `@/components/ui/button` | n/a | Send button, ghost variant | Base UI component already in project |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline ANSI regex stripper | `strip-ansi` npm package | strip-ansi v7 is ESM-only; Next.js handles it via bundler BUT no runtime benefit vs a 3-line regex. Regex is zero-dependency and already understood by the team. |
| `react-markdown` | Custom Markdown renderer | react-markdown is battle-tested, already installed, handles edge cases. Hand-rolling not justified. |
| `rehype-highlight` for syntax | `rehype-prism-plus` or inline `prism-react-renderer` | rehype-highlight adds bundle weight. For the assistant chat context, `bg-muted font-mono` styling on code blocks is sufficient without per-token coloring. Can add later. |

**Installation:** No new packages required. All dependencies are already present.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── components/assistant/
│   ├── assistant-panel.tsx          # MODIFY: add renderMode prop, conditionally mount chat vs terminal
│   ├── assistant-provider.tsx       # MODIFY: expose renderMode from assistant.displayMode config
│   ├── assistant-chat.tsx           # NEW: message list + input area
│   └── assistant-chat-bubble.tsx    # NEW: single bubble (user/assistant/thinking/tool variants)
├── hooks/
│   └── use-assistant-chat.ts        # NEW: state machine parser + message state + send handler
```

Note: `src/hooks/` directory does not currently exist — it will be created as part of this phase.

### Pattern 1: AssistantProvider exposes renderMode

`assistant.displayMode` config key already exists (default `"terminal"`). The provider reads it on mount. This phase adds the concept of `renderMode` (chat/terminal) as a second dimension alongside `displayMode` (sidebar/dialog). In practice, `assistant.displayMode` serves BOTH roles — the value `"chat"` signals chat rendering, and the panel/dialog layout is inferred from a separate key.

**Current config key:** `assistant.displayMode` defaults to `"terminal"` (from `config-defaults.ts` line 90).

The provider already reads this key but only uses it for sidebar/dialog layout. Phase 38 should use a **separate config key** `assistant.communicationMode` with values `"terminal" | "chat"` to avoid conflating layout mode with communication mode. However, per the locked decisions, the CONTEXT.md says "The `assistant.displayMode` config key (from Phase 36) already supports `"terminal" | "chat"`" — so the decision is to reuse `assistant.displayMode` for both. The planner should confirm this dual-use is intentional vs. creating `assistant.communicationMode`.

**Practical consequence:** The provider needs to distinguish sidebar/dialog (layout) from terminal/chat (rendering). Since the CONTEXT.md locks the use of `assistant.displayMode`, the panel must read it and branch on the value.

### Pattern 2: useAssistantChat Hook — State Machine Parser

```typescript
// Source: CONTEXT.md locked decision + task-terminal.tsx WebSocket pattern
type MessageRole = "user" | "assistant" | "thinking" | "tool";

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolName?: string;       // only for role === "tool"
  isStreaming?: boolean;   // true while content is still accumulating
}

// State machine states
type ParserState = "idle" | "user" | "assistant" | "thinking" | "tool";

// Hook returns
interface UseAssistantChatReturn {
  messages: ChatMessage[];
  isThinking: boolean;
  sendMessage: (text: string) => void;
  wsStatus: "connecting" | "connected" | "disconnected";
}
```

The hook:
1. Creates its own WebSocket connection to `ws://localhost:${wsPort}/terminal?taskId=__assistant__` (same endpoint as terminal mode)
2. Intercepts raw message events and feeds chunks to the parser
3. Does NOT mount or interact with xterm.js

### Pattern 3: ANSI Stripping

```typescript
// Inline regex — no external dependency
// Covers standard ANSI escape sequences: CSI, OSC, color codes, cursor movement
const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\](?:[^\x07\x1B]|\x1B[\\])*(?:\x07|\x1B\\))/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}
```

This pattern covers the full range of ANSI sequences including OSC (used by some terminals for window title setting) without needing an external ESM-only package.

### Pattern 4: Incremental Parser

The parser must handle partial chunks. Claude CLI streams output in variable-length chunks — a single message boundary may arrive split across multiple WebSocket messages.

```typescript
// Accumulate raw buffer; parse complete lines only
// Strategy: buffer incoming text, split on \n, process complete lines,
// keep incomplete last line in buffer until next chunk arrives
```

Key detection heuristics for Claude CLI output (confirmed in CONTEXT.md specifics section):
- `╭─` or `╭──` at start of line → start of a new message block (user input display)
- `╰─` or `╰──` at start of line → end of a message block
- `>` at line start (inside user box) → user prompt indicator
- Lines with `⏳` or spinner Unicode → thinking state
- Tool use output is often formatted as structured blocks with tool name on first line
- Plain text lines between box boundaries → assistant response content

### Pattern 5: react-markdown Usage (verified from note-card.tsx)

```tsx
// Source: src/components/notes/note-card.tsx line 57-59
// The project already uses this exact pattern
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

<div className="prose prose-sm dark:prose-invert">
  <ReactMarkdown remarkPlugins={[remarkGfm]}>
    {content}
  </ReactMarkdown>
</div>
```

For code blocks without heavy syntax highlighting, use custom components:

```tsx
// Override pre/code to apply project design tokens
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    code({ className, children, ...props }) {
      const isBlock = className?.startsWith("language-");
      return isBlock ? (
        <code className={`${className} block bg-muted rounded-md p-3 font-mono text-[13px] overflow-x-auto`} {...props}>
          {children}
        </code>
      ) : (
        <code className="bg-muted px-1 rounded text-[13px] font-mono" {...props}>
          {children}
        </code>
      );
    },
  }}
>
  {content}
</ReactMarkdown>
```

### Anti-Patterns to Avoid

- **Don't create a second WebSocket in chat mode if one is already open for terminal mode:** The switch between modes should close/reopen the connection cleanly. Since chat and terminal mode are mutually exclusive at render time (one or the other is mounted), each mode owns its own WebSocket lifecycle via its component's useEffect.
- **Don't write to xterm.js in chat mode:** The `DynamicTerminal` component should NOT be mounted in chat mode — it is not rendered at all. Only the `AssistantChat` component mounts.
- **Don't parse inside the WebSocket `onmessage` handler synchronously in a way that blocks the event loop:** Use `useState` + `useCallback` to batch state updates via React's batching mechanism.
- **Don't use `strip-ansi` package directly:** The package is ESM-only and adds unnecessary complexity. A regex covers all required cases.
- **Don't add i18n keys for chat UI text in this phase:** CONTEXT.md explicitly defers i18n to Phase 39. Use hardcoded strings with `// TODO Phase 39: i18n` comments.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | Custom Markdown parser | `react-markdown` + `remark-gfm` | Already installed, handles GFM edge cases (tables, nested lists, task lists) |
| Scroll management | Custom scroll container | `ScrollArea` from `@/components/ui/scroll-area` | Already in project, handles cross-browser overflow |
| Textarea auto-resize | Custom resize logic | `Textarea` from `@/components/ui/textarea` | Base UI component already handles this |
| Animation entry | Custom CSS keyframes | `animate-in fade-in slide-in-from-bottom-2` from `tw-animate-css` | Already imported in globals.css |
| Pulsing dots | Custom keyframe | `animate-pulse` from Tailwind | Built-in Tailwind utility |

**Key insight:** Zero new package installs needed. The entire chat UI can be built from components and libraries already present in the project.

---

## Common Pitfalls

### Pitfall 1: assistant.displayMode Dual Use Confusion

**What goes wrong:** `assistant.displayMode` currently stores `"sidebar" | "dialog"` layout preference. CONTEXT.md says it supports `"terminal" | "chat"`. These are two different axes. If the plan conflates them, rendering breaks (a user in "dialog" mode gets wrong defaults, etc.).

**Why it happens:** The config key was named before the two axes were clearly separated. Phase 36 added `BE-06` ("config key to switch between terminal and chat mode") but the key name `displayMode` implies layout, not communication mode.

**How to avoid:** Inspect `config-defaults.ts` — the current default is `"terminal"` (not `"sidebar"`). This confirms the key was INTENDED for terminal/chat (communication mode), not layout. Layout mode is handled by `AssistantProvider`'s `displayMode` state which reads the same key but interprets values differently. The planner must add a new config entry `assistant.communicationMode: "terminal" | "chat"` OR clearly document that `assistant.displayMode` = `"terminal"` means terminal rendering and `"sidebar"` / `"dialog"` are for layout in a separate config key. The safest path is separate keys.

**Warning signs:** `getConfigValue("assistant.displayMode", "sidebar")` returns `"terminal"` — sidebar is the wrong default if the key means layout.

### Pitfall 2: ANSI Escape Codes in Parser Input

**What goes wrong:** The parser receives raw WebSocket data including ANSI cursor movement codes (`\x1B[A`, `\x1B[2K`), color codes, and other terminal control sequences. If ANSI stripping is incomplete, box-drawing character detection fails and messages are misclassified.

**Why it happens:** Claude CLI uses ANSI codes extensively for cursor repositioning (to overwrite previous output), color, and formatting. Raw PTY output is not plain text.

**How to avoid:** Strip ANSI before feeding to parser. Use the comprehensive ANSI_REGEX pattern (covers CSI, OSC, and standard escape sequences). Apply stripping per-chunk before appending to the line buffer.

**Warning signs:** Parser produces empty messages or misses `╭─` boundaries when tested with real Claude CLI output.

### Pitfall 3: Incremental Parsing with Split Chunks

**What goes wrong:** A WebSocket chunk ends mid-line. The parser treats the partial line as a complete segment and creates a spurious message boundary.

**Why it happens:** TCP/WebSocket does not guarantee line-aligned delivery. Claude CLI may flush buffers mid-line.

**How to avoid:** Maintain a `lineBuffer` string in the parser. Append each new chunk to the buffer, then split on `\n` and process only complete lines (the last element after split may be partial — keep it in the buffer).

**Warning signs:** Messages appear split at wrong points, or thinking indicator doesn't clear properly.

### Pitfall 4: WebSocket Double Connection

**What goes wrong:** Both `TaskTerminal` (xterm.js) and `useAssistantChat` try to connect to the same WebSocket endpoint. The WS server may reject or mishandle duplicate connections for the same taskId.

**Why it happens:** If the mode switch doesn't cleanly unmount the terminal component before mounting the chat component, both attempt to connect simultaneously.

**How to avoid:** Ensure `AssistantPanel` conditionally renders EITHER `DynamicTerminal` OR `AssistantChat` based on `renderMode` — never both simultaneously. Verify the WS server allows at most one connection per taskId (check `src/lib/pty/` ws-server).

**Warning signs:** One connection receives no data or terminal echoes appear as duplicate messages in chat.

### Pitfall 5: i18n Type Safety

**What goes wrong:** Adding new i18n keys in `src/lib/i18n.tsx` requires both `zh` and `en` translation objects to have the same keys. The type `TranslationKey = keyof typeof translations.zh` — if a key is only in `en` but not `zh`, TypeScript does not catch this because only `zh` is used for the key type.

**Why it happens:** The i18n file uses a const object, and the key type is derived from the `zh` object. Missing `en` keys cause silent fallback to the key string at runtime.

**How to avoid:** Always add keys to BOTH `zh` and `en` objects simultaneously. Since Phase 39 handles i18n, use hardcoded strings with `// TODO Phase 39: i18n` comments in Phase 38 — don't add keys yet.

---

## Code Examples

Verified patterns from existing code:

### WebSocket Connection Pattern (from task-terminal.tsx)

```typescript
// Source: src/components/task/task-terminal.tsx lines 100-148
getConfigValue<number>("terminal.wsPort", 3001).then((wsPort) => {
  if (cancelled) return;
  const socket = new WebSocket(
    `ws://localhost:${wsPort}/terminal?taskId=${encodeURIComponent(taskId)}`
  );
  socket.addEventListener("message", (event) => {
    const data = event.data;
    if (typeof data === "string") {
      // In chat mode: feed to parser instead of terminal.write(data)
      parseChunk(data);
    }
  });
});
```

### Sending to PTY (from task-terminal.tsx)

```typescript
// Source: src/components/task/task-terminal.tsx line 129-133
// Input: terminal onData → WS send
// In chat mode equivalent:
if (socket.readyState === WebSocket.OPEN) {
  socket.send(messageText + "\n");
}
```

### ReactMarkdown with GFM (from note-card.tsx)

```tsx
// Source: src/components/notes/note-card.tsx line 57-59
<div className="prose prose-sm dark:prose-invert">
  <ReactMarkdown remarkPlugins={[remarkGfm]}>
    {content}
  </ReactMarkdown>
</div>
```

### AssistantProvider Config Read Pattern (from assistant-provider.tsx)

```typescript
// Source: src/components/assistant/assistant-provider.tsx lines 32-36
useEffect(() => {
  getConfigValue<string>("assistant.displayMode", "sidebar").then((mode) => {
    setDisplayMode(mode === "dialog" ? "dialog" : "sidebar");
  });
}, []);
```

### Staggered Pulse Animation (UI-SPEC)

```tsx
// Three dots with staggered animation-delay
<div className="flex items-center gap-1">
  <span className="size-1.5 rounded-full bg-primary/60 animate-pulse" style={{ animationDelay: "0ms" }} />
  <span className="size-1.5 rounded-full bg-primary/60 animate-pulse" style={{ animationDelay: "150ms" }} />
  <span className="size-1.5 rounded-full bg-primary/60 animate-pulse" style={{ animationDelay: "300ms" }} />
</div>
```

### Message Entry Animation (from globals.css / tw-animate-css)

```tsx
// animate-in, fade-in, slide-in-from-bottom-2 are available from tw-animate-css
<div className="animate-in fade-in slide-in-from-bottom-2 duration-200">
  {/* bubble content */}
</div>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| AttachAddon for WebSocket↔xterm | Manual bidirectional I/O | Already done in task-terminal.tsx | Chat mode can use same manual pattern for its WebSocket |
| Dynamic import not needed | `next/dynamic({ ssr: false })` for browser-only | Phase 37 established pattern | AssistantChat also needs dynamic import if it uses `window` directly |

**Deprecated/outdated:**
- Nothing relevant for this phase — all patterns are current.

---

## Open Questions

1. **Config key collision: assistant.displayMode**
   - What we know: `config-defaults.ts` currently sets default to `"terminal"`, which is a communication mode value, not a layout value. The provider reads it but maps to `"sidebar" | "dialog"`.
   - What's unclear: Is there actually a separate layout config key, or does the provider interpret `"terminal"` as `"sidebar"` silently? Looking at the provider: `mode === "dialog" ? "dialog" : "sidebar"` — any non-`"dialog"` value (including `"terminal"`) maps to `"sidebar"`. So `"terminal"` mode = sidebar layout unintentionally.
   - Recommendation: Planner should add a separate `assistant.communicationMode: "terminal" | "chat"` config key. This is a clean separation. Alternatively, keep `assistant.displayMode` as `"sidebar" | "dialog"` and add `assistant.communicationMode` as the new key for Phase 38. The context says Phase 36 added BE-06 with `assistant.displayMode` — but the implementation doesn't actually use it for chat/terminal. The planner needs to add this new config key and update `AssistantProvider` to read it.

2. **Claude CLI Output Format — Exact Heuristics**
   - What we know: CONTEXT.md mentions `╭─`, `╰─` box-drawing boundaries and `>` for user prompts. The tool output format is "structured output sections."
   - What's unclear: Claude CLI output format may change between versions. No existing parsing code in the repo to reference.
   - Recommendation: Start with conservative heuristics. Treat everything between `╭─` / `╰─` blocks as a message. Fall back to showing raw text (stripped of ANSI) for unrecognized patterns. The Claude's Discretion section explicitly allows the implementer to decide exact heuristics.

3. **src/hooks/ directory creation**
   - What we know: The directory does not currently exist. `useAssistantChat` should go in `src/hooks/use-assistant-chat.ts`.
   - What's unclear: Is there a preference for hooks to be co-located with components vs. in a top-level hooks directory?
   - Recommendation: Create `src/hooks/` directory since that's the standard Next.js pattern and the UI-SPEC already specifies this path. The hook is reusable enough to warrant its own directory.

---

## Environment Availability

Step 2.6: SKIPPED — This phase is purely client-side code changes with no new external service dependencies. All required tools (WebSocket server, config API) are already operational from Phase 37.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest + jsdom + @testing-library/react |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:run --reporter=verbose` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CM-01 | Parser converts ANSI-laden PTY chunks into structured message array | unit | `pnpm test:run src/hooks/__tests__/use-assistant-chat.test.ts` | Wave 0 |
| CM-02 | AssistantChatBubble renders Markdown tables/lists/code correctly | unit | `pnpm test:run tests/unit/components/assistant/assistant-chat-bubble.test.tsx` | Wave 0 |
| CM-03 | Enter sends message; Shift+Enter inserts newline | unit | `pnpm test:run tests/unit/components/assistant/assistant-chat.test.tsx` | Wave 0 |
| CM-04 | Thinking indicator visible when isThinking=true, hidden when false | unit | `pnpm test:run tests/unit/components/assistant/assistant-chat.test.tsx` | Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:run src/hooks/__tests__/` (parser unit tests)
- **Per wave merge:** `pnpm test:run` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/hooks/__tests__/use-assistant-chat.test.ts` — unit tests for ANSI stripping, state machine parser (CM-01)
- [ ] `tests/unit/components/assistant/assistant-chat-bubble.test.tsx` — Markdown rendering variants (CM-02)
- [ ] `tests/unit/components/assistant/assistant-chat.test.tsx` — input behavior, thinking indicator (CM-03, CM-04)

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 38 |
|-----------|-------------------|
| pnpm over npm | Use `pnpm add` for any new packages (none expected) |
| Next.js 15+ async params: `const { id } = await params` | Not applicable (no new routes) |
| App Router routes: `export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"` | Not applicable (no new routes) |
| All user-visible text use `t("key")` | Deferred to Phase 39 per CONTEXT.md — use hardcoded strings with `// TODO Phase 39: i18n` |
| Dynamic imports with `next/dynamic({ ssr: false })` for browser-only | AssistantChat component or the hook that creates WebSocket must be loaded client-side only |
| No SelectValue — manual span for display | Not applicable (no Select in chat UI) |
| Use Sonner for toasts | If error toast needed, use `toast.error()` from `sonner` |
| Peer Review: plan review before coding, code review after | Required before submitting to executor |
| Files max 800 lines, functions max 50 lines | `assistant-chat.tsx` and `use-assistant-chat.ts` must stay within limits |
| No console.log in production code | Parser debug logging must be removed before commit |

---

## Sources

### Primary (HIGH confidence)

- `src/components/task/task-terminal.tsx` — WebSocket connection pattern, PTY data handling, verified by direct read
- `src/components/notes/note-card.tsx` — react-markdown + remark-gfm usage pattern, verified by direct read
- `src/lib/i18n.tsx` — i18n key structure and type system, verified by direct read
- `src/app/globals.css` — tw-animate-css import, typography plugin, verified by direct read
- `src/lib/config-defaults.ts` — `assistant.displayMode` config key and default value, verified by direct read
- `src/components/assistant/assistant-panel.tsx` — existing panel structure, verified by direct read
- `src/components/assistant/assistant-provider.tsx` — provider pattern and config reading, verified by direct read
- `package.json` — react-markdown v10.1.0, remark-gfm v4.0.1, @tailwindcss/typography, verified by direct read
- `vitest.config.ts` — test framework, include patterns, verified by direct read
- `.planning/phases/38-chat-mode/38-UI-SPEC.md` — component structure, styling contract, verified by direct read

### Secondary (MEDIUM confidence)

- `38-CONTEXT.md` — locked implementation decisions, Claude CLI output format heuristics (box-drawing characters)
- `node_modules/.pnpm/` — strip-ansi v7 is ESM-only (verified), strip-ansi v6 is CJS (available as transitive dep)

### Tertiary (LOW confidence)

- Claude CLI output format heuristics (╭─, ╰─ boundaries) — sourced from CONTEXT.md specifics, not verified against actual Claude CLI output

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in package.json and existing code
- Architecture: HIGH — patterns derived from existing task-terminal.tsx and note-card.tsx
- Pitfalls: MEDIUM — config key confusion verified by reading code; parser pitfalls are known patterns for incremental parsers
- Claude CLI output format: LOW — heuristics from CONTEXT.md, not tested against live output

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable stack, 30 days)
