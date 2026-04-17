# Phase 37: Terminal Mode UI — Research

**Researched:** 2026-04-17
**Domain:** React context, xterm.js panel rendering, push-layout sidebar, shadcn Sheet/Dialog
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Panel Layout & Rendering**
- Use the existing `Sheet` component (side="left") for sidebar mode
- Use the existing `Dialog` component for dialog/modal mode
- Sidebar width: 420px fixed
- Push layout for sidebar (UX-02): main content area shrinks when sidebar is open, not an overlay
- `AssistantPanel` wraps a title bar + terminal body regardless of sidebar or dialog mode

**Terminal Integration**
- Reuse the WebSocket connection pattern from `task-terminal.tsx` — connect to `ws://localhost:${wsPort}/terminal?taskId=__assistant__`
- Reuse xterm.js lifecycle from existing task terminal: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`
- Terminal theme matches existing task terminal (same color scheme, same font)
- Terminal auto-fits to panel dimensions on open and on resize using `@xterm/addon-fit`
- No separate input box in terminal mode (TM-02) — xterm handles input directly

**Keyboard & Interaction**
- Toggle shortcut: Cmd+L (macOS) / Ctrl+L (Windows/Linux) — distinct from Cmd+K search
- Close via: Escape key, close button in title bar, or Cmd+L toggle
- All close actions destroy the assistant session (stateless per UX-01/BE-05)
- No auto-open on page load — user-initiated only

**State Management**
- Use React context (`AssistantProvider`) at the layout level for panel open/close state + display mode
- Session lifecycle: call `POST /api/internal/assistant` on open, `DELETE /api/internal/assistant` on close
- Read `assistant.displayMode` from SystemConfig on mount to determine sidebar vs dialog rendering
- Provider exposes `toggleAssistant()`, `isOpen`, `displayMode`

### Claude's Discretion
- Exact positioning and animation of sidebar slide-in
- Title bar content (icon, title text, close button arrangement)
- Loading state while assistant session is being created

### Deferred Ideas (OUT OF SCOPE)
- Chat mode (message bubbles, Markdown rendering) — Phase 38
- Mode switching in Settings — Phase 39
- Responsive sizing — Phase 39
- i18n for all assistant text — Phase 39
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | User can see an assistant icon in the top bar next to the search box | `top-bar.tsx` right-actions section — insert Bot icon button between search and language toggle |
| UI-02 | User can open the chat assistant via clicking the icon or pressing Cmd+L (Ctrl+L) | Cmd+L `useEffect` registered in `layout-client.tsx` (not per-page); click handler calls `toggleAssistant()` |
| UI-03 | User can use the assistant in sidebar mode (left side panel, does not block other operations) | `Sheet` (side="left") with push layout — see layout integration pattern |
| UI-04 | User can use the assistant in dialog mode (centered modal) | `Dialog` component already in project, `assistant.displayMode` config key defaults to "terminal" |
| UI-06 | User can close the assistant via Escape, close button, or Cmd+L toggle | Sheet/Dialog Escape built-in; additional keyboard handler; close button calls DELETE route |
| TM-01 | Assistant embeds an xterm.js terminal in a chat-panel wrapper (title bar + terminal body) | Reuse `TaskTerminal` via `dynamic({ ssr: false })` with `taskId="__assistant__"` |
| TM-02 | User can type directly in the terminal (xterm handles input, no separate input box) | xterm.js `terminal.onData` → WebSocket — same bidirectional pattern as `task-terminal.tsx` |
| TM-03 | CC output is displayed as-is in the terminal (Markdown tables/lists rendered by CC itself) | WebSocket message → `terminal.write()` — no parsing needed, raw PTY passthrough |
| UX-02 | Sidebar mode does not obstruct the main content area (push layout or overlay) | `layout-client.tsx` flex row — AssistantPanel rendered as flex sibling to main content |
</phase_requirements>

---

## Summary

Phase 37 is a pure front-end UI phase. The backend (Phase 36) is fully complete: PTY session creation/destruction, WebSocket routing for `__assistant__` key, and internal API routes at `POST/DELETE /api/internal/assistant` are all verified working. This phase only wires up the UI layer on top.

The implementation centres on three new components (`AssistantProvider`, `AssistantPanel`, `AssistantIcon`) and two file modifications (`layout-client.tsx`, `top-bar.tsx`). All required xterm.js packages are already installed in the project and used in `task-terminal.tsx`. The Sheet and Dialog shadcn components are already installed and match the locked decisions.

The single critical challenge is the **push-layout sidebar**: `sheet.tsx` currently renders as a fixed overlay (`fixed z-50`) via `SheetContent`. The push layout requires a different structural approach — the `AssistantPanel` must be rendered directly inside the layout flex row rather than as a Sheet popup. The Sheet component's existing overlay model is suitable for dialog/modal mode, but sidebar mode needs a manually positioned `div` inside `layout-client.tsx`. This is the primary pattern to document clearly for the planner.

**Primary recommendation:** Render sidebar as a plain `div` (not a Sheet popup) inside `layout-client.tsx`'s flex row. Use the Sheet component only for dialog mode. `AssistantProvider` conditionally renders the correct wrapper.

---

## Standard Stack

### Core (all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@xterm/xterm` | Already in project | Terminal emulator in browser | Same library as `task-terminal.tsx` |
| `@xterm/addon-fit` | Already in project | Auto-fit terminal to container | Same addon as `task-terminal.tsx` |
| `@xterm/addon-webgl` | Already in project | GPU-accelerated renderer | Already used in task terminal |
| `react` context API | Built-in | `AssistantProvider` state | No new library needed |
| `next/dynamic` | Built-in | SSR-safe xterm loading | Same pattern as `terminal-portal.tsx` |
| lucide-react | Already in project | `Bot`, `X`, `Loader2` icons | Project-wide icon library |
| shadcn `Sheet` | Already installed | Dialog mode only (overlay use) | Pre-installed per UI-SPEC |
| shadcn `Dialog` | Already installed | Centered modal mode | Pre-installed per UI-SPEC |
| shadcn `Button`, `Tooltip` | Already installed | Close button, icon tooltip | Pre-installed |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `getConfigValue` server action | Already in codebase | Read `assistant.displayMode` on mount | Called once in `AssistantProvider` useEffect |
| `useI18n()` hook | Already in codebase | All user-facing strings | Mandatory per CLAUDE.md i18n rule |
| `fetch()` to internal API | Built-in | POST/DELETE `/api/internal/assistant` | Session lifecycle (not a server action — server actions can't DELETE) |

**No new packages need to be installed.**

---

## Architecture Patterns

### Recommended File Structure

```
src/components/assistant/
├── assistant-provider.tsx    # Context: isOpen, displayMode, toggleAssistant()
└── assistant-panel.tsx       # Title bar + dynamic terminal body

src/components/layout/
├── layout-client.tsx         # MODIFIED: wrap with AssistantProvider, add panel sibling
└── top-bar.tsx               # MODIFIED: add AssistantIcon button

src/lib/i18n.tsx              # MODIFIED: add assistant.* translation keys
```

### Pattern 1: AssistantProvider — Context at Layout Level

The provider reads `assistant.displayMode` config once on mount, manages `isOpen` state, and exposes `toggleAssistant()`. It wraps `LayoutClient` so the shortcut and state are global.

```typescript
// src/components/assistant/assistant-provider.tsx
"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { getConfigValue } from "@/actions/config-actions";

type DisplayMode = "sidebar" | "dialog";

interface AssistantContextValue {
  isOpen: boolean;
  displayMode: DisplayMode;
  toggleAssistant: () => void;
  closeAssistant: () => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant() {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used within AssistantProvider");
  return ctx;
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("sidebar");

  // Read config once on mount
  useEffect(() => {
    getConfigValue<string>("assistant.displayMode", "sidebar").then((mode) => {
      setDisplayMode(mode === "dialog" ? "dialog" : "sidebar");
    });
  }, []);

  const openAssistant = useCallback(async () => {
    await fetch("/api/internal/assistant", { method: "POST" });
    setIsOpen(true);
  }, []);

  const closeAssistant = useCallback(async () => {
    setIsOpen(false);
    await fetch("/api/internal/assistant", { method: "DELETE" });
  }, []);

  const toggleAssistant = useCallback(() => {
    if (isOpen) {
      closeAssistant();
    } else {
      openAssistant();
    }
  }, [isOpen, openAssistant, closeAssistant]);

  return (
    <AssistantContext.Provider value={{ isOpen, displayMode, toggleAssistant, closeAssistant }}>
      {children}
    </AssistantContext.Provider>
  );
}
```

### Pattern 2: Push Layout Sidebar — Critical Implementation

The Sheet component renders as `fixed z-50` (a floating overlay). For push layout (UX-02), the panel must be a **flex sibling** in the layout row, not a fixed overlay.

```typescript
// layout-client.tsx — push sidebar layout
// When isOpen && displayMode === "sidebar":
// The main flex row gains a fixed-width sibling

<div className="flex h-screen overflow-hidden">
  <AppSidebar workspaces={workspaces} />
  <div className="flex flex-1 flex-col overflow-hidden">
    <TopBar onCreateProject={handleCreateProject} />
    <div className="flex flex-1 overflow-hidden">
      {/* Push sidebar: added as flex sibling, NOT a Sheet overlay */}
      {isOpen && displayMode === "sidebar" && (
        <AssistantPanel mode="sidebar" />
      )}
      <main className="flex-1 overflow-auto bg-background">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  </div>
</div>
```

The `AssistantPanel` in sidebar mode renders as a `div` with `w-[420px] shrink-0 border-r flex flex-col`. This is NOT wrapped in a Sheet component — the Sheet's overlay model conflicts with push layout.

For **dialog mode**, the AssistantPanel is rendered inside a `Dialog` component which provides overlay/modal behavior naturally.

### Pattern 3: AssistantPanel — Title Bar + Terminal

```typescript
// src/components/assistant/assistant-panel.tsx
"use client";
import dynamic from "next/dynamic";
import { Bot, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistant } from "./assistant-provider";

// SSR-safe terminal load (window accessed at import time)
const TaskTerminal = dynamic(
  () => import("@/components/task/task-terminal").then((m) => ({ default: m.TaskTerminal })),
  { ssr: false }
);

// assistant uses __assistant__ session key as taskId
// worktreePath is set to cwd (process.cwd()) — passed via the API response or hardcoded for UI
```

**Key detail:** `TaskTerminal` requires `worktreePath` to render (guarded by `if (!worktreePath) return <no worktree UI>`). For the assistant, `worktreePath` should be set to the Tower project directory. The `POST /api/internal/assistant` response can include `{ worktreePath: process.cwd() }`, or the provider can set a static value after the POST succeeds.

Looking at `assistant-actions.ts`, `startAssistantSession` does not return `worktreePath`. The assistant API route currently returns `{ ok: true, sessionKey }`. The provider needs to read `worktreePath` from somewhere — either:
1. The POST response should include `{ ok: true, worktreePath: string }` (requires backend change — check if Phase 36 route already returns this), or
2. The UI calls a separate GET to fetch the Tower project path, or
3. `worktreePath` for the assistant is hardcoded as `process.cwd()` in the route response.

**Verified:** The current `POST /api/internal/assistant` route returns `{ ok: true, sessionKey: ASSISTANT_SESSION_KEY }` — it does NOT return `worktreePath`. The API route needs to include `worktreePath` in its response, or `AssistantProvider` must hardcode the worktree path. The simplest fix: update the route to return `{ ok: true, worktreePath: process.cwd() }`.

### Pattern 4: Keyboard Shortcut Registration

Register Cmd+L at layout level (not per-page). Follow existing Cmd+K pattern from `top-bar.tsx`:

```typescript
// In AssistantProvider or layout-client.tsx useEffect:
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "l") {
      e.preventDefault();
      toggleAssistant();
    }
  };
  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, [toggleAssistant]);
```

**Note:** Register at the `AssistantProvider` level (not `TopBar`) so the shortcut works from any page, including full-screen task detail pages.

### Pattern 5: xterm.js with `__assistant__` as taskId

`TaskTerminal` is reused as-is, passing `taskId="__assistant__"` and `worktreePath` from provider state. The WebSocket server already handles `__assistant__` as a valid session key (confirmed in `ws-server.ts` — it reads `taskId` from URL params, no CUID validation on the WS side, unlike internal HTTP routes).

```typescript
<TaskTerminal
  taskId="__assistant__"
  worktreePath={worktreePath}  // from AssistantProvider state after POST
/>
```

### Anti-Patterns to Avoid

- **Using Sheet for push layout:** Sheet renders as `fixed z-50` overlay — incompatible with push layout. Use a plain `div` sibling in the flex row for sidebar mode.
- **Mutating process.env for worktreePath:** Never mutate `process.env`. Pass `cwd` through the POST response.
- **Registering Cmd+L in TopBar:** TopBar is not rendered on all pages (full-screen task pages bypass it). Register in the provider.
- **Connecting WebSocket before session starts:** The provider must await the POST before the terminal mounts — otherwise the WS connects to a non-existent session.
- **Using `useCanvasRenderer` when only one assistant terminal exists:** WebGL is fine for a single assistant terminal; `useCanvasRenderer` is only needed when many terminals coexist (mission control portal system).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Terminal emulation | Custom terminal renderer | `@xterm/xterm` already in project | Full ANSI support, resize, scrollback, WebGL renderer |
| Modal/overlay panel | Custom overlay CSS | `Dialog` component (base-ui) | Focus trap, Escape handling, accessibility |
| WebSocket reconnect | Custom retry logic | Reuse existing `task-terminal.tsx` pattern | Already handles all edge cases |
| Sidebar animation | Custom CSS transitions | Sheet CSS vars (`data-starting-style`) | Already defined in `sheet.tsx`, consistent with design system |
| Loading spinner | Custom spinner | `Loader2` from lucide-react + opacity overlay pattern | Already documented in `.claude/rules/ui.md` |

---

## Common Pitfalls

### Pitfall 1: Sheet Overlay Conflicts with Push Layout

**What goes wrong:** If `AssistantPanel` is rendered inside `SheetContent`, it becomes `fixed z-50` — an overlay on top of main content. This violates UX-02 (push layout).

**Why it happens:** The Sheet component is designed for drawers/overlays, not for in-flow push sidebars.

**How to avoid:** Render sidebar mode as a plain flex-sibling `div` inside `layout-client.tsx`. Only use `Sheet`/`Dialog` wrapper for dialog mode.

**Warning signs:** If the main content area is still accessible/interactive when the panel is open (it should shrink, not be covered), the push layout is working correctly.

### Pitfall 2: Terminal Mounts Before Session Exists

**What goes wrong:** `TaskTerminal` mounts and immediately opens a WebSocket to `ws://localhost:3001/terminal?taskId=__assistant__`. If `startAssistantSession` has not yet created the PTY, the WS connects to a dead session and immediately disconnects.

**Why it happens:** `isOpen` is set to `true` synchronously, causing immediate re-render, while the `POST /api/internal/assistant` is still in-flight.

**How to avoid:** Track a `isStarting` state in `AssistantProvider`. Only set `isOpen = true` (and mount the terminal) after the POST resolves. Show the loading overlay (Loader2 spinner) during this window.

**Warning signs:** Terminal status shows "Disconnected" immediately on open.

### Pitfall 3: TaskTerminal Skips Render Without worktreePath

**What goes wrong:** `task-terminal.tsx` line 54 guards `if (!worktreePath || !containerRef.current) return;` — if `worktreePath` is null/undefined, the terminal never initializes.

**Why it happens:** The POST response doesn't currently include `worktreePath`, so provider state defaults to `null`.

**How to avoid:** Update `POST /api/internal/assistant` route to return `{ ok: true, worktreePath: process.cwd() }`. Store in provider state, pass to `AssistantPanel`.

**Warning signs:** Blank terminal area, "无工作区" (no worktree) message appears.

### Pitfall 4: Cmd+L Conflicts With Browser Default

**What goes wrong:** On some browsers/OS combos, Ctrl+L focuses the address bar.

**Why it happens:** Ctrl+L is a browser shortcut for address bar focus.

**How to avoid:** Always call `e.preventDefault()` in the keydown handler. The existing Cmd+K handler in `top-bar.tsx` does this correctly — follow the same pattern.

### Pitfall 5: Dialog Mode Escape vs Panel Escape Conflict

**What goes wrong:** If using `Dialog` for dialog mode, the base-ui `Dialog` primitive handles Escape natively — but the `closeAssistant` logic (which calls DELETE) must also fire. If not wired correctly, the dialog closes visually but the session is not destroyed.

**Why it happens:** base-ui `Dialog` fires `onOpenChange(false)` on Escape — but if `open` is controlled externally, the close must be handled in `onOpenChange`.

**How to avoid:** Wire `Dialog`'s `onOpenChange` to call `closeAssistant()` (not just `setIsOpen(false)`). Ensure the DELETE call fires on every close path.

### Pitfall 6: Resize Not Triggered After Panel Opens

**What goes wrong:** Terminal is mounted inside a panel that starts at 420px, but `fitAddon.fit()` runs during mount when the container might not have final dimensions (e.g., CSS transition not yet complete).

**Why it happens:** The Sheet slide-in animation (200ms) means the container reaches its final width after the mount effect.

**How to avoid:** In `AssistantPanel`, trigger a resize after a short delay or use `requestAnimationFrame` after the panel is fully visible. The existing `task-terminal.tsx` already uses `requestAnimationFrame` for re-mount fits — same approach applies.

---

## Code Examples

### Loading State Pattern (from `.claude/rules/ui.md`)

```tsx
// Source: .claude/rules/ui.md — Loading States section
<div className={`relative ${isStarting ? "opacity-40 pointer-events-none" : ""}`}>
  {isStarting && <Loader2 className="absolute inset-0 m-auto size-5 animate-spin" />}
  {children}
</div>
```

### WebSocket Connection Pattern (from task-terminal.tsx)

```typescript
// Source: src/components/task/task-terminal.tsx lines 100-148
getConfigValue<number>("terminal.wsPort", 3001).then((wsPort) => {
  if (cancelled) return;
  const socket = new WebSocket(
    `ws://localhost:${wsPort}/terminal?taskId=${encodeURIComponent(taskId)}`
  );
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
  });
  socket.addEventListener("message", (event) => {
    terminal.write(event.data);
  });
  // Input: terminal → WS
  terminal.onData((data) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
  });
});
```

Note: `AssistantPanel` reuses `TaskTerminal` as-is (passing `taskId="__assistant__"`), so this WebSocket code runs inside the existing component — no duplication needed.

### AssistantIcon in TopBar (placement reference)

```tsx
// Source: src/components/layout/top-bar.tsx — Right Actions section
// Insert BEFORE the Language Toggle button, AFTER the search box

