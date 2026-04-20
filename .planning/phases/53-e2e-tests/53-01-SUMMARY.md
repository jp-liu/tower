---
phase: 53-e2e-tests
plan: "01"
subsystem: e2e-testing
tags: [playwright, e2e, task-lifecycle, settings-persistence]
dependency_graph:
  requires: []
  provides: [E2E-01, E2E-03]
  affects: [playwright.config.ts, package.json, tests/e2e/]
tech_stack:
  added: [playwright]
  patterns: [serial-test-suite, createPortal-selector, proxy-bypass]
key_files:
  created:
    - tests/e2e/task-flow.spec.ts
    - tests/e2e/settings-flow.spec.ts
  modified:
    - playwright.config.ts
    - package.json
decisions:
  - "Context menu uses plain <button> elements (no role=menuitem) inside createPortal; scoped with [style*='z-index: 9999'] selector"
  - "NO_PROXY=localhost,127.0.0.1 required in both package.json test:e2e script and playwright.config.ts webServer.env to bypass http_proxy that routes localhost through an external proxy returning 502"
  - "navigateToFirstWorkspace detects workspace sidebar buttons by time pattern /\\d+[mhd]\\s+ago/ from formatTime() in app-sidebar.tsx"
metrics:
  duration: "~90min"
  completed: "2026-04-20T09:30:00Z"
  tasks_completed: 2
  files_changed: 4
---

# Phase 53 Plan 01: Playwright E2E Test Suite — Task Flow & Settings Summary

Playwright E2E test suite covering task lifecycle (create → IN_PROGRESS → DONE) and settings persistence (theme, locale, config values) with 9/9 tests passing against a live dev server.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Configure Playwright with webServer auto-start, add test:e2e script | eefb39f | playwright.config.ts, package.json |
| 2 | Write E2E-01 task-flow and E2E-03 settings-flow test specs | e2d182c | tests/e2e/task-flow.spec.ts, tests/e2e/settings-flow.spec.ts |

## Verification

All 9 tests pass:

```
tests/e2e/task-flow.spec.ts    — 4 passed (Task Lifecycle Flow)
tests/e2e/settings-flow.spec.ts — 5 passed (Settings Persistence Flow)
```

Run with: `pnpm test:e2e tests/e2e/task-flow.spec.ts tests/e2e/settings-flow.spec.ts`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] http_proxy blocks localhost — 502 on all Playwright requests**
- **Found during:** Task 2 verification
- **Issue:** `http_proxy=http://129.211.81.198:31165` was set in the shell environment, causing Playwright (and curl) to route `localhost:3000` traffic through the external proxy, which returned 502 Bad Gateway
- **Fix:** Added `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1` to both the `test:e2e` script in `package.json` and the `webServer.env` in `playwright.config.ts`
- **Files modified:** `package.json`, `playwright.config.ts`
- **Commit:** e2d182c

**2. [Rule 1 - Bug] Context menu selector `[role='menuitem']` finds zero elements**
- **Found during:** Task 2, tests 3 and 4
- **Issue:** The `TaskCardContextMenu` component renders plain `<button>` elements (no `role="menuitem"`) inside a `createPortal` into `document.body` at `z-index: 9999`. The test was looking for `[role='menuitem']` and `[data-slot='menu-item']` which never exist.
- **Fix:** Replaced with `[style*='z-index: 9999']` selector to scope to the context menu portal container, then iterate its `button` children
- **Files modified:** `tests/e2e/task-flow.spec.ts`
- **Commit:** e2d182c

**3. [Rule 1 - Bug] navigateToFirstWorkspace detected wrong sidebar buttons**
- **Found during:** Task 2 debugging
- **Issue:** Original sidebar button detection used a regex `/\d+[dhmws]?\s*(ago|前)/` that was unreliable. The actual `formatTime()` function in `app-sidebar.tsx` outputs only English: "Xm ago", "Xh ago", or "Xd ago".
- **Fix:** Updated regex to `/\d+[mhd]\s+ago/` and added `waitForLoadState("domcontentloaded")` + explicit sidebar `waitFor` before scanning buttons. Added nav item exclusion list to avoid clicking settings/archive links.
- **Files modified:** `tests/e2e/task-flow.spec.ts`
- **Commit:** e2d182c

## Known Stubs

None — all test behaviors are fully wired.

## Self-Check: PASSED

- `tests/e2e/task-flow.spec.ts`: FOUND
- `tests/e2e/settings-flow.spec.ts`: FOUND
- `playwright.config.ts` (webServer block): FOUND
- `package.json` (test:e2e script): FOUND
- Commit `eefb39f`: FOUND
- Commit `e2d182c`: FOUND
- 9/9 tests passing verified by final `pnpm playwright test` run
