---
phase: 25-xterm-terminal-component
verified: 2026-04-03T01:08:57Z
status: human_needed
score: 4/4 must-haves verified (browser behavior needs human confirmation)
re_verification: false
human_verification:
  - test: "Open TaskTerminal in browser with a valid worktreePath and a running Phase 24 WS server"
    expected: "Terminal renders ANSI color sequences (ls --color=auto shows colored output); no blank canvas"
    why_human: "ANSI rendering via xterm.js WebGL canvas cannot be verified by static code analysis"
  - test: "Type a command in the terminal and press Enter"
    expected: "Input is forwarded to the PTY shell; command executes and output appears in the terminal"
    why_human: "Bidirectional WebSocket I/O requires a live PTY session to verify"
  - test: "Drag the workbench panel resize handle to change the terminal panel size"
    expected: "Terminal reflows within ~100ms — rows/cols update, no visual overflow or clipping"
    why_human: "ResizeObserver + FitAddon behavior requires a running browser to confirm 100ms debounce timing"
  - test: "Toggle dark/light mode in the app while the terminal is mounted"
    expected: "Terminal background changes from #0a0a0a (dark) to #fafafa (light) without remounting"
    why_human: "useTheme → terminal.options.theme live update requires visual inspection in a browser"
  - test: "Render TaskTerminal with worktreePath={null}"
    expected: "Centered placeholder shows 'No Worktree' and description text; no JavaScript error"
    why_human: "Conditional render path with no WebSocket connection requires browser verification"
---

# Phase 25: xterm.js Terminal Component — Verification Report

**Phase Goal:** Users see a fully functional browser terminal that renders PTY output with ANSI colors, accepts keyboard input, and resizes with the panel
**Verified:** 2026-04-03T01:08:57Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `@xterm/addon-attach` is in `package.json` dependencies | ✓ VERIFIED | `"@xterm/addon-attach": "^0.12.0"` at line 38 of package.json; importable via `node -e "require('@xterm/addon-attach')"` |
| 2 | `@xterm/addon-webgl` is in `package.json` dependencies | ✓ VERIFIED | `"@xterm/addon-webgl": "^0.19.0"` at line 40 of package.json; importable via node |
| 3 | `i18n.tsx` has all 6 `terminal.*` keys in both zh and en locales | ✓ VERIFIED | `grep "terminal.connecting" src/lib/i18n.tsx` returns 2 (one zh line 417, one en line 815); all 6 keys present in both locales |
| 4 | `TaskTerminal` component exists, is substantive (238 lines), and implements all 4 TERM patterns | ✓ VERIFIED | File exists at `src/components/task/task-terminal.tsx` (238 lines); contains AttachAddon, FitAddon, WebglAddon, ResizeObserver, `term.options.theme` — all 5 patterns confirmed |
| 5 | Terminal renders ANSI colors (TERM-01) via xterm.js + WebGL in a real browser | ? HUMAN NEEDED | Code path is correct (AttachAddon `bidirectional: true` pipes ws.onmessage → terminal.write; WebglAddon loaded after `terminal.open()`), but visual rendering cannot be confirmed without a browser |
| 6 | Keyboard input forwarded to PTY via WebSocket (TERM-02) | ? HUMAN NEEDED | AttachAddon with `bidirectional: true` handles `terminal.onData → ws.send` automatically; verified in code but live I/O needs browser test |
| 7 | Panel resize triggers FitAddon + PTY resize within 100ms (TERM-03) | ? HUMAN NEEDED | ResizeObserver + `debounce(100)` + `ws.send(JSON.stringify({ type: "resize", ... }))` all present; timing needs browser confirmation |
| 8 | Terminal theme switches on dark/light toggle (TERM-04) | ? HUMAN NEEDED | `useEffect([resolvedTheme])` at line 181–188 sets `term.options.theme`; live toggle needs browser confirmation |