{/* Assistant Icon */}
<button
  onClick={toggleAssistant}
  aria-label={t("assistant.iconLabel")}
  className={[
    "rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
    isOpen ? "bg-accent text-foreground" : "",
  ].join(" ")}
>
  <Bot className="h-4 w-4" />
</button>
```

### i18n Keys to Add

```typescript
// zh translations to add in src/lib/i18n.tsx:
"assistant.iconLabel": "助手 ⌘L",
"assistant.title": "Tower 助手",
"assistant.close": "关闭助手",
"assistant.starting": "正在启动…",
"assistant.connecting": "连接中",
"assistant.connected": "已连接",
"assistant.disconnected": "已断开",
"assistant.errorTitle": "无法启动助手",
"assistant.errorBody": "会话启动失败，请重试",

// en translations to add:
"assistant.iconLabel": "Assistant ⌘L",
"assistant.title": "Tower Assistant",
"assistant.close": "Close assistant",
"assistant.starting": "Starting…",
"assistant.connecting": "Connecting",
"assistant.connected": "Connected",
"assistant.disconnected": "Disconnected",
"assistant.errorTitle": "Failed to start assistant",
"assistant.errorBody": "Session failed to start. Try again.",
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sheet as push sidebar | Sheet is overlay-only; push layout requires flex sibling | Always been true in base-ui | Use plain div for sidebar push mode |
| AttachAddon for xterm WS | Manual `onData`/`onmessage` bidirectional I/O | Implemented in task-terminal.tsx (React Strict Mode compat) | Do NOT use AttachAddon |

