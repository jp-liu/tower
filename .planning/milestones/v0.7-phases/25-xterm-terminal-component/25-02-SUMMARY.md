---
phase: 25-xterm-terminal-component
plan: "02"
subsystem: ui
tags: [xterm, terminal, websocket, webgl, react, attach-addon, fit-addon]

# Dependency graph
requires:
  - phase: 25-xterm-terminal-component
    plan: "01"
    provides: "@xterm/addon-attach, @xterm/addon-webgl installed; terminal.* i18n keys"
  - phase: 24-pty-backend-websocket-server
    provides: WebSocket server on port 3001 accepting taskId param with PTY session management
provides:
  - "TaskTerminal React component (src/components/task/task-terminal.tsx)"
  - "SSR-safe 'use client' component with JSDoc dynamic import requirement for consumers"
  - "ANSI rendering via xterm.js Terminal + WebglAddon (TERM-01)"
  - "Bidirectional keyboard input via AttachAddon (TERM-02)"
  - "Panel resize with 100ms debounce via ResizeObserver + FitAddon (TERM-03)"
  - "Dark/light theme sync via useTheme resolvedTheme -> terminal.options.theme (TERM-04)"
affects:
  - 26-terminal-wiring
  - task-page-client.tsx (must wrap TaskTerminal with dynamic({ ssr: false }))

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useEffect([taskId, worktreePath]) for terminal mount/unmount lifecycle"
    - "ResizeObserver + local debounce(100ms) for terminal resize events"
    - "Refs (terminalRef, wsRef, fitAddonRef) for cross-effect communication without re-renders"
    - "Status indicator with 2s auto-hide after connected state"

key-files:
  created:
    - src/components/task/task-terminal.tsx
  modified: []

key-decisions:
  - "Single component (not split into inner/outer) to avoid prop-drilling the typed t() function — hooks called directly in TaskTerminal"
  - "Hooks run unconditionally; early return for !worktreePath placed AFTER all hook calls to satisfy React rules"
  - "onSessionEnd prop accepted but not wired to PTY exit — Phase 26 will wire actual session lifecycle"
  - "Local debounce implementation (no lodash) to keep bundle clean"
  - "WebglAddon wrapped in try-catch — falls back silently to canvas renderer if WebGL unavailable"
  - "Status indicator auto-hides after 2s on connected state — only visible when connecting or disconnected"

patterns-established:
  - "TaskTerminal JSDoc pattern: document dynamic() import requirement inline for consumers"
  - "Refs-for-effects pattern: use refs to share mutable state between multiple useEffects without triggering re-renders"

requirements-completed:
  - TERM-01
  - TERM-02
  - TERM-03
  - TERM-04

# Metrics
duration: ~3min
completed: 2026-04-02
---

# Phase 25 Plan 02: TaskTerminal Component

**xterm.js browser terminal component with WebSocket PTY connection, ANSI rendering, bidirectional keyboard input, panel resize reflow, and dark/light theme sync**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-02T13:20:12Z
- **Completed:** 2026-04-02T13:22:45Z
- **Tasks:** 1 of 2 (Task 2 is human-verify checkpoint)
- **Files modified:** 1

## Accomplishments
- Created `src/components/task/task-terminal.tsx` (238 lines) — full xterm.js terminal component
- AttachAddon bidirectional piping: PTY output → xterm.write (ANSI colors) + keyboard → ws.send
- WebglAddon GPU renderer loaded after terminal.open(); context-loss event triggers graceful dispose
- FitAddon + ResizeObserver with 100ms debounce sends resize JSON to PTY server on panel resize
- useTheme resolvedTheme drives terminal.options.theme for real-time dark/light color update
- Connection status dot indicator (yellow=connecting, green=connected, red=disconnected) with 2s auto-hide
- No-worktree placeholder renders centered text via terminal.noWorktree i18n keys when worktreePath is null

## Task Commits

1. **Task 1: Create TaskTerminal component** - `d4366be` (feat)

## Files Created/Modified
- `src/components/task/task-terminal.tsx` — TaskTerminal React component with full xterm.js integration

## Decisions Made
- Single-component design: hooks called unconditionally; early return for `!worktreePath` placed after all hook calls to satisfy React rules of hooks
- `onSessionEnd` prop accepted but not yet wired to PTY onExit — Phase 26 will wire actual session lifecycle
- Local `debounce` function (no lodash) to avoid adding a dependency for a 6-line utility
- WebglAddon inside try-catch with silent fallback — avoids hard crash on older browsers/environments

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Resolved TypeScript error: `t` function prop type incompatibility**
- **Found during:** Task 1 (initial implementation)
- **Issue:** First attempt used a split component (`TaskTerminal` + `TaskTerminalInner`) passing `t` as `(key: string) => string` prop, but actual type is `(key: TranslationKey, vars?) => string` — TypeScript error at line 74
- **Fix:** Merged into single component; all hooks called directly in `TaskTerminal`, React rules of hooks satisfied by placing conditional return AFTER all `useEffect` calls
- **Files modified:** `src/components/task/task-terminal.tsx`
- **Verification:** `pnpm tsc --noEmit` produces no errors in task-terminal.tsx
- **Committed in:** `d4366be`

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Bug fix necessary for TypeScript compliance. No scope creep.

## Issues Encountered
- Pre-existing TypeScript errors in `src/actions/agent-config-actions.ts` (Prisma InputJsonValue type mismatch) — confirmed pre-existing, not introduced by this plan, out of scope.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- `TaskTerminal` component ready for import in Phase 26 (task-page-client.tsx)
- Consumers MUST use `next/dynamic({ ssr: false })` — documented in JSDoc comment in the component
- Human browser verification (Task 2 checkpoint) still needed to confirm TERM-01 through TERM-04 in real browser

## Known Stubs
- `onSessionEnd` prop: accepted but not called — no PTY exit event wired. Phase 26 will connect this to actual session lifecycle when wiring the terminal into task-page-client.tsx.

---
*Phase: 25-xterm-terminal-component*
*Completed: 2026-04-02*