**Score:** 4/4 artifacts verified. Browser behaviors (TERM-01 through TERM-04) need human confirmation.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | xterm addon dependencies installed | ✓ VERIFIED | `@xterm/addon-attach ^0.12.0` + `@xterm/addon-webgl ^0.19.0` present; both importable from `node_modules/@xterm/` |
| `src/lib/i18n.tsx` | terminal.* i18n keys in zh + en | ✓ VERIFIED | All 6 keys (connecting, connected, disconnected, reconnecting, noWorktree, noWorktreeDesc) present twice (lines 417–422 zh, 815–820 en) |
| `src/components/task/task-terminal.tsx` | TaskTerminal React component with full xterm.js integration | ✓ VERIFIED | 238 lines; exports `TaskTerminal` function + `TaskTerminalProps` interface; substantive implementation with all required addons |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `task-terminal.tsx` | `package.json` | `import @xterm/addon-attach` | ✓ WIRED | Line 6: `import { AttachAddon } from "@xterm/addon-attach"` |
| `task-terminal.tsx` | `ws://localhost:3001/terminal?taskId=...` | `new WebSocket(url)` in useEffect | ✓ WIRED | Line 100–101: `new WebSocket(\`ws://localhost:3001/terminal?taskId=...\`)` inside `useEffect([taskId, worktreePath])` |
| ResizeObserver callback | `fitAddon.fit()` | debounced 100ms handler + `ws.send` resize JSON | ✓ WIRED | Lines 158–168: `debounce(() => { fit.fit(); ws.send(JSON.stringify({ type: "resize", ... })); }, 100)` |
| `useTheme resolvedTheme` | `terminal.options.theme` | `useEffect([resolvedTheme])` | ✓ WIRED | Lines 181–188: `term.options.theme = isDark ? { ... } : { ... }` — correctly uses `term` ref, not stale closure |
| `TaskTerminal` | Page consumer | `next/dynamic({ ssr: false })` in parent | ⚠️ ORPHANED | Component is not yet imported by any page — expected: Phase 26 handles wiring. JSDoc at lines 33–38 documents the required dynamic import pattern for Phase 26. |

**Note on ORPHANED status:** The component being unimported is expected at Phase 25 boundary. The ROADMAP explicitly assigns wiring to Phase 26. The JSDoc in the component file documents the mandatory `next/dynamic({ ssr: false })` pattern for Phase 26 to follow.

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `task-terminal.tsx` | PTY output → `terminal.write` | AttachAddon pipes `ws.onmessage` → xterm Terminal | Real data: live WebSocket stream from Phase 24 PTY server | ✓ FLOWING (code path verified; live data requires Phase 24 WS server running) |
| `task-terminal.tsx` | `wsStatus` state | `ws.addEventListener("open"/"close"/"error")` | Real WebSocket events | ✓ FLOWING |
| `task-terminal.tsx` | `resolvedTheme` | `useTheme()` from next-themes | Real theme state | ✓ FLOWING |

---