---

## Open Questions

1. **Does `POST /api/internal/assistant` need to return `worktreePath`?**
   - What we know: `TaskTerminal` requires `worktreePath` (non-null) to initialize. Current POST route returns `{ ok: true, sessionKey }` without `worktreePath`.
   - What's unclear: Is this a Phase 37 change or was it always intended?
   - Recommendation: Planner should include a task to update the assistant API route to return `worktreePath: process.cwd()`. This is a small 1-line change to `route.ts`.

2. **Should `AssistantProvider` be inside or outside `TerminalPortalProvider`?**
   - What we know: Both are layout-level providers. `TerminalPortalProvider` manages task terminals, `AssistantProvider` manages the global assistant.
   - What's unclear: No dependency between the two.
   - Recommendation: Nest `AssistantProvider` inside `TerminalPortalProvider` (or parallel). No functional difference — outer wrapper first in the JSX.

3. **Full-screen pages (task detail) — does the panel appear?**
   - What we know: `layout-client.tsx` has a separate render path for `isTaskDetailPage` with no sidebar.
   - What's unclear: Should the assistant be available on full-screen task pages?
   - Recommendation: Yes — the `AssistantProvider` should wrap all paths. The panel rendering logic should be included in both `isTaskDetailPage` and normal layout branches.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 37 is a pure front-end UI change. All required xterm.js packages are already installed and in use. No external services, databases, or CLI tools are required beyond what Phase 36 already established.

