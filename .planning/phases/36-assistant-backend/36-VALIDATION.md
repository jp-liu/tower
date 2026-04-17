---
phase: 36
slug: assistant-backend
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 36 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test:run` |
| **Full suite command** | `pnpm test:run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:run`
- **After every plan wave:** Run `pnpm test:run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 36-01-01 | 01 | 1 | BE-01 | unit | `pnpm test:run -- assistant-actions` | ❌ W0 | ⬜ pending |
| 36-01-02 | 01 | 1 | BE-02 | unit | `pnpm test:run -- assistant-actions` | ❌ W0 | ⬜ pending |
| 36-01-03 | 01 | 1 | BE-03 | unit | `pnpm test:run -- assistant-actions` | ❌ W0 | ⬜ pending |
| 36-01-04 | 01 | 1 | BE-04 | manual | Manual: WS connection test | — | ⬜ pending |
| 36-01-05 | 01 | 1 | BE-05 | unit | `pnpm test:run -- ws-server` | ❌ W0 | ⬜ pending |
| 36-01-06 | 01 | 1 | BE-06 | unit | `pnpm test:run -- config` | ❌ W0 | ⬜ pending |
| 36-01-07 | 01 | 1 | UX-01 | unit | `pnpm test:run -- assistant-actions` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/actions/__tests__/assistant-actions.test.ts` — stubs for BE-01, BE-02, BE-03, UX-01
- [ ] `src/lib/pty/__tests__/ws-server-assistant.test.ts` — stubs for BE-05

*Existing infrastructure covers config reading (BE-06).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WS streams assistant output in browser | BE-04 | Requires running WS server + browser | 1. Start dev server 2. Open browser console 3. `new WebSocket("ws://localhost:3001/terminal?taskId=__assistant__")` 4. Verify data frames arrive |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