## Behavioral Spot-Checks (Step 7b)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| xterm addons importable | `node -e "require('@xterm/addon-attach'); require('@xterm/addon-webgl'); console.log('ok')"` | `ok` | ✓ PASS |
| terminal.connecting key in i18n twice | `grep -c "terminal.connecting" src/lib/i18n.tsx` | `2` | ✓ PASS |
| AttachAddon/FitAddon/WebglAddon/ResizeObserver/term.options.theme present | `grep -c "..." task-terminal.tsx` | `15` matches | ✓ PASS |
| TaskTerminal exported as named function | `grep "^export function TaskTerminal"` | line 40 | ✓ PASS |
| xterm.css imported (mandatory for rendering) | `grep "xterm.css"` | line 10 | ✓ PASS |
| ANSI rendering in browser (TERM-01) | Browser test required | — | ? SKIP — needs running browser + PTY server |
| Keyboard input forwarding (TERM-02) | Browser test required | — | ? SKIP — needs live WebSocket session |
| Resize reflow within 100ms (TERM-03) | Browser test required | — | ? SKIP — needs panel drag interaction |
| Theme toggle updates terminal (TERM-04) | Browser test required | — | ? SKIP — needs dark/light mode toggle in UI |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TERM-01 | 25-01, 25-02 | xterm.js 终端组件替换任务页左侧聊天气泡界面 | ? HUMAN NEEDED | AttachAddon + WebglAddon code path verified; actual rendering requires browser |
| TERM-02 | 25-01, 25-02 | 终端支持键盘输入（交互式 Claude CLI 操作） | ? HUMAN NEEDED | AttachAddon `bidirectional: true` handles `terminal.onData → ws.send`; verified in code, live I/O needs browser |
| TERM-03 | 25-01, 25-02 | 终端 resize 与浏览器窗口同步（FitAddon + PTY resize） | ? HUMAN NEEDED | ResizeObserver + FitAddon + debounced `ws.send` resize JSON all present; 100ms timing needs browser |
| TERM-04 | 25-01, 25-02 | 终端主题跟随应用 dark/light 设置 | ? HUMAN NEEDED | `useEffect([resolvedTheme])` → `term.options.theme` wired; live toggle needs browser |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/task/task-terminal.tsx` | 43 | `onSessionEnd: _onSessionEnd` (prop accepted, prefixed `_` — not called) | ℹ️ Info | Known stub: documented in SUMMARY. Phase 26 will wire PTY exit to `onSessionEnd`. No impact on Phase 25 goals. |

No blockers found. The `_onSessionEnd` stub is explicitly scoped to Phase 26 in the SUMMARY (line "Known Stubs" section).

---

## Human Verification Required

### 1. ANSI Color Rendering (TERM-01)

**Test:** Start `pnpm dev`, ensure Phase 24 WS server is running on port 3001. Import `TaskTerminal` into a test page with `dynamic({ ssr: false })` and `worktreePath="/tmp"`. Run `ls --color=auto` in the terminal.
**Expected:** File names appear in colors (directories blue, executables green, etc.). No blank canvas. PTY output scrolls correctly.
**Why human:** xterm.js canvas rendering and WebGL output cannot be verified via static code analysis.

### 2. Keyboard Input Forwarding (TERM-02)

**Test:** In the mounted terminal, type `echo hello` and press Enter.
**Expected:** The shell responds with `hello` — confirming input was forwarded to PTY via WebSocket and output was received back.
**Why human:** Bidirectional WebSocket I/O requires a live PTY session.

### 3. Panel Resize Reflow (TERM-03)

**Test:** With the terminal mounted and connected, drag the workbench panel resize handle to change the terminal panel dimensions.
**Expected:** Terminal text reflows within ~100ms — no clipping, columns and rows update correctly.
**Why human:** ResizeObserver + FitAddon + 100ms debounce timing requires real DOM layout changes in a browser.

### 4. Dark/Light Theme Switch (TERM-04)

**Test:** Toggle dark/light mode in the application while the terminal is mounted and connected.
**Expected:** Terminal background changes from `#0a0a0a` (dark) to `#fafafa` (light) and vice versa, without unmounting or losing scroll position.
**Why human:** `useTheme` hook behavior + xterm `terminal.options.theme` live update requires visual inspection.

### 5. No-Worktree Placeholder (graceful fallback)

**Test:** Render `<TaskTerminal taskId="any" worktreePath={null} />`.
**Expected:** Centered placeholder renders "No Worktree" text (i18n key `terminal.noWorktree`) and description, no JavaScript error, no blank screen.
**Why human:** Conditional render path with intentional early return before WebSocket init needs browser confirmation.

---

## Gaps Summary

No gaps blocking Phase 25 goal. All code artifacts are present, substantive, and correctly wired internally. The phase successfully delivers:

- `@xterm/addon-attach` and `@xterm/addon-webgl` installed and importable
- All 12 terminal i18n keys (6 zh + 6 en) added to `src/lib/i18n.tsx`
- `TaskTerminal` component (238 lines) with complete xterm.js integration: AttachAddon, FitAddon, WebglAddon, ResizeObserver (100ms debounce), theme sync

The component is intentionally orphaned at Phase 25 boundary — Phase 26 handles page-level wiring. This is by design per ROADMAP.

The 5 human verification items above are behavioral checks that require a running browser + Phase 24 WS server. These are standard for UI components and do not indicate code defects. The Plan 02 Task 2 human-verify checkpoint was explicitly left pending for human sign-off.

---

_Verified: 2026-04-03T01:08:57Z_
_Verifier: Claude (gsd-verifier)_