---

## Validation Architecture

`workflow.nyquist_validation` is not set in `.planning/config.json` (only `_auto_chain_active` is present) — treat as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.1 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:run` |
| Full suite command | `pnpm test:run` |
| Environment | jsdom |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | AssistantIcon renders in top bar | unit (React Testing Library) | `pnpm test:run -- --reporter=verbose` | ❌ Wave 0 |
| UI-02 | Cmd+L opens panel; click opens panel | unit (fireEvent) | same | ❌ Wave 0 |
| UI-03 | Sidebar mode: panel is flex sibling, not fixed overlay | unit (DOM structure check) | same | ❌ Wave 0 |
| UI-04 | Dialog mode: Dialog component renders | unit | same | ❌ Wave 0 |
| UI-06 | Close via Escape / close button / Cmd+L toggle | unit (fireEvent) | same | ❌ Wave 0 |
| TM-01 | AssistantPanel renders title bar + terminal container | unit | same | ❌ Wave 0 |
| TM-02 | No separate input box in terminal mode | unit (DOM assertion) | same | ❌ Wave 0 |
| TM-03 | Terminal receives raw WS data (no parsing) | manual-only | — | Manual — requires live Claude CLI |
| UX-02 | Main content shrinks when sidebar is open | unit (layout structure) | same | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:run`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/components/assistant/__tests__/assistant-provider.test.tsx` — covers UI-01, UI-02, UI-06 (context state + keyboard shortcut)
- [ ] `src/components/assistant/__tests__/assistant-panel.test.tsx` — covers TM-01, TM-02 (DOM structure, no input box)
- [ ] `src/components/layout/__tests__/layout-client-assistant.test.tsx` — covers UI-03, UI-04, UX-02 (layout structure, flex sibling vs overlay)

Note: All xterm.js terminal tests require mocking `@xterm/xterm` (same approach as existing `task-terminal.tsx` tests if any exist). Use `vi.mock("@xterm/xterm")` to avoid browser-only WebGL/Canvas API calls in jsdom.

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 37 |
|-----------|-------------------|
| Use `pnpm` (not npm/yarn) | All install commands use `pnpm` |
| All user-facing text use `t("key")` via `useI18n()` | New assistant i18n keys must be added to both zh and en in `i18n.tsx` |
| `export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"` on App Router routes | Assistant API route already has both (confirmed) |
| Next.js 15+ async params: `const { id } = await params` | No params in this phase's routes |
| No `console.log` in production code | Use `console.error` for diagnostics (as done in ws-server.ts) |
| No mutation — use spread/immutable patterns | Provider state updates use `setState` (immutable) |
| shadcn base-nova preset | Already initialized; no new installs needed |
| Button default size = `h-8` (32px) | AssistantIcon button: `h-8 w-8`; close button in title bar: `h-8 w-8` |
| Never use `<SelectValue />` | Not applicable to this phase |
| Toast via Sonner: `toast.error("msg")` | Use for error state when session start fails |
| `Loader2` + opacity overlay for loading | Used in AssistantPanel loading state |
| Internal API routes: `requireLocalhost` guard | `POST/DELETE /api/internal/assistant` already has this (Phase 36) |
| Never mutate `process.env` | `worktreePath` passed through API response, not env vars |
| DnD Kit: stable `id` prop | Not applicable to this phase |

