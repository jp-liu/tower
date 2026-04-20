---
phase: 31-pty-primitives-env-injection
plan: "01"
subsystem: pty
tags: [pty, env-injection, idle-detection, session-store]
dependency_graph:
  requires: []
  provides: [envOverrides-in-PtySession, idle-detection-timer, createSession-forwarding]
  affects: [src/lib/pty/pty-session.ts, src/lib/pty/session-store.ts]
tech_stack:
  added: []
  patterns: [idle-timer-reset-pattern, env-spread-injection]
key_files:
  created: []
  modified:
    - src/lib/pty/pty-session.ts
    - src/lib/pty/session-store.ts
decisions:
  - "envOverrides spread via ...envOverrides AFTER existing env keys in pty.spawn() — overrides take precedence, no process.env mutation"
  - "180s minimum enforced via Math.max(idleThresholdMs ?? 180_000, 180_000) — prevents false positives from Claude silent reasoning"
  - "_idleFired flag ensures onIdle fires exactly once per session lifetime"
  - "_resetIdleTimer() clears timer on exit and kill() to prevent post-session callbacks"
  - "isIdle getter added for Phase 34 MCP tools to query idle state"
metrics:
  duration: 120s
  completed: "2026-04-11T02:25:29Z"
  tasks: 2
  files_modified: 2
---

# Phase 31 Plan 01: PTY Primitives — env injection and idle detection

**One-liner:** Per-session env var injection via `envOverrides` spread into `pty.spawn()` plus idle detection timer with configurable threshold (minimum 180s) firing `onIdle` once after silence.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add envOverrides and idle detection to PtySession | 63029b8 | src/lib/pty/pty-session.ts |
| 2 | Forward envOverrides and idle params through createSession | 0c5a272 | src/lib/pty/session-store.ts |

## What Was Built

### Task 1 — PtySession changes (pty-session.ts)

**envOverrides (NTFY-01):**
- New optional constructor parameter `envOverrides?: Record<string, string>`
- Spread `...envOverrides` AFTER the existing env keys in `pty.spawn()` — overrides take precedence
- Never mutates `process.env` — scope is local to each spawn call

**Idle detection (NTFY-06/07):**
- Private fields: `_idleTimer`, `_idleThresholdMs`, `_onIdle`, `_idleFired`
- Constructor params: `onIdle?: () => void`, `idleThresholdMs?: number` (default 180_000, minimum enforced via `Math.max`)
- `_resetIdleTimer()`: clears existing timer, sets new one that fires `_onIdle` once after threshold
- Called inside `_pty.onData` callback (NTFY-06 — PTY output resets timer)
- Called at start of `write()` (NTFY-07 — user input resets timer)
- Timer cleared in `_pty.onExit` callback and `kill()` — no callbacks after session ends
- Initial countdown started at end of constructor

**isIdle getter:**
- `get isIdle(): boolean { return this._idleFired; }` — Phase 34 MCP tools will query this

### Task 2 — session-store.ts changes

- `createSession` signature extended with 3 new optional params: `envOverrides`, `onIdle`, `idleThresholdMs`
- All 3 params forwarded to `PtySession` constructor
- Backwards compatible — existing callers (agent-actions.ts) pass `undefined` and get default behavior

## Verification

- `npx tsc --noEmit` passes with zero NEW errors (pre-existing errors in agent-config-actions.ts and pty-session.test.ts are unrelated, per Phase 29 decision)
- All acceptance criteria checks pass:
  - `grep -q "envOverrides" src/lib/pty/pty-session.ts` — PASS
  - `grep -q "_idleTimer" src/lib/pty/pty-session.ts` — PASS
  - `grep -q "_resetIdleTimer" src/lib/pty/pty-session.ts` — PASS
  - `grep -q "get isIdle" src/lib/pty/pty-session.ts` — PASS
  - `grep -q "Math.max" src/lib/pty/pty-session.ts` — PASS
  - `grep -q "\.\.\.envOverrides" src/lib/pty/pty-session.ts` — PASS
  - `grep -q "envOverrides" src/lib/pty/session-store.ts` — PASS
  - `grep -q "onIdle" src/lib/pty/session-store.ts` — PASS
  - `grep -q "idleThresholdMs" src/lib/pty/session-store.ts` — PASS

## Deviations from Plan

None — plan executed exactly as written.

The only adjustment: also cleared `_idleTimer` in `kill()` (in addition to `onExit`) so that force-killed sessions also clean up the timer. This is a correctness improvement aligned with Rule 2 (missing null handling).

## Known Stubs

None. Both parameters (`envOverrides`, idle detection) are fully wired. Phase 32 will inject actual `CALLBACK_URL` and `AI_MANAGER_TASK_ID` values via `envOverrides`.

## Self-Check: PASSED