---

## Sources

### Primary (HIGH confidence)

- Source code audit: `src/components/task/task-terminal.tsx` — xterm.js lifecycle, WebSocket pattern, resize observer
- Source code audit: `src/components/layout/layout-client.tsx` — layout structure for push sidebar integration
- Source code audit: `src/components/layout/top-bar.tsx` — keyboard shortcut pattern, icon button CSS classes
- Source code audit: `src/components/ui/sheet.tsx` — confirmed fixed/overlay positioning
- Source code audit: `src/app/api/internal/assistant/route.ts` — confirmed POST/DELETE/GET routes
- Source code audit: `src/actions/assistant-actions.ts` — session start/stop logic, no worktreePath in return
- Source code audit: `src/lib/config-defaults.ts` — confirmed `assistant.displayMode` default = "terminal"
- Source code audit: `src/lib/i18n.tsx` — confirmed no `assistant.*` keys exist yet
- Source code audit: `vitest.config.ts` + `package.json` — vitest 4.1.1, jsdom environment

### Secondary (MEDIUM confidence)

- `.claude/rules/ui.md` — loading state pattern, button sizing, i18n conventions
- `.claude/rules/process-lifecycle.md` — PTY session lifecycle rules
- `37-UI-SPEC.md` — dimensions, typography, color roles, component inventory

### Tertiary (LOW confidence)

- None.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed in codebase, no new installs
- Architecture: HIGH — push layout pattern verified by reading Sheet source (fixed positioning confirmed), TaskTerminal reuse pattern confirmed
- Pitfalls: HIGH — worktreePath gap confirmed by reading API route source; Sheet overlay model confirmed by reading sheet.tsx
- i18n keys: HIGH — confirmed absent by grep search

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable libraries, project conventions won't change)
